//! The global chords (ADR 0026, README section 3.1; relaxes the chrome-only half of ADR 0020;
//! ADR 0027 makes the summon chord push-to-talk too).
//!
//! What is global is the smallest set that lets a person answer a decision, or talk to her,
//! without leaving what they are doing: `Ctrl+Shift+Space` brings her back at any time, and
//! `Ctrl+Alt+A` / `Ctrl+Alt+D` exist **only while a card waits**, so the app never holds two keys
//! nobody is being asked about.
//!
//! **A tap summons, a hold talks.** ADR 0026 kept push-to-talk a held key in her window; ADR 0027
//! relaxes that: the summon chord held for [`HOLD_THRESHOLD`] is push-to-talk from anywhere. A
//! timer started on the press decides "held" while the key is still down and sends
//! `athena:ptt {down: true}`; the release then sends `{down: false}`. A release before the timer
//! is a tap and summons her as before. The answer chords still act on the press alone.
//!
//! The manager lives on the main thread, because the OS delivers a hotkey to the thread that
//! registered it; every call in from elsewhere goes through `run_on_main_thread`.

use std::cell::RefCell;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use global_hotkey::hotkey::{Code, HotKey, Modifiers};
use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};
use tauri::AppHandle;

use crate::companion;

thread_local! {
    static MANAGER: RefCell<Option<GlobalHotKeyManager>> = const { RefCell::new(None) };
}

/// How long the summon chord has to be held before it is push-to-talk rather than a tap.
pub const HOLD_THRESHOLD: Duration = Duration::from_millis(250);

/// What a press of the summon chord was, by how long it was held.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Press {
    Tap,
    Hold,
}

pub fn classify(held: Duration) -> Press {
    if held >= HOLD_THRESHOLD {
        Press::Hold
    } else {
        Press::Tap
    }
}

/// The summon chord's press, between its `Pressed` and its `Released`.
#[derive(Debug, Default)]
struct Chord {
    /// When the current press started, and which press it is; `None` while the key is up.
    down: Option<(Instant, u64)>,
    presses: u64,
    /// The hold timer fired while the key was down and `{down: true}` went out.
    talking: bool,
}

fn summon() -> HotKey {
    HotKey::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space)
}
fn approve() -> HotKey {
    HotKey::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyA)
}
fn decline() -> HotKey {
    HotKey::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyD)
}

/// Register the always-on chord and route every chord to the companion. Non-fatal: a chord another
/// app already owns is reported and the app carries on, because the window has a mouse too.
pub fn init(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let manager = match GlobalHotKeyManager::new() {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[hotkeys] unavailable: {e}");
                return;
            }
        };
        if let Err(e) = manager.register(summon()) {
            eprintln!("[hotkeys] Ctrl+Shift+Space not registered: {e}");
        }
        MANAGER.with(|m| *m.borrow_mut() = Some(manager));
    });
    let events = handle.clone();
    let chord = Arc::new(Mutex::new(Chord::default()));
    GlobalHotKeyEvent::set_event_handler(Some(move |event: GlobalHotKeyEvent| {
        if event.id == summon().id() {
            match event.state {
                HotKeyState::Pressed => summon_pressed(&events, &chord),
                HotKeyState::Released => summon_released(&events, &chord),
            }
            return;
        }
        if event.state != HotKeyState::Pressed {
            return;
        }
        if event.id == approve().id() {
            companion::chord(&events, "approve");
        } else if event.id == decline().id() {
            companion::chord(&events, "decline");
        }
    }));
}

/// The summon chord went down. A second `Pressed` while it is already down is ignored: the
/// registration asks for no auto-repeat (`MOD_NOREPEAT` in global-hotkey 0.8), but a repeat must
/// never start a second timer. The emits happen under the lock so a timer and a release can never
/// send `down` and `up` out of order.
fn summon_pressed(app: &AppHandle, chord: &Arc<Mutex<Chord>>) {
    let press = {
        let mut c = chord.lock().expect("chord poisoned");
        if c.down.is_some() {
            return;
        }
        c.presses += 1;
        c.talking = false;
        c.down = Some((Instant::now(), c.presses));
        c.presses
    };
    let (app, chord) = (app.clone(), chord.clone());
    std::thread::spawn(move || {
        std::thread::sleep(HOLD_THRESHOLD);
        let mut c = chord.lock().expect("chord poisoned");
        let Some((at, id)) = c.down else { return };
        if id == press && classify(at.elapsed()) == Press::Hold {
            c.talking = true;
            companion::ptt(&app, true);
        }
    });
}

/// The summon chord came up: the end of a talk, or a tap. A `Released` with no press behind it
/// (global-hotkey sends one per `WM_HOTKEY` it saw) is ignored.
fn summon_released(app: &AppHandle, chord: &Arc<Mutex<Chord>>) {
    let mut c = chord.lock().expect("chord poisoned");
    if c.down.take().is_none() {
        return;
    }
    if std::mem::take(&mut c.talking) {
        companion::ptt(app, false);
    } else {
        drop(c);
        companion::show(app);
    }
}

/// Register the answer chords while a card waits, and release them when none does.
pub fn set_card_chords(app: &AppHandle, on: bool) {
    let _ = app.run_on_main_thread(move || {
        MANAGER.with(|m| {
            let guard = m.borrow();
            let Some(manager) = guard.as_ref() else { return };
            for key in [approve(), decline()] {
                let result = if on { manager.register(key) } else { manager.unregister(key) };
                if let Err(e) = result {
                    // Registering twice and unregistering what was never registered are both
                    // expected when the count moves 1 to 2; anything else is worth a line.
                    eprintln!("[hotkeys] {}: {e}", if on { "register" } else { "unregister" });
                }
            }
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The three chords must never collide, or one key would answer two questions.
    #[test]
    fn the_three_chords_have_three_different_ids() {
        let ids = [summon().id(), approve().id(), decline().id()];
        assert_ne!(ids[0], ids[1]);
        assert_ne!(ids[1], ids[2]);
        assert_ne!(ids[0], ids[2]);
    }

    #[test]
    fn a_press_under_the_threshold_is_a_tap_and_one_at_or_over_it_is_a_hold() {
        assert_eq!(classify(Duration::ZERO), Press::Tap);
        assert_eq!(classify(Duration::from_millis(249)), Press::Tap);
        assert_eq!(classify(Duration::from_millis(250)), Press::Hold);
        assert_eq!(classify(Duration::from_secs(2)), Press::Hold);
    }
}
