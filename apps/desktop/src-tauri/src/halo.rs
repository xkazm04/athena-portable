//! The halo: one click-through overlay per monitor whose edges show what she is doing (ADR 0027,
//! "Athena is ambient", README section 3.1).
//!
//! Each monitor gets a `halo-<i>` window at the monitor's **full** bounds (not the work area: the
//! glow runs along the screen's edge, under the taskbar's too). It is transparent, frameless,
//! topmost, off the taskbar, never focusable and ignores the cursor, so it is something to look
//! at and never something in the way. On Windows the extended style also carries
//! `WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW`, because a webview
//! that merely draws transparent pixels still takes clicks there (ADR 0026's reason for her window
//! hugging its drawing).
//!
//! **One producer.** The `athena` window owns the voice and the run, reduces them to a
//! `HaloSignal` (`src/lib/halo-signal.ts`) and calls `athena_halo`; this file validates it and
//! fans it out as `halo:signal` to every `halo-*` label with `ui_emit_to`. The overlays hold no
//! store and call nothing: `capabilities/halo.json` grants them events alone.
//!
//! **Up while anything is happening.** A non-idle phase or a waiting card shows every halo
//! without activating it; an idle signal hides them after [`HIDE_AFTER`], unless a newer signal
//! arrived in the meantime. The decisions are pure and tested below.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder, Window};

/// Every overlay's label starts with this; `capabilities/halo.json` names `halo-*`.
pub const HALO_PREFIX: &str = "halo-";

/// The event the overlays listen for. The page spells it `HALO_EVENT`.
pub const HALO_EVENT: &str = "halo:signal";

/// How long an idle halo lingers before it is hidden: the page holds the last caption 4 s after
/// speaking ends and fades the edges over 400 ms, so a hide any sooner would cut the caption off.
pub const HIDE_AFTER: Duration = Duration::from_millis(4500);

/// What the edges show. The page's `HALO_PHASES`, in the same order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Idle,
    Listening,
    Thinking,
    Speaking,
    Gate,
}

impl Phase {
    /// Parse the wire spelling; anything else is refused with the name it was given.
    pub fn parse(s: &str) -> Result<Self, String> {
        Ok(match s {
            "idle" => Phase::Idle,
            "listening" => Phase::Listening,
            "thinking" => Phase::Thinking,
            "speaking" => Phase::Speaking,
            "gate" => Phase::Gate,
            _ => return Err(format!("unknown halo phase \"{s}\"")),
        })
    }
}

/// Who is speaking in a caption.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Who {
    You,
    Athena,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Caption {
    pub who: Who,
    pub text: String,
}

/// The signal as it arrives: the phase is a string until [`Signal::parse`] has looked at it.
#[derive(Clone, Debug, Deserialize)]
pub struct RawSignal {
    pub phase: String,
    pub level: f64,
    pub cards: u32,
    pub caption: Option<Caption>,
}

/// One frame of the halo: the Rust mirror of `HaloSignal`. `caption` serialises as `null`, never
/// absent, as the page's contract spells it.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Signal {
    pub phase: Phase,
    pub level: f64,
    pub cards: u32,
    pub caption: Option<Caption>,
}

impl Signal {
    /// Validate a raw signal: an unknown phase is an error, the level is clamped into 0..1 (a
    /// non-number is 0, so the overlay never draws a NaN-thick edge).
    pub fn parse(raw: RawSignal) -> Result<Self, String> {
        let level = if raw.level.is_finite() { raw.level.clamp(0.0, 1.0) } else { 0.0 };
        Ok(Self { phase: Phase::parse(&raw.phase)?, level, cards: raw.cards, caption: raw.caption })
    }
}

/// Should the halos be on screen for this signal? Anything happening, or any card waiting.
pub fn wants_visible(signal: &Signal) -> bool {
    signal.phase != Phase::Idle || signal.cards > 0
}

/// A hide scheduled at generation `scheduled` still applies only if no signal came after it.
pub fn hide_still_due(scheduled: u64, current: u64) -> bool {
    scheduled == current
}

/// The halo's managed state: the signal generation and whether the overlays are up.
#[derive(Debug, Default)]
pub struct Halo {
    generation: AtomicU64,
    shown: AtomicBool,
}

// ==============================================================================================
// The windows. Everything above is pure; everything below touches a real window.
// ==============================================================================================

fn halos(app: &AppHandle) -> Vec<(String, Window)> {
    app.windows().into_iter().filter(|(label, _)| label.starts_with(HALO_PREFIX)).collect()
}

/// Build one hidden overlay per monitor. Non-fatal throughout: a monitor that cannot get a halo
/// is reported and the rest carry on, because the halo is a courtesy and her window is the truth.
pub fn build(app: &AppHandle) {
    let monitors = match app.available_monitors() {
        Ok(m) if !m.is_empty() => m,
        _ => app.primary_monitor().ok().flatten().into_iter().collect(),
    };
    if monitors.is_empty() {
        eprintln!("[halo] no monitor to put a halo on");
        return;
    }
    for (i, monitor) in monitors.iter().enumerate() {
        let label = format!("{HALO_PREFIX}{i}");
        let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("halo.html".into()))
            .title("Athena halo")
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .focusable(false)
            .visible(false)
            .build();
        if let Err(e) = built {
            eprintln!("[halo] {label} not built: {e}");
            continue;
        }
        let Some(window) = app.get_window(&label) else { continue };
        // Physical, after the build: the builder speaks logical pixels in the scale of whichever
        // monitor it lands on, and a halo has to cover its own monitor exactly.
        let (p, s) = (monitor.position(), monitor.size());
        let _ = window.set_position(PhysicalPosition::new(p.x, p.y));
        let _ = window.set_size(PhysicalSize::new(s.width, s.height));
        if let Err(e) = window.set_ignore_cursor_events(true) {
            eprintln!("[halo] {label} is not click-through: {e}");
        }
        pass_through(&label, &window);
    }
}

