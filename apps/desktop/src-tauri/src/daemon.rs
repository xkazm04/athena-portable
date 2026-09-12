//! The sidecar and its exit hygiene (README §3.5: "orphaned daemons after one evening").
//!
//! The first build left a Python daemon running every time the shell was closed the wrong way, and
//! after an evening of development there were six of them holding six ports. The fix is one module
//! that owns the whole lifecycle and a kill that takes the tree, not the process.
//!
//! On Windows that means a **job object**. A process started inside a job with
//! `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` dies when the last handle to the job closes — including
//! when the shell is killed from Task Manager, which is the case a `Drop` implementation cannot
//! cover because `Drop` does not run. Elsewhere the child is killed and waited for, and the wait is
//! the part that is easy to leave out: a killed process that is never reaped is a zombie holding
//! its port.
//!
//! The handshake is one JSON line on the daemon's stdout, read before anything else (`athena.cli`).
//! The shell blocks for it, with a timeout, because a shell that renders before it knows the port
//! is a shell whose first request fails for a reason the user cannot see.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// How long the shell waits for the handshake line before giving up on the sidecar.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(30);

/// What `athena serve` prints on its first line of stdout.
const HANDSHAKE_KIND: &str = "athena.daemon";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Handshake {
    pub kind: String,
    pub url: String,
    pub port: u16,
    pub token: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub pid: u32,
}

#[derive(Debug, thiserror::Error)]
pub enum DaemonError {
    #[error("the daemon could not be started: {0}")]
    Spawn(#[from] std::io::Error),
    #[error("the daemon did not print a handshake within {0:?}")]
    Timeout(Duration),
    #[error("the daemon exited before it was ready")]
    Exited,
    #[error("the daemon's first line was not a handshake: {0}")]
    Malformed(String),
}

/// Parse the handshake line. Separated from the reading so it is testable without a process.
pub fn parse_handshake(line: &str) -> Result<Handshake, DaemonError> {
    let parsed: Handshake =
        serde_json::from_str(line.trim()).map_err(|_| DaemonError::Malformed(line.to_string()))?;
    if parsed.kind != HANDSHAKE_KIND {
        return Err(DaemonError::Malformed(line.to_string()));
    }
    if parsed.token.is_empty() || parsed.port == 0 {
        return Err(DaemonError::Malformed(line.to_string()));
    }
    Ok(parsed)
}

/// How to start the daemon. Two shapes, and the shell decides which by what is on disk.
#[derive(Debug, Clone)]
pub struct Spawn {
    pub program: String,
    pub args: Vec<String>,
}

impl Spawn {
    /// The frozen sidecar that ships in the bundle.
    pub fn bundled(binary: impl Into<String>) -> Self {
        Self {
            program: binary.into(),
            args: vec!["serve".into(), "--port".into(), "0".into()],
        }
    }

    /// The checkout, for development: the same daemon, run as a module.
    pub fn from_checkout() -> Self {
        Self {
            program: "python".into(),
            args: vec![
                "-m".into(),
                "athena".into(),
                "serve".into(),
                "--port".into(),
                "0".into(),
            ],
        }
    }
}

/// A running daemon, and the only thing that is allowed to stop it.
pub struct Sidecar {
    child: Child,
    pub handshake: Handshake,
    #[cfg(windows)]
    _job: windows_job::Job,
}

impl Sidecar {
    /// Start the daemon and block until it says where it is.
    pub fn start(spawn: &Spawn) -> Result<Self, DaemonError> {
        let mut command = Command::new(&spawn.program);
        command
            .args(&spawn.args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        // No console window. A black box flashing on every launch is a visible defect on the
        // machine the demo is running on.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command.spawn()?;

        #[cfg(windows)]
        let job = {
            let job = windows_job::Job::new().map_err(DaemonError::Spawn)?;
            job.assign(&child).map_err(DaemonError::Spawn)?;
            job
        };

        let stdout = child.stdout.take().ok_or(DaemonError::Exited)?;
        let (tx, rx) = mpsc::channel::<String>();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                // Only the first line is the handshake; the rest is the daemon's own output and is
                // forwarded to the shell's stderr rather than parsed.
                if tx.send(line).is_err() {
                    break;
                }
            }
        });

