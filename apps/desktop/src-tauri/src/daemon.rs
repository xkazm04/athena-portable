//! The sidecar: one daemon per shell, and none that outlives it — README section 3.5, the row
//! that reads "orphaned daemons after one evening".
//!
//! The shell does not proxy the daemon. It mints a token, spawns `athena serve` on `--port 0`,
//! reads the one JSON ready line to learn the port, polls `/health` until it answers, and then
//! hands `{url, token}` to the `chrome` webview, which talks to 127.0.0.1 directly from c22 on.
//! Everything in this module is about the two ends of that process's life: starting it honestly,
//! and making sure it is gone.
//!
//! **Why exit hygiene is written in the same commit that first spawns a daemon.** The first build
//! left twenty-four daemons behind after one evening, each holding a port and a brain directory.
//! Two things had gone wrong, and both are answered here:
//!
//! 1. *Killing the child is not enough.* A PyInstaller one-file binary is a bootloader that
//!    unpacks itself into a temp directory and runs the real interpreter as a **child**; the dev
//!    fallback (`uv run athena serve`) likewise runs Python as a child. Terminating the top of
//!    that tree leaves the daemon running with nobody left to stop it. So [`Daemon::shutdown`]
//!    kills the *tree*.
//! 2. *Some exits never reach our code at all.* Ctrl-C on `tauri dev`, a panic, `taskkill /F`,
//!    Task Manager. On Windows the child is therefore put in a **job object** with
//!    [`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`](job), whose only handle belongs to this process: the
//!    kernel closes it however we die, and everything in the job goes with it. That guarantee is
//!    the OS's, not ours, which is the only kind that survives a hard kill.
//!
//! The token never rides on the command line. `athena serve --token-file <path>` reads the token
//! back out of a file this module writes first (see `daemon/server.py::resolve_token`), and a
//! path on an inherited, logged, screenshotted argv is not a secret. See ADR 0015.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// The origins the daemon must accept from the browser's side of the fence: the dev server in
/// both spellings of loopback (a browser treats `127.0.0.1` and `localhost` as different
/// origins), and the two shapes the Tauri asset protocol takes across platforms. 1431 is this
/// shell's Vite port (`vite.config.ts`), not Tauri's 1420 default.
///
/// CORS is the browser's fence; the token is ours. Widening this list loosens neither.
pub const UI_ORIGINS: [&str; 4] = [
    "http://127.0.0.1:1431",
    "http://localhost:1431",
    "http://tauri.localhost",
    "tauri://localhost",
];

/// How long the shell waits for the ready line before it *says something*. It does not kill the
/// child: a cold `uv run` legitimately spends longer than this resolving an environment, and a
/// frozen binary can be unpacked slowly by a scanner. The bound turns a hang into a typed error
/// the panel can render, and the reader keeps reading — a late ready line still promotes the
/// status to ready.
const READY_LINE_BUDGET: Duration = Duration::from_secs(20);
/// How long `/health` may take to answer 200 once the daemon has said it is listening. The socket
/// is already bound at that point, so this is a budget for the first request, not for a start.
const HEALTH_BUDGET: Duration = Duration::from_secs(20);
const HEALTH_INTERVAL: Duration = Duration::from_millis(250);
const HEALTH_REQUEST_TIMEOUT: Duration = Duration::from_secs(3);
/// Stage one of the shutdown: how long a daemon has to notice its stdin closed and leave on its
/// own. Today's daemon does not watch stdin, so this is a courtesy to the one that will — short
/// enough that quitting the window never feels like it stalled.
const SHUTDOWN_GRACE: Duration = Duration::from_millis(150);
/// The largest `/health` body the probe will read before it stops caring. The answer is a few
/// hundred bytes; this is a cap on nonsense.
const HEALTH_BODY_CAP: u64 = 64 * 1024;
/// How long the poll keeps asking `/health` for the engine probe *after* the daemon is ready.
/// The probe spawns `claude --version` on a thread beside the server, so it lands a moment after
/// the first 200; the daemon is `ready` throughout, and a probe that never answers is a Setup
/// screen that says "not probed" rather than a shell that waited for one.
const ENGINES_BUDGET: Duration = Duration::from_secs(30);

/// The environment variable a developer points at a recorded transcript. The daemon replays it
/// instead of spawning the engine (`athena serve --script`), which is what makes
/// `ATHENA_SMOKE=turn` and the demo walk-through the same turn every time.
pub const SCRIPT_ENV: &str = "ATHENA_ENGINE_SCRIPT";

/// Where the token is written and where `--token-file` is pointed. The daemon reads it back.
const TOKEN_FILENAME: &str = "daemon.json";
/// The engine a shell starts on before anything has been configured. c21's Settings module owns
/// the stored answer and applies it with `daemon_restart`; this module never reads the store.
pub const DEFAULT_ENGINE: &str = "claude_code";
/// The name `scripts/build-sidecar.py` gives the frozen daemon, and the name Tauri's
/// `externalBin` leaves beside the executable once it has stripped the target triple.
const SIDECAR_STEM: &str = "athena-daemon";

// ==============================================================================================
// The ready line (src/athena/daemon/ready.py)
// ==============================================================================================

/// A listening daemon, as its ready line described it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ready {
    /// `http://127.0.0.1:<port>`. With `--port 0` this line is the only place the port exists.
    pub url: String,
    pub engine: String,
    pub brain: String,
    /// The path the token can be read back from — a path, never the token.
    pub token_file: Option<String>,
}

/// Why the shell has no daemon. Every variant is a sentence the panel can show; none is a hang.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SidecarError {
    /// Nothing that parses as the ready line arrived inside the budget. The child may still be
    /// starting, so this reports and does not kill.
    ReadyTimeout(Duration),
    /// `{"ok": false, ...}`: the daemon could not start and said why, in the refusal vocabulary
    /// of `contracts.harness.ERROR_REASONS`.
    Refused { reason: String, detail: String },
    /// stdout closed with no ready line on it. The process is gone.
    Exited,
}

impl std::fmt::Display for SidecarError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ReadyTimeout(budget) => write!(
                f,
                "no ready line from the daemon within {}s — it may still be starting",
                budget.as_secs()
            ),
            Self::Refused { reason, detail } => {
                if detail.is_empty() {
                    write!(f, "the daemon refused to start ({reason})")
                } else {
                    write!(f, "the daemon refused to start ({reason}): {detail}")
                }
            }
            Self::Exited => write!(f, "the daemon exited without printing a ready line"),
        }
    }
}

