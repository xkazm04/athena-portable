//! What the shell remembers between launches (README §5 phase P4: "store + Settings + Setup").
//!
//! A small JSON file, written whole. Not SQLite and not the brain: none of this is a memory. The
//! brain is portable by copying its directory (invariant 1), and a window size or a chosen engine
//! travelling with it would make a brain carry one machine's preferences to another.
//!
//! Reading is total. A settings file that was hand-edited into something unparseable must not stop
//! the shell from starting — the defaults are a working configuration, and a user who has lost
//! their window size can set it again in a second. Writing is atomic: a temporary file beside the
//! target and a rename, so a crash mid-write leaves the previous settings rather than half of the
//! new ones.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// The engine names `harness.engines.ENGINES` offers, spelled as the daemon spells them.
pub const ENGINES: [&str; 2] = ["claude_code", "codex"];

fn default_engine() -> String {
    ENGINES[0].to_string()
}

fn default_width() -> f64 {
    1440.0
}

fn default_height() -> f64 {
    900.0
}

fn default_home() -> String {
    "https://github.com".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Settings {
    /// Which CLI the daemon should run turns through. Never a key: there is no key to store.
    pub engine: String,
    /// The model id, or empty for the engine's own default.
    pub model: String,
    /// Where the brain lives, or empty for `ATHENA_HOME`.
    pub brain_root: String,
    pub window_width: f64,
    pub window_height: f64,
    /// Where a new tab starts.
    pub home_url: String,
    /// Tabs to reopen on launch, in order.
    pub tabs: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            engine: default_engine(),
            model: String::new(),
            brain_root: String::new(),
            window_width: default_width(),
            window_height: default_height(),
            home_url: default_home(),
            tabs: Vec::new(),
        }
    }
}

impl Settings {
    /// Every problem with these settings, as a person would fix them. Empty means usable.
    pub fn problems(&self) -> Vec<String> {
        let mut out = Vec::new();
        if !ENGINES.contains(&self.engine.as_str()) {
            out.push(format!(
                "engine must be one of {}: {:?}",
                ENGINES.join(", "),
                self.engine
            ));
        }
        if self.window_width <= 0.0 || self.window_height <= 0.0 {
            out.push("the window size must be positive".to_string());
        }
        out
    }

    /// These settings with anything unusable replaced by its default, so the shell always starts.
    pub fn repaired(mut self) -> Self {
        let fallback = Settings::default();
        if !ENGINES.contains(&self.engine.as_str()) {
            self.engine = fallback.engine;
        }
        if self.window_width <= 0.0 {
            self.window_width = fallback.window_width;
        }
        if self.window_height <= 0.0 {
            self.window_height = fallback.window_height;
        }
        if self.home_url.trim().is_empty() {
            self.home_url = fallback.home_url;
        }
        self
    }
}

/// The settings on disk, or the defaults. Never fails: see the module docstring.
pub fn load(path: &Path) -> Settings {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Settings>(&text).ok())
        .unwrap_or_default()
        .repaired()
}

/// Write settings atomically: a temporary file beside the target, then a rename.
pub fn save(path: &Path, settings: &Settings) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = temp_beside(path);
    fs::write(&temporary, serde_json::to_vec_pretty(settings)?)?;
    // Windows will not rename onto an existing file, so the old one goes first. The window
    // between the two is why the temporary file is written first and not last.
    let _ = fs::remove_file(path);
    fs::rename(&temporary, path)
}

fn temp_beside(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".tmp");
    path.with_file_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("athena-store-tests");
        fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    #[test]
    fn the_defaults_are_a_working_configuration() {
        let settings = Settings::default();
        assert!(settings.problems().is_empty());
        assert_eq!(settings.engine, "claude_code");
    }

    #[test]
    fn a_missing_file_reads_as_the_defaults() {
        let path = scratch("nothing-here.json");
        let _ = fs::remove_file(&path);
        assert_eq!(load(&path), Settings::default());
    }

    #[test]
    fn a_corrupt_file_reads_as_the_defaults_rather_than_stopping_the_shell() {
        let path = scratch("corrupt.json");
        fs::write(&path, b"{ this is not json").unwrap();
        assert_eq!(load(&path), Settings::default());
    }

    #[test]
    fn a_settings_file_with_an_unknown_engine_is_repaired_not_refused() {
        let path = scratch("unknown-engine.json");
        fs::write(&path, br#"{"engine":"gpt-9","window_width":1200}"#).unwrap();

        let settings = load(&path);

        assert_eq!(settings.engine, "claude_code");
        assert_eq!(settings.window_width, 1200.0);
    }

    #[test]
    fn a_round_trip_keeps_everything() {
        let path = scratch("round-trip.json");
        let settings = Settings {
            engine: "codex".into(),
            model: "o4".into(),
            brain_root: "C:/brains/one".into(),
            window_width: 1600.0,
            window_height: 1000.0,
            home_url: "https://invoices.example".into(),
            tabs: vec!["https://invoices.example".into()],
        };

        save(&path, &settings).unwrap();

        assert_eq!(load(&path), settings);
    }

    #[test]
    fn saving_twice_leaves_one_file_and_no_temporary() {
        let path = scratch("twice.json");
        save(&path, &Settings::default()).unwrap();
        save(&path, &Settings::default()).unwrap();

        assert!(path.exists());
        assert!(!temp_beside(&path).exists());
    }

    #[test]
    fn a_negative_window_is_a_problem_and_is_repaired() {
        let broken = Settings {
            window_width: -10.0,
            ..Settings::default()
        };
        assert!(!broken.problems().is_empty());
        assert_eq!(broken.repaired().window_width, 1440.0);
    }
}