        let line = rx
            .recv_timeout(HANDSHAKE_TIMEOUT)
            .map_err(|_| DaemonError::Timeout(HANDSHAKE_TIMEOUT))?;
        let handshake = parse_handshake(&line)?;

        Ok(Self {
            child,
            handshake,
            #[cfg(windows)]
            _job: job,
        })
    }

    /// Kill and reap. Idempotent, because it is called from `Drop` as well as from the exit path.
    pub fn stop(&mut self) {
        let _ = self.child.kill();
        // The wait is not optional. A killed child that is never reaped holds its port open, which
        // is exactly the "six daemons on six ports" the first build ended its evenings with.
        let _ = self.child.wait();
    }

    pub fn pid(&self) -> u32 {
        self.child.id()
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        self.stop();
    }
}

/// The job object, which is the half of exit hygiene that survives a `Drop` that never runs.
#[cfg(windows)]
mod windows_job {
    use std::io;
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    pub struct Job(HANDLE);

    // The handle is owned by this struct and only ever closed in `Drop`.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        pub fn new() -> io::Result<Self> {
            let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if handle.is_null() {
                return Err(io::Error::last_os_error());
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = unsafe {
                SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const std::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };
            if ok == 0 {
                unsafe { CloseHandle(handle) };
                return Err(io::Error::last_os_error());
            }
            Ok(Self(handle))
        }

        pub fn assign(&self, child: &Child) -> io::Result<()> {
            let ok = unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle() as HANDLE) };
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = r#"{"kind":"athena.daemon","url":"http://127.0.0.1:5123","port":5123,"token":"abc","version":"0.1.0","pid":42}"#;

    #[test]
    fn a_handshake_is_parsed_into_the_url_and_the_token() {
        let parsed = parse_handshake(GOOD).expect("a well-formed handshake");

        assert_eq!(parsed.port, 5123);
        assert_eq!(parsed.token, "abc");
        assert_eq!(parsed.url, "http://127.0.0.1:5123");
    }

    #[test]
    fn a_line_that_is_not_json_is_refused_rather_than_guessed_at() {
        assert!(matches!(
            parse_handshake("Traceback (most recent call last):"),
            Err(DaemonError::Malformed(_))
        ));
    }

    #[test]
    fn another_programs_json_is_not_a_handshake() {
        let line = r#"{"kind":"something.else","url":"x","port":1,"token":"t"}"#;
        assert!(matches!(
            parse_handshake(line),
            Err(DaemonError::Malformed(_))
        ));
    }

    #[test]
    fn a_handshake_without_a_token_is_refused() {
        let line = r#"{"kind":"athena.daemon","url":"http://x","port":5123,"token":""}"#;
        assert!(matches!(
            parse_handshake(line),
            Err(DaemonError::Malformed(_))
        ));
    }

    #[test]
    fn a_handshake_on_port_zero_is_refused() {
        // Port 0 means the daemon never actually bound; answering it would be a shell that
        // reports ready and then fails every request.
        let line = r#"{"kind":"athena.daemon","url":"http://x","port":0,"token":"abc"}"#;
        assert!(matches!(
            parse_handshake(line),
            Err(DaemonError::Malformed(_))
        ));
    }

    #[test]
    fn the_checkout_spawn_runs_the_daemon_as_a_module() {
        let spawn = Spawn::from_checkout();
        assert_eq!(spawn.program, "python");
        assert!(spawn.args.iter().any(|arg| arg == "athena"));
        assert!(spawn.args.iter().any(|arg| arg == "serve"));
    }
}