/// What one line of the daemon's stdout turned out to be.
///
/// Three outcomes, not two. A line that is not the ready line at all — a `uv` diagnostic, a
/// warning, a banner — is **not** a refusal: latching on it would mask the real ready line
/// printed after it and report a working daemon as broken.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Line {
    Ready(Ready),
    Refused { reason: String, detail: String },
    /// Not the daemon answering. Log it and keep waiting.
    Other,
}

/// Parse one line of stdout. Pure, so the four cases are four unit tests and not a live process.
pub fn parse_line(text: &str) -> Line {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(text.trim()) else {
        return Line::Other;
    };
    let string = |key: &str| -> String {
        json.get(key)
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    match json.get("ok").and_then(serde_json::Value::as_bool) {
        Some(true) => {
            let url = string("url");
            // A ready line with no URL is not a ready line: the URL is the whole reason the line
            // exists, and treating a malformed one as ready would point the panel at nothing.
            if url.is_empty() {
                return Line::Other;
            }
            Line::Ready(Ready {
                url,
                engine: string("engine"),
                brain: string("brain"),
                token_file: json
                    .get("token_file")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string),
            })
        }
        Some(false) => Line::Refused {
            reason: {
                let reason = string("reason");
                if reason.is_empty() {
                    "unknown".to_string()
                } else {
                    reason
                }
            },
            detail: string("detail"),
        },
        None => Line::Other,
    }
}

/// Wait for the one ready line on a channel of stdout lines.
///
/// `budget` of `None` waits forever, which is what the supervisor does *after* it has already
/// reported the timeout: the bound exists so nothing hangs silently, not so a slow machine is
/// refused a daemon.
pub fn await_ready(
    lines: &Receiver<String>,
    budget: Option<Duration>,
) -> Result<Ready, SidecarError> {
    let deadline = budget.map(|b| Instant::now() + b);
    loop {
        let received = match deadline {
            Some(at) => {
                let left = at.saturating_duration_since(Instant::now());
                lines.recv_timeout(left).map_err(|e| match e {
                    RecvTimeoutError::Timeout => {
                        SidecarError::ReadyTimeout(budget.unwrap_or_default())
                    }
                    RecvTimeoutError::Disconnected => SidecarError::Exited,
                })
            }
            None => lines.recv().map_err(|_| SidecarError::Exited),
        };
        match parse_line(&received?) {
            Line::Ready(ready) => return Ok(ready),
            Line::Refused { reason, detail } => {
                return Err(SidecarError::Refused { reason, detail })
            }
            Line::Other => continue,
        }
    }
}

// ==============================================================================================
// The argv contract (SIDECAR.md)
// ==============================================================================================

/// The flags every spawn of the daemon carries, in both shapes.
///
/// The subcommand is **not** here: the frozen binary *is* `athena serve` (`scripts/
/// sidecar_entry.py` prepends it, so nothing that spawns the binary can point it at `doctor` or
/// `brain`), while the dev fallback puts `run athena serve` in front of these. Keeping the flags
/// in one function is what makes the two shapes provably the same daemon.
///
/// `script` is the dev affordance: a recorded transcript the daemon replays instead of spawning
/// the engine. It is passed through untouched — the daemon refuses a path that is not a file on
/// its failure line, which is the one place that check belongs.
pub fn serve_args(
    token_file: &Path,
    brain: &Path,
    engine: &str,
    script: Option<&str>,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "--port".into(),
        // The kernel picks the port, so two shells never fight over 17490 and the panel never
        // guesses. The bound port comes back on the ready line and nowhere else.
        "0".into(),
        // Not `--token`: argv is inherited, logged and screenshotted, and a path is not a secret.
        "--token-file".into(),
        token_file.to_string_lossy().to_string(),
        "--brain".into(),
        brain.to_string_lossy().to_string(),
        "--engine".into(),
        if engine.trim().is_empty() {
            DEFAULT_ENGINE.to_string()
        } else {
            engine.trim().to_string()
        },
    ];
    for origin in UI_ORIGINS {
        args.push("--allow-origin".into());
        args.push(origin.into());
    }
    if let Some(path) = script.map(str::trim).filter(|s| !s.is_empty()) {
        args.push("--script".into());
        args.push(path.to_string());
    }
    args
}

/// The transcript to replay, if a developer asked for one.
///
/// Debug builds only, or a release build that has already opted into the dev fallback with
/// `ATHENA_DEV_FALLBACK`. A shipped shell that replayed a file on the strength of an environment
/// variable would be a shell whose transcript is a lie about what ran.
fn script_from_env() -> Option<String> {
    if !cfg!(debug_assertions) && std::env::var_os("ATHENA_DEV_FALLBACK").is_none() {
        return None;
    }
    std::env::var(SCRIPT_ENV).ok().filter(|s| !s.trim().is_empty())
}

// ==============================================================================================
// The token
// ==============================================================================================

/// 32 random bytes from the OS, hex. Minted per spawn: a restart invalidates the old one.
fn mint_token() -> String {
    let mut bytes = [0u8; 32];
    // There is no safe degraded mode here. A guessable daemon token is an open daemon, and an
    // open daemon on loopback is reachable from every page in the browser this shell drives.
    getrandom::fill(&mut bytes).expect("the operating system refused 32 random bytes");
    bytes.iter().fold(String::with_capacity(64), |mut s, b| {
        use std::fmt::Write as _;
        let _ = write!(s, "{b:02x}");
        s
    })
}

/// Write the token where `--token-file` will read it, in the shape `resolve_token` expects.
///
/// Owner-only where the platform has modes, and created that way rather than chmod'ed after the
/// fact, so the secret is never briefly world-readable. Windows has no mode to set here; the
/// per-user app data directory is the protection, as it is for every other credential a CLI
/// keeps there.
fn write_token_file(path: &Path, token: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let body = serde_json::json!({ "token": token }).to_string();
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)?;
        file.write_all(body.as_bytes())?;
    }
    #[cfg(not(unix))]
    std::fs::write(path, body)?;
    Ok(())
}

// ==============================================================================================
// Where the daemon is
// ==============================================================================================