/// OR the click-through and never-activate bits into the window's extended style.
#[cfg(all(windows, target_pointer_width = "64"))]
fn pass_through(label: &str, window: &Window) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_NOACTIVATE,
        WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
    };
    match window.hwnd() {
        Ok(hwnd) => unsafe {
            let hwnd = hwnd.0 as _;
            let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let wanted = (WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW) as isize;
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | wanted);
        },
        Err(e) => eprintln!("[halo] {label} has no window handle: {e}"),
    }
}

#[cfg(not(all(windows, target_pointer_width = "64")))]
fn pass_through(_label: &str, _window: &Window) {}

fn show_all(app: &AppHandle) {
    for (_, window) in halos(app) {
        crate::companion::show_no_activate(&window);
    }
}

fn hide_all(app: &AppHandle) {
    for (_, window) in halos(app) {
        let _ = window.hide();
    }
}

/// Fan a signal out to every overlay, and show or (later) hide them.
pub fn signal(app: &AppHandle, signal: &Signal) {
    for (label, _) in halos(app) {
        crate::ui_emit_to(app, &label, HALO_EVENT, signal.clone());
    }
    let halo = app.state::<Halo>();
    let generation = halo.generation.fetch_add(1, Ordering::SeqCst) + 1;
    if wants_visible(signal) {
        if !halo.shown.swap(true, Ordering::SeqCst) {
            show_all(app);
        }
        return;
    }
    if !halo.shown.load(Ordering::SeqCst) {
        return;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(HIDE_AFTER);
        let halo = handle.state::<Halo>();
        if hide_still_due(generation, halo.generation.load(Ordering::SeqCst)) {
            halo.shown.store(false, Ordering::SeqCst);
            hide_all(&handle);
        }
    });
}

// ==============================================================================================
// Commands. Each needs three edits: here, `build.rs`, and `capabilities/athena.json`.
// ==============================================================================================

/// The `athena` window's one way to drive the halo. An unknown phase is refused, not drawn.
#[tauri::command(rename_all = "snake_case")]
pub async fn athena_halo(app: AppHandle, signal: RawSignal) -> Result<(), String> {
    let parsed = Signal::parse(signal)?;
    self::signal(&app, &parsed);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(phase: &str, level: f64, cards: u32) -> RawSignal {
        RawSignal { phase: phase.to_string(), level, cards, caption: None }
    }

    #[test]
    fn every_phase_the_page_names_parses_and_an_unknown_one_is_an_error_string() {
        for p in ["idle", "listening", "thinking", "speaking", "gate"] {
            let s = Signal::parse(raw(p, 0.0, 0)).expect("a known phase");
            assert_eq!(serde_json::to_value(s.phase).unwrap(), serde_json::json!(p));
        }
        let err = Signal::parse(raw("dancing", 0.0, 0)).unwrap_err();
        assert!(err.contains("dancing"), "the error names what it was given: {err}");
    }

    #[test]
    fn the_level_is_clamped_into_zero_to_one() {
        assert_eq!(Signal::parse(raw("speaking", 1.7, 0)).unwrap().level, 1.0);
        assert_eq!(Signal::parse(raw("speaking", -0.2, 0)).unwrap().level, 0.0);
        assert_eq!(Signal::parse(raw("speaking", f64::NAN, 0)).unwrap().level, 0.0);
        assert_eq!(Signal::parse(raw("speaking", 0.4, 0)).unwrap().level, 0.4);
    }

    #[test]
    fn the_wire_shape_round_trips_with_a_null_caption_and_a_spoken_one() {
        let incoming = serde_json::json!({
            "phase": "listening", "level": 0.5, "cards": 2,
            "caption": { "who": "you", "text": "open the invoice" },
        });
        let s = Signal::parse(serde_json::from_value(incoming.clone()).unwrap()).unwrap();
        assert_eq!(serde_json::to_value(&s).unwrap(), incoming);

        let quiet = Signal::parse(raw("idle", 0.0, 0)).unwrap();
        assert_eq!(serde_json::to_value(&quiet).unwrap()["caption"], serde_json::Value::Null);

        let bad_who = serde_json::json!({
            "phase": "idle", "level": 0, "cards": 0, "caption": { "who": "them", "text": "" },
        });
        assert!(serde_json::from_value::<RawSignal>(bad_who).is_err());
    }

    #[test]
    fn anything_happening_or_a_waiting_card_shows_the_halo_and_idle_with_none_does_not() {
        for p in ["listening", "thinking", "speaking", "gate"] {
            assert!(wants_visible(&Signal::parse(raw(p, 0.0, 0)).unwrap()), "{p} shows");
        }
        assert!(wants_visible(&Signal::parse(raw("idle", 0.0, 1)).unwrap()), "a waiting card shows");
        assert!(!wants_visible(&Signal::parse(raw("idle", 0.0, 0)).unwrap()));
    }

    #[test]
    fn an_idle_hide_applies_only_if_no_newer_signal_arrived() {
        assert!(hide_still_due(7, 7));
        assert!(!hide_still_due(7, 8), "a later signal cancels the hide");
    }

    /// The page holds the last caption 4 s and then fades over 400 ms; the hide must outlast both.
    #[test]
    fn the_idle_hide_outlasts_the_pages_caption_hold_and_fade() {
        assert!(HIDE_AFTER >= Duration::from_millis(4000 + 400));
    }
}
