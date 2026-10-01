//! The global chords (ADR 0026, README section 3.1; relaxes the chrome-only half of ADR 0020).
//!
//! Push-to-talk stays a held key inside her window. What is global is the smallest set that lets a
//! person answer a decision without leaving what they are doing: `Ctrl+Shift+Space` brings her
//! back at any time, and `Ctrl+Alt+A` / `Ctrl+Alt+D` exist **only while a card waits**, so the
//! app never holds two keys nobody is being asked about.
//!
//! The manager lives on the main thread, because the OS delivers a hotkey to the thread that
//! registered it; every call in from elsewhere goes through `run_on_main_thread`.

use std::cell::RefCell;

use global_hotkey::hotkey::{Code, HotKey, Modifiers};
use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};
use tauri::AppHandle;

use crate::companion;

thread_local! {
    static MANAGER: RefCell<Option<GlobalHotKeyManager>> = const { RefCell::new(None) };
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
    GlobalHotKeyEvent::set_event_handler(Some(move |event: GlobalHotKeyEvent| {
        if event.state != HotKeyState::Pressed {
            return;
        }
        if event.id == summon().id() {
            companion::show(&events);
        } else if event.id == approve().id() {
            companion::chord(&events, "approve");
        } else if event.id == decline().id() {
            companion::chord(&events, "decline");
        }
    }));
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
}