/// This repository, and not merely *a* Python project.
///
/// The dev fallback runs `uv run` in the directory this qualifies, and `uv run` resolves and
/// executes that project's own dependencies and entry point — so "has a pyproject.toml" is not a
/// strong enough claim to hand a stranger's project a live token. `src/athena/cli.py` is the
/// module the fallback is about to run; without it, this is somebody else's checkout.
fn is_athena_checkout(dir: &Path) -> bool {
    dir.join("pyproject.toml").is_file() && dir.join("src").join("athena").join("cli.py").is_file()
}

/// Walk up from the executable, then from the working directory, until this repository shows up.
///
/// The executable's ancestry comes first on purpose: where the binary lives is a fact about the
/// build, while the working directory is whatever shell or shortcut happened to launch it.
fn repo_root() -> Option<PathBuf> {
    let mut starts: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            starts.push(dir.to_path_buf());
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        starts.push(cwd);
    }
    for start in starts {
        let mut dir: Option<&Path> = Some(start.as_path());
        while let Some(d) = dir {
            if is_athena_checkout(d) {
                return Some(d.to_path_buf());
            }
            dir = d.parent();
        }
    }
    None
}

/// The frozen daemon, if one was built. Two shapes, because Tauri renames it:
/// `build-sidecar.py` writes `athena-daemon-<triple>[.exe]` (that suffix is how `externalBin`
/// resolves an external binary), and Tauri *strips* the triple when it copies the file next to
/// the executable. So a bundle holds the bare name and a checkout holds the suffixed one.
///
/// Both exact spellings are tried in every root before any guess. The loose prefix match is what
/// lets a deliberate cross-triple override work; a file left behind by another toolchain fails to
/// exec, and the dev fallback that would have worked is then never reached, so taking it is
/// announced rather than silent.
fn sidecar_path(app: &AppHandle) -> Option<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.to_path_buf());
        }
    }
    if let Ok(dir) = app.path().resource_dir() {
        roots.push(dir);
    }
    if let Some(root) = repo_root() {
        roots.push(root.join("apps").join("desktop").join("src-tauri").join("binaries"));
    }
    let suffix = std::env::consts::EXE_SUFFIX;
    // `tauri-build` exports the triple it resolved as a `rustc-env`, so the shell and
    // `build-sidecar.py` agree on the name without either of them guessing.
    let triple = option_env!("TAURI_ENV_TARGET_TRIPLE").unwrap_or_default();
    for root in roots {
        let bundled = root.join(format!("{SIDECAR_STEM}{suffix}"));
        if bundled.is_file() {
            return Some(bundled);
        }
        if !triple.is_empty() {
            let exact = root.join(format!("{SIDECAR_STEM}-{triple}{suffix}"));
            if exact.is_file() {
                return Some(exact);
            }
        }
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(SIDECAR_STEM) && name.ends_with(suffix) && entry.path().is_file() {
                eprintln!("[daemon] {name} does not carry this host's triple; spawning it anyway");
                return Some(entry.path());
            }
        }
    }
    None
}

/// This shell's brain: `<app data>/brain`. A brain directory is portable by copying, so it is one
/// directory and never a scattering of files.
fn brain_dir(app: &AppHandle) -> PathBuf {
    app_data(app).join("brain")
}

fn app_data(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
}

// ==============================================================================================
// `/health`
// ==============================================================================================

/// The status code and body of one `GET /health`, with the token.
///
/// A hand-written request rather than an HTTP client: the daemon is HTTP/1.1 on loopback and
/// answers `Connection: close` on every response, this shell will never point the call anywhere
/// else, and the alternative is a TLS-capable dependency for one probe. The body was always
/// drained — a half-read socket makes `http.server` log a reset on every poll — so it is returned
/// rather than thrown away: the engine probe rides on it and nothing else has to ask twice.
fn health_once(url: &str, token: &str, timeout: Duration) -> std::io::Result<(u16, String)> {
    let authority = url
        .strip_prefix("http://")
        .unwrap_or(url)
        .trim_end_matches('/');
    let address = authority
        .to_socket_addrs()?
        .next()
        .ok_or_else(|| std::io::Error::other(format!("{authority} resolves to no address")))?;
    let stream = TcpStream::connect_timeout(&address, timeout)?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    let mut stream = stream;
    stream.write_all(
        format!(
            "GET /health HTTP/1.1\r\nHost: {authority}\r\nX-Athena-Token: {token}\r\n\
             Accept: application/json\r\nConnection: close\r\n\r\n"
        )
        .as_bytes(),
    )?;
    stream.flush()?;
    let mut reader = BufReader::new(stream);
    let mut status = String::new();
    reader.read_line(&mut status)?;
    let mut drain = Vec::new();
    let _ = reader.take(HEALTH_BODY_CAP).read_to_end(&mut drain);
    let code = status_code(&status)
        .ok_or_else(|| std::io::Error::other(format!("not HTTP: {status:?}")))?;
    Ok((code, body_of(&String::from_utf8_lossy(&drain))))
}

/// `HTTP/1.1 200 OK` -> `200`. Pure, and the one place the status line is believed.
fn status_code(line: &str) -> Option<u16> {
    let mut parts = line.split_whitespace();
    if !parts.next()?.starts_with("HTTP/") {
        return None;
    }
    parts.next()?.parse().ok()
}

/// Everything after the blank line that ends the headers.
///
/// The status line has already been read, so what is left is `header\r\n…\r\n\r\nbody`. Both
/// spellings of the separator are looked for: the daemon writes `\r\n`, and being strict about a
/// framing detail on loopback would trade a working probe for nothing.
fn body_of(rest: &str) -> String {
    for separator in ["\r\n\r\n", "\n\n"] {
        if let Some(at) = rest.find(separator) {
            return rest[at + separator.len()..].to_string();
        }
    }
    String::new()
}

/// The `engines` block of a `/health` body, or `None`.
///
/// `None` covers three cases that are one case to a caller: the daemon has not probed yet
/// (`"engines": null`), the body is not JSON, or this daemon is older than the field. All three
/// mean *nothing is known*, which is exactly what the surfaces render `null` as — and never an
/// empty list, which would claim the probe answered and found nothing.
fn engines_of(body: &str) -> Option<Vec<EngineProbe>> {
    let json = serde_json::from_str::<serde_json::Value>(body).ok()?;
    let rows = json.get("engines")?.as_array()?;
    let string = |row: &serde_json::Value, key: &str| -> String {
        row.get(key)
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    Some(
        rows.iter()
            .map(|row| EngineProbe {
                id: string(row, "id"),
                state: string(row, "state"),
                detail: string(row, "detail"),
            })
            .filter(|probe| !probe.id.is_empty())
            .collect(),
    )
}

// ==============================================================================================
// Exit hygiene
// ==============================================================================================

/// Kill a process and everything under it.
///
/// Both shapes of daemon have something under them — the PyInstaller bootloader runs the real
/// interpreter as a child, and `uv run` runs Python as a child — so the tree goes, not the head.
#[cfg(windows)]
fn kill_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    /// Without it every quit flashes a console window.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(not(windows))]
fn kill_tree(pid: u32) {
    // No process group to signal, so take the children by parent pid; `Child::kill` then takes
    // the parent itself.
    let _ = Command::new("pkill")
        .args(["-KILL", "-P", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

/// The Windows job object: exit hygiene for the exits this process never sees.
///
/// [`Daemon::shutdown`] runs on window close, on app exit and before a respawn — but not on
/// Ctrl-C against `tauri dev`, not on a panic, and not on `taskkill /F`. A job object created
/// with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` moves the guarantee into the kernel: the job's only
/// handle belongs to this process, so however this process dies the handle closes and everything
/// in the job is terminated with it. A child's own children join its job automatically, which is
/// what catches the PyInstaller bootloader's interpreter and `uv`'s Python.
#[cfg(windows)]
pub mod job {
    use std::sync::OnceLock;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    /// The process-wide job, created on first use and deliberately never closed — closing it is
    /// exactly what kills the daemon, so the only thing that may close it is process death.
    /// Held as a `usize` because a raw `HANDLE` is a pointer and therefore not `Sync`; it is only
    /// ever handed back to Win32.
    static JOB: OnceLock<Option<usize>> = OnceLock::new();

    /// A fresh job that kills its contents when its last handle closes, or `None` if Windows
    /// refused. Public because the test needs a job of its own: the process-wide one must not be
    /// closed by anything.
    pub fn create() -> Option<usize> {
        // SAFETY: `CreateJobObjectW` with two null pointers asks for an unnamed job with default
        // security, and `SetInformationJobObject` is handed a zeroed struct of exactly the size
        // the class it names requires. Neither call keeps a borrow.
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return None;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                std::ptr::addr_of!(info).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                CloseHandle(job);
                return None;
            }
            Some(job as usize)
        }
    }

    /// Put one already-running process in a job. `false` when Windows refused it.
    pub fn assign(job: usize, pid: u32) -> bool {
        // SAFETY: the handle from `OpenProcess` is closed on every path out, and `job` came from
        // `create` above, which is the only producer of these values.
        unsafe {
            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
            if process.is_null() {
                return false;
            }
            let ok = AssignProcessToJobObject(job as HANDLE, process) != 0;
            CloseHandle(process);
            ok
        }
    }

    /// Close a job handle — and, with `KILL_ON_JOB_CLOSE` set and no other handle open, kill
    /// everything in it. Only the test calls this; the process-wide job is closed by process
    /// death alone, which is the whole point of it.
    #[cfg(test)]
    pub fn close(job: usize) {
        // SAFETY: `job` came from `create`, and the caller gives up the value by passing it.
        unsafe {
            CloseHandle(job as HANDLE);
        }
    }

    /// Put a freshly spawned daemon in the process-wide job.
    ///
    /// There is a window between `CreateProcess` returning and this call in which the child could
    /// start a grandchild outside the job. It is microseconds against a bootloader that has to
    /// unpack itself first, and the alternative — spawning suspended — means giving up
    /// `std::process::Command`. The tree kill covers the clean exits either way; this covers the
    /// unclean ones.
    pub fn adopt(pid: u32) {
        let Some(job) = *JOB.get_or_init(create) else {
            eprintln!("[daemon] no job object: the daemon is only reaped on a clean exit");
            return;
        };
        if !assign(job, pid) {
            eprintln!("[daemon] pid {pid} refused the job object; clean-exit reaping only");
        }
    }
}

// ==============================================================================================
// The state the shell holds
// ==============================================================================================

/// Where the daemon is in its life. The panel renders four states and no booleans, because
/// "not ready" is three different sentences.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Health {
    /// Never started, or shut down on purpose.
    Stopped,
    /// Spawned; no ready line yet, or no 200 from `/health` yet.
    Starting,
    /// `/health` answered 200 with the token.
    Ready,
    /// It will not come up, and `error` says why.
    Failed,
}

/// What the `chrome` webview is told, on `daemon_status()` and on every `daemon:status` event.
///
/// It carries the token. That is why `crate::ui_emit` exists and why nothing in this crate calls
/// `app.emit`: a broadcast reaches the page webviews, and a page webview is whatever site the
/// user navigated to.
/// One engine, as `GET /health` reports it (`athena.daemon.server.engine_probe`).
///
/// The shell does not probe: the daemon knows what is on its own PATH and whether a credential
/// file is beside it, and `lib/engines.ts` renders exactly these three fields. This struct is that
/// row and adds nothing — `state` is passed through as a string so a daemon that grows a fourth
/// answer reaches the surface instead of being dropped in Rust.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct EngineProbe {
    pub id: String,
    pub state: String,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct DaemonStatus {
    /// `http://127.0.0.1:<port>` once the ready line arrived; `null` before that.
    pub url: Option<String>,
    /// The `X-Athena-Token` every route wants. Minted per spawn.
    pub token: String,
    pub engine: String,
    pub health: Health,
    /// Why it is not ready, as a sentence. Never a secret, never empty when `health` is `failed`.
    pub error: String,
    /// `sidecar`, `uv` (the dev fallback), or `none` before the first spawn.
    pub source: String,
    /// The brain directory the daemon opened, off the ready line.
    pub brain: String,
    /// What the daemon's engine probe found, or `null` while it has not answered — which is a
    /// different fact from an empty list and the Setup wizard shows a different sentence for each.
    pub engines: Option<Vec<EngineProbe>>,
}

impl Default for DaemonStatus {
    fn default() -> Self {
        Self {
            url: None,
            token: String::new(),
            engine: DEFAULT_ENGINE.to_string(),
            health: Health::Stopped,
            error: String::new(),
            source: "none".to_string(),
            brain: String::new(),
            engines: None,
        }
    }
}

/// The one daemon this shell owns.
#[derive(Default)]
pub struct Daemon {
    status: Mutex<DaemonStatus>,
    child: Mutex<Option<Child>>,
    /// Bumped by every start and every shutdown. A supervisor thread whose generation is stale
    /// belongs to a process that has been replaced, and everything it would say is a lie.
    generation: Mutex<u64>,
}

impl Daemon {
    pub fn status(&self) -> DaemonStatus {
        self.locked_status().clone()
    }

    fn locked_status(&self) -> std::sync::MutexGuard<'_, DaemonStatus> {
        self.status.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn locked_child(&self) -> std::sync::MutexGuard<'_, Option<Child>> {
        self.child.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn locked_generation(&self) -> std::sync::MutexGuard<'_, u64> {
        self.generation.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn current_generation(&self) -> u64 {
        *self.locked_generation()
    }

    /// Change the status and tell the chrome webview, in that order and under no lock.
    fn edit(&self, app: &AppHandle, f: impl FnOnce(&mut DaemonStatus)) {
        let snapshot = {
            let mut status = self.locked_status();
            f(&mut status);
            status.clone()
        };
        crate::ui_emit(app, "daemon:status", snapshot);
    }

    /// The staged shutdown. Idempotent, because window close, app exit and a respawn can all
    /// happen in a row.
    ///
    /// 1. **Close stdin.** The daemon has no shutdown request today (`routes.py` has no route for
    ///    one), so EOF on stdin is the politest signal there is. A daemon that learns to watch it
    ///    needs no change here.
    /// 2. **A short grace period**, so a daemon that *did* leave on its own is reaped rather than
    ///    force-killed.
    /// 3. **Kill the tree**, because killing the head leaves the interpreter running.
    ///
    /// The job object is not a stage: it is what happens when none of these three runs at all.
    pub fn shutdown(&self) {
        *self.locked_generation() += 1;
        let Some(mut child) = self.locked_child().take() else {
            let mut status = self.locked_status();
            status.health = Health::Stopped;
            status.url = None;
            return;
        };
        let pid = child.id();
        drop(child.stdin.take());
        let deadline = Instant::now() + SHUTDOWN_GRACE;
        let mut left_on_its_own = false;
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                left_on_its_own = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        if !left_on_its_own {
            kill_tree(pid);
            let _ = child.kill();
        }
        // Reap either way: an unwaited child is a zombie on unix and a live handle on Windows.
        let _ = child.wait();
        let mut status = self.locked_status();
        status.health = Health::Stopped;
        status.url = None;
    }
}

// ==============================================================================================
// Spawning
// ==============================================================================================

/// Read a child's stdout line by line onto a channel. The thread ends when the pipe closes, which
/// is how [`await_ready`] learns the process is gone without owning the handle.
fn pump_stdout(stdout: std::process::ChildStdout, lines: Sender<String>) {
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let line = line.trim().to_string();
            if line.is_empty() {
                continue;
            }
            if lines.send(line).is_err() {
                return;
            }
        }
    });
}

/// The daemon's stderr is the daemon's log. It goes to ours with a prefix and nowhere else — the
/// ledger inside the daemon is the record, this is only what a developer watches while it starts.
fn pump_stderr(stderr: std::process::ChildStderr) {
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let line = line.trim();
            if !line.is_empty() {
                eprintln!("[athena-daemon] {line}");
            }
        }
    });
}

/// Spawn (or respawn) the daemon. Returns as soon as the process exists; readiness arrives later
/// on `daemon:status`.
pub fn start(app: &AppHandle, engine: &str) -> Result<(), String> {
    let state = app.state::<Daemon>();
    state.shutdown();
    let generation = {
        let mut g = state.locked_generation();
        *g += 1;
        *g
    };

    let token = mint_token();
    let token_file = app_data(app).join(TOKEN_FILENAME);
    write_token_file(&token_file, &token)
        .map_err(|e| format!("cannot write the daemon token file: {e}"))?;
    let brain = brain_dir(app);
    std::fs::create_dir_all(&brain).map_err(|e| format!("cannot create the brain: {e}"))?;
    let script = script_from_env();
    if let Some(path) = &script {
        eprintln!("[daemon] replaying {path} instead of spawning {engine}");
    }
    let args = serve_args(&token_file, &brain, engine, script.as_deref());

    let (source, mut command) = match sidecar_path(app) {
        Some(path) => {
            let mut command = Command::new(path);
            command.args(&args);
            ("sidecar", command)
        }
        None => {
            // The dev fallback is the normal inner loop — edit `src/athena/`, restart the shell,
            // no PyInstaller run — and it is a *debug build's* affordance only. `uv run` resolves
            // and executes the target project's own dependencies and entry point, so a release
            // build that has lost its sidecar must not go looking for a repository above its
            // working directory with a live token in hand. Say what is missing instead.
            if !cfg!(debug_assertions) && std::env::var_os("ATHENA_DEV_FALLBACK").is_none() {
                return Err(
                    "no athena-daemon beside the app: build one with scripts/build-sidecar.py, \
                     or set ATHENA_DEV_FALLBACK=1 to run this build against a checkout"
                        .to_string(),
                );
            }
            let root = repo_root()
                .ok_or("no athena-daemon binary and no Athena checkout to fall back to")?;
            let mut command = Command::new("uv");
            command
                .args(["run", "athena", "serve"])
                .args(&args)
                .current_dir(root);
            ("uv", command)
        }
    };

    state.edit(app, |s| {
        s.url = None;
        s.token = token.clone();
        s.engine = engine.to_string();
        s.health = Health::Starting;
        s.error = String::new();
        s.source = source.to_string();
        s.brain = brain.to_string_lossy().to_string();
        // A fresh process probes again: what was true of the last daemon's PATH is a claim this
        // one has not made yet.
        s.engines = None;
    });

    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().map_err(|e| match source {
        "uv" => format!("cannot run `uv`: {e}"),
        _ => format!("cannot spawn the daemon: {e}"),
    })?;
    // Before anything else: the job is what makes a hard kill of this process take the daemon.
    #[cfg(windows)]
    job::adopt(child.id());

    let (tx, rx) = mpsc::channel::<String>();
    if let Some(stdout) = child.stdout.take() {
        pump_stdout(stdout, tx);
    }
    if let Some(stderr) = child.stderr.take() {
        pump_stderr(stderr);
    }
    *state.locked_child() = Some(child);

    let app = app.clone();
    std::thread::spawn(move || supervise(app, generation, rx));
    Ok(())
}

/// Watch one spawn from its first stdout line to its last: the ready line, the health poll, and
/// then the closed pipe that means the process is gone.
fn supervise(app: AppHandle, generation: u64, lines: Receiver<String>) {
    let stale = |app: &AppHandle| app.state::<Daemon>().current_generation() != generation;

    let ready = match await_ready(&lines, Some(READY_LINE_BUDGET)) {
        Ok(ready) => Some(ready),
        Err(e @ SidecarError::ReadyTimeout(_)) => {
            if stale(&app) {
                return;
            }
            // Reported, not killed: a cold `uv run` is slow, not broken. Keep reading.
            app.state::<Daemon>().edit(&app, |s| {
                s.health = Health::Failed;
                s.error = e.to_string();
            });
            await_ready(&lines, None).ok()
        }
        Err(e) => {
            if stale(&app) {
                return;
            }
            app.state::<Daemon>().edit(&app, |s| {
                s.health = Health::Failed;
                s.error = e.to_string();
            });
            None
        }
    };

    if let Some(ready) = ready {
        if stale(&app) {
            return;
        }
        let token = app.state::<Daemon>().status().token;
        app.state::<Daemon>().edit(&app, |s| {
            s.url = Some(ready.url.clone());
            s.health = Health::Starting;
            s.error = String::new();
            if !ready.engine.is_empty() {
                s.engine = ready.engine.clone();
            }
            if !ready.brain.is_empty() {
                s.brain = ready.brain.clone();
            }
        });
        poll_health(&app, generation, &ready.url, &token);
    }

    // Whatever happened above, this thread now outlives the daemon by exactly one pipe: when
    // stdout closes the process is gone. Dropping the handle here is what keeps `shutdown`
    // honest — Windows recycles pids inside a session, and `taskkill /T /F` against a recycled
    // one is a force-kill of a stranger.
    while lines.recv().is_ok() {}
    if stale(&app) {
        return;
    }
    let state = app.state::<Daemon>();
    if let Some(mut child) = state.locked_child().take() {
        let _ = child.wait();
    }
    state.edit(&app, |s| {
        s.url = None;
        s.health = Health::Failed;
        s.error = "the daemon exited".to_string();
    });
}

/// Poll `GET /health` with the token until it answers 200, or give up and say so.
fn poll_health(app: &AppHandle, generation: u64, url: &str, token: &str) {
    let deadline = Instant::now() + HEALTH_BUDGET;
    loop {
        if app.state::<Daemon>().current_generation() != generation {
            return;
        }
        let why = match health_once(url, token, HEALTH_REQUEST_TIMEOUT) {
            Ok((200, body)) => {
                eprintln!("[daemon] ready at {url}");
                let engines = engines_of(&body);
                app.state::<Daemon>().edit(app, |s| {
                    s.health = Health::Ready;
                    s.error = String::new();
                    s.engines = engines.clone();
                });
                if engines.is_none() {
                    // The daemon is ready; its engine probe is a spawn on a thread beside the
                    // server and lands a moment later. Keep asking for it alone.
                    poll_engines(app, generation, url, token);
                }
                return;
            }
            // A 401 is not a slow start: the daemon is up and does not accept this token, which
            // no amount of waiting fixes. Anything else is worth retrying inside the budget.
            Ok((401, _)) => {
                app.state::<Daemon>().edit(app, |s| {
                    s.health = Health::Failed;
                    s.error = "the daemon refused this shell's token".to_string();
                });
                return;
            }
            Ok((code, _)) => format!("{url}/health answered {code}"),
            Err(e) => format!("{url}/health did not answer: {e}"),
        };
        if Instant::now() >= deadline {
            app.state::<Daemon>().edit(app, |s| {
                s.health = Health::Failed;
                s.error = format!("{why} within {}s", HEALTH_BUDGET.as_secs());
            });
            return;
        }
        std::thread::sleep(HEALTH_INTERVAL);
    }
}

/// Keep asking `/health` for the engine probe, after the daemon is already ready.
///
/// It never changes `health` or `error`: the daemon *is* ready, and a probe that never answers
/// leaves the Setup wizard saying "the probe has not answered yet", which is true. The budget is
/// what stops the supervisor thread waiting on a CLI that is not going to answer before it goes
/// back to watching the pipe.
fn poll_engines(app: &AppHandle, generation: u64, url: &str, token: &str) {
    let deadline = Instant::now() + ENGINES_BUDGET;
    while Instant::now() < deadline {
        std::thread::sleep(HEALTH_INTERVAL);
        if app.state::<Daemon>().current_generation() != generation {
            return;
        }
        let Ok((200, body)) = health_once(url, token, HEALTH_REQUEST_TIMEOUT) else {
            continue;
        };
        if let Some(engines) = engines_of(&body) {
            app.state::<Daemon>().edit(app, |s| s.engines = Some(engines));
            return;
        }
    }
}

// ==============================================================================================
// What `lib.rs` calls
// ==============================================================================================

/// Start the daemon at launch. Non-fatal: the shell must come up even when the daemon does not,
/// and the panel's degraded fixture is the surface for that.
pub fn start_at_launch(app: &AppHandle) {
    if let Err(e) = start(app, DEFAULT_ENGINE) {
        eprintln!("[daemon] not started: {e}");
        app.state::<Daemon>().edit(app, |s| {
            s.health = Health::Failed;
            s.error = e;
        });
    }
}

/// The exit hook. `ExitRequested` fires when the last window closes and `Exit` just before the
/// process leaves; taking both means the daemon is gone whichever way the shell is quit.
pub fn on_app_event(app: &AppHandle, event: &tauri::RunEvent) {
    if matches!(
        event,
        tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
    ) {
        app.state::<Daemon>().shutdown();
    }
}

/// Where the daemon is and what talks to it. The panel calls this once at start-up and then
/// listens to `daemon:status`.
#[tauri::command(rename_all = "snake_case")]
pub async fn daemon_status(app: AppHandle) -> DaemonStatus {
    app.state::<Daemon>().status()
}

/// Restart the daemon on a different engine (README section 3.5: the engine is configuration).
/// A staged shutdown, then a fresh spawn with a fresh token — the returned status is the
/// `starting` one, and `daemon:status` carries the rest.
#[tauri::command(rename_all = "snake_case")]
pub async fn daemon_restart(app: AppHandle, engine: String) -> Result<DaemonStatus, String> {
    let engine = engine.trim();
    let engine = if engine.is_empty() {
        DEFAULT_ENGINE
    } else {
        engine
    };
    start(&app, engine)?;
    Ok(app.state::<Daemon>().status())
}

// ==============================================================================================
// Tests
// ==============================================================================================

#[cfg(test)]
mod tests {
    use super::*;

    const READY: &str = r#"{"ok": true, "url": "http://127.0.0.1:51057", "token_file": "C:\\x\\daemon.json", "engine": "claude_code", "brain": "C:\\x\\brain"}"#;

    fn channel(lines: &[&str]) -> Receiver<String> {
        let (tx, rx) = mpsc::channel();
        for line in lines {
            tx.send((*line).to_string()).expect("send");
        }
        rx
    }

    // -- the ready line ------------------------------------------------------------------------

    #[test]
    fn the_ok_line_carries_the_port_the_kernel_picked() {
        let Line::Ready(ready) = parse_line(READY) else {
            panic!("the ok line must parse as ready");
        };
        assert_eq!(ready.url, "http://127.0.0.1:51057");
        assert_eq!(ready.engine, "claude_code");
        assert_eq!(ready.token_file.as_deref(), Some("C:\\x\\daemon.json"));
    }

    #[test]
    fn the_failure_line_keeps_the_reason_and_the_detail() {
        let line = parse_line(r#"{"ok": false, "reason": "engine_unavailable", "detail": "no claude on PATH"}"#);
        assert_eq!(
            line,
            Line::Refused {
                reason: "engine_unavailable".to_string(),
                detail: "no claude on PATH".to_string(),
            }
        );
    }

    #[test]
    fn anything_that_is_not_the_line_is_neither_ready_nor_a_refusal() {
        // A `uv` diagnostic, a banner, a half-written line, and an object that is not the
        // protocol at all. Latching on any of these would mask the ready line printed after it.
        for text in [
            "Resolved 41 packages in 12ms",
            "",
            "{\"ok\": true",
            r#"{"hello": "world"}"#,
            r#"{"ok": true, "engine": "claude_code"}"#, // ready with no url is not ready
        ] {
            assert_eq!(parse_line(text), Line::Other, "{text:?} must not latch");
        }
    }

    #[test]
    fn garbage_before_the_line_is_skipped() {
        let rx = channel(&["Resolved 41 packages", "Installed 3 packages", READY]);
        let ready = await_ready(&rx, Some(Duration::from_secs(5))).expect("the ready line");
        assert_eq!(ready.url, "http://127.0.0.1:51057");
    }

    #[test]
    fn a_refusal_stops_the_wait() {
        let rx = channel(&[r#"{"ok": false, "reason": "unknown", "detail": "port in use"}"#]);
        let err = await_ready(&rx, Some(Duration::from_secs(5))).expect_err("a refusal");
        assert!(err.to_string().contains("port in use"), "{err}");
    }

    #[test]
    fn no_line_inside_the_bound_is_an_error_and_not_a_hang() {
        // The sender is held, so the channel is open and silent — a child that started and has
        // printed nothing. Without the bound this call never returns.
        let (_tx, rx) = mpsc::channel::<String>();
        let budget = Duration::from_millis(120);
        let started = Instant::now();
        let err = await_ready(&rx, Some(budget)).expect_err("the bound must bite");
        assert_eq!(err, SidecarError::ReadyTimeout(budget));
        assert!(started.elapsed() < Duration::from_secs(2), "it waited too long");
    }

    #[test]
    fn a_closed_pipe_with_no_line_is_an_exit() {
        let rx = channel(&["Traceback (most recent call last):"]);
        assert_eq!(
            await_ready(&rx, Some(Duration::from_secs(5))),
            Err(SidecarError::Exited)
        );
    }

    // -- the argv contract ---------------------------------------------------------------------

    #[test]
    fn the_arguments_are_the_contract_in_sidecar_md() {
        let args = serve_args(
            Path::new("/app/daemon.json"),
            Path::new("/app/brain"),
            "codex",
            None,
        );
        let pair = |flag: &str| {
            args.iter()
                .position(|a| a == flag)
                .map(|i| args[i + 1].clone())
        };
        assert_eq!(pair("--port").as_deref(), Some("0"), "the kernel picks the port");
        assert_eq!(pair("--engine").as_deref(), Some("codex"));
        assert!(args.contains(&"--token-file".to_string()));
        // The token itself is never on argv: argv is inherited, logged and screenshotted.
        assert!(!args.iter().any(|a| a == "--token"), "{args:?}");
        // No subcommand: the frozen binary *is* `athena serve`.
        assert!(!args.iter().any(|a| a == "serve"), "{args:?}");
        for origin in UI_ORIGINS {
            assert!(args.contains(&origin.to_string()), "{origin} must be allowed");
        }
        assert_eq!(
            args.iter().filter(|a| *a == "--allow-origin").count(),
            UI_ORIGINS.len()
        );
        // No script unless one was asked for: the ordinary spawn runs the real engine.
        assert!(!args.iter().any(|a| a == "--script"), "{args:?}");
    }

    #[test]
    fn an_empty_engine_falls_back_rather_than_passing_nothing() {
        let args = serve_args(Path::new("t.json"), Path::new("b"), "   ", None);
        let i = args.iter().position(|a| a == "--engine").expect("--engine");
        assert_eq!(args[i + 1], DEFAULT_ENGINE);
    }

    #[test]
    fn a_recorded_transcript_rides_through_as_one_flag() {
        let args = serve_args(
            Path::new("t.json"),
            Path::new("b"),
            "claude_code",
            Some("  scratch/gated-round.jsonl  "),
        );
        let i = args.iter().position(|a| a == "--script").expect("--script");
        assert_eq!(args[i + 1], "scratch/gated-round.jsonl", "trimmed, not quoted");
        // An empty variable is not a request for an empty path.
        for blank in ["", "   "] {
            let args = serve_args(Path::new("t.json"), Path::new("b"), "claude_code", Some(blank));
            assert!(!args.iter().any(|a| a == "--script"), "{blank:?} -> {args:?}");
        }
    }

    // -- `/health` -------------------------------------------------------------------------------

    #[test]
    fn the_engine_probe_is_read_off_the_health_body() {
        let body = r#"{"ok": true, "engines": [
            {"id": "claude_code", "state": "found", "detail": "2.1.268 (Claude Code)"},
            {"id": "codex", "state": "not_found", "detail": "codex is not on PATH"}
        ]}"#;
        let engines = engines_of(body).expect("a list");
        assert_eq!(
            engines,
            vec![
                EngineProbe {
                    id: "claude_code".to_string(),
                    state: "found".to_string(),
                    detail: "2.1.268 (Claude Code)".to_string(),
                },
                EngineProbe {
                    id: "codex".to_string(),
                    state: "not_found".to_string(),
                    detail: "codex is not on PATH".to_string(),
                },
            ]
        );
    }

    #[test]
    fn a_probe_that_has_not_answered_is_not_an_empty_list() {
        // Three ways to know nothing, and all three are `None`: an empty list would claim the
        // probe answered and found no engine, which is a sentence the Setup wizard shows.
        for body in [
            r#"{"ok": true, "engines": null}"#,
            r#"{"ok": true}"#,
            "not json at all",
        ] {
            assert_eq!(engines_of(body), None, "{body:?}");
        }
        assert_eq!(engines_of(r#"{"engines": []}"#), Some(vec![]));
    }

    #[test]
    fn the_body_is_what_follows_the_blank_line() {
        let crlf = "Content-Type: application/json\r\n\r\n{\"ok\": true}";
        assert_eq!(body_of(crlf), "{\"ok\": true}");
        assert_eq!(body_of("Content-Length: 0\r\n\r\n"), "");
        assert_eq!(body_of("headers with no end"), "");
    }

    // -- the dev fallback's root -----------------------------------------------------------------

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("athena-sidecar-tests").join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    #[test]
    fn a_strangers_python_project_is_not_a_fallback_root() {
        let dir = scratch("stranger");
        std::fs::write(dir.join("pyproject.toml"), "[project]\nname='not-athena'\n").unwrap();
        assert!(
            !is_athena_checkout(&dir),
            "any pyproject.toml must not qualify: the fallback runs `uv run` there"
        );
    }

    #[test]
    fn this_repository_is_a_fallback_root() {
        let dir = scratch("checkout");
        std::fs::write(dir.join("pyproject.toml"), "[project]\nname='athena'\n").unwrap();
        std::fs::create_dir_all(dir.join("src").join("athena")).unwrap();
        std::fs::write(dir.join("src").join("athena").join("cli.py"), "").unwrap();
        assert!(is_athena_checkout(&dir));
    }

    // -- the token file ------------------------------------------------------------------------

    #[test]
    fn the_token_file_is_what_resolve_token_reads() {
        let dir = scratch("token");
        let path = dir.join("daemon.json");
        let token = mint_token();
        assert_eq!(token.len(), 64, "32 bytes, hex");
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
        write_token_file(&path, &token).expect("write");
        let text = std::fs::read_to_string(&path).expect("read");
        let json: serde_json::Value = serde_json::from_str(&text).expect("json");
        assert_eq!(json["token"], serde_json::Value::String(token));
    }

    #[test]
    fn two_tokens_are_two_tokens() {
        assert_ne!(mint_token(), mint_token());
    }

    // -- the health probe ----------------------------------------------------------------------

    #[test]
    fn the_status_line_is_read_and_nothing_else_is() {
        assert_eq!(status_code("HTTP/1.1 200 OK\r\n"), Some(200));
        assert_eq!(status_code("HTTP/1.0 401 Unauthorized"), Some(401));
        assert_eq!(status_code(""), None);
        assert_eq!(status_code("hello\r\n"), None);
    }

    #[test]
    fn health_sends_the_token_and_reads_the_code() {
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (socket, _) = listener.accept().expect("accept");
            let mut reader = BufReader::new(socket.try_clone().expect("clone"));
            let mut head = String::new();
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                    break;
                }
                head.push_str(&line);
            }
            let mut socket = socket;
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")
                .expect("write");
            head
        });

        let (code, body) = health_once(&url, "deadbeef", Duration::from_secs(5)).expect("a code");
        assert_eq!(code, 200);
        // The body comes back rather than being dropped: the engine probe rides on it.
        assert_eq!(body, "{}");
        let head = server.join().expect("server");
        assert!(head.starts_with("GET /health HTTP/1.1"), "{head}");
        assert!(head.contains("X-Athena-Token: deadbeef"), "{head}");
        assert!(head.contains("Connection: close"), "{head}");
    }

    // -- exit hygiene --------------------------------------------------------------------------

    /// The property the whole module exists for: a process that dies without running any of our
    /// code still takes the daemon with it.
    ///
    /// `cmd /c ping` is a two-process tree on purpose — `cmd` is what goes in the job and `ping`
    /// is the grandchild that joins it, which is the shape a PyInstaller one-file binary has and
    /// the shape that survived every kill in the first build. Closing the job's last handle
    /// stands in for the shell being `taskkill /F`'ed: the kernel closes it either way.
    #[cfg(windows)]
    #[test]
    fn closing_the_job_takes_the_whole_tree() {
        let job = job::create().expect("a job object");
        let mut child = Command::new("cmd")
            .args(["/c", "ping", "-n", "30", "127.0.0.1"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn the sleeper");
        assert!(job::assign(job, child.id()), "the child must join the job");
        assert!(
            matches!(child.try_wait(), Ok(None)),
            "the sleeper must still be running before the job closes"
        );

        job::close(job);

        let deadline = Instant::now() + Duration::from_secs(1);
        loop {
            if matches!(child.try_wait(), Ok(Some(_))) {
                return;
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                panic!("the child outlived the job handle; KILL_ON_JOB_CLOSE did not apply");
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}
