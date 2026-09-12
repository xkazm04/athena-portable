//! Athena — the shell (README section 3.1, surfaces).
//!
//! One window, two kinds of child webview, and a Rust core that owns the tabs and every
//! rectangle. The window is module-first (README section 3.5): a thin bar, the selected module at
//! full width, and the browser is one module among them rather than the frame the rest live
//! inside.
//!
//! **How this file is meant to grow.** Five more Rust modules land in the next five commits —
//! `bridge.rs` (c19), `daemon.rs` (c20), `store.rs` (c21), `hands.rs` (c24), `tray.rs` (c27) —
//! and each of them needs a line in the same four places: `mod`, `.manage`, `invoke_handler`, and
//! a block in `setup`. Every one of those four places is marked with a `── registrations ──`
//! comment naming what goes there, so two people adding two modules on two branches collide on
//! two adjacent lines rather than on one list. That is deliberate: README section 9 names "seven
//! people editing one panel" as a risk, and this is the Rust half of the answer.

mod layout;
mod tabs;
// ── registrations: modules ────────────────────────────────────────────────────────────────────
// c19 `mod bridge;`  c20 `mod daemon;`  c21 `mod store;`  c24 `mod hands;`  c27 `mod tray;`
// ──────────────────────────────────────────────────────────────────────────────────────────────

use serde::Serialize;
use tauri::{AppHandle, Emitter, EventTarget, Manager, WebviewUrl, WindowEvent};

use layout::Selection;
use tabs::{Tab, Tabs};

/// The window every rectangle is measured in.
pub const MAIN_WINDOW: &str = "main";

/// The privileged webview: the module bar and the selected module. `capabilities/ui.json` grants
/// the app's commands by this label, and page webviews are granted nothing.
pub const CHROME_WEBVIEW: &str = "chrome";

/// Emit to the privileged webview only.
///
/// **Never `app.emit` in this crate.** `app.emit` broadcasts into the page webviews as well, and
/// a page webview is whatever site the user navigated to — from c20 the status event carries the
/// daemon's token, and the habit has to exist before the secret does.
pub fn ui_emit<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    let _ = app.emit_to(
        EventTarget::AnyLabel {
            label: CHROME_WEBVIEW.to_string(),
        },
        event,
        payload,
    );
}

// ==============================================================================================
// Commands. `rename_all = "snake_case"` so the wire names are the ones `lib/ipc.ts` spells,
// rather than Tauri's camelCase default. Every new command needs three edits: here, `build.rs`,
// and `capabilities/ui.json`.
// ==============================================================================================

#[tauri::command(rename_all = "snake_case")]
async fn tabs_create(app: AppHandle, url: String) -> Result<u32, String> {
    tabs::create(&app, &url)
}

#[tauri::command(rename_all = "snake_case")]
async fn tabs_close(app: AppHandle, id: u32) -> Result<(), String> {
    tabs::close(&app, id)
}

#[tauri::command(rename_all = "snake_case")]
async fn tabs_focus(app: AppHandle, id: u32) -> Result<(), String> {
    tabs::focus(&app, id)
}

#[tauri::command(rename_all = "snake_case")]
async fn tabs_navigate(app: AppHandle, id: u32, url: String) -> Result<(), String> {
    tabs::navigate(&app, id, &url)
}

#[tauri::command(rename_all = "snake_case")]
async fn tabs_list(app: AppHandle) -> Vec<Tab> {
    app.state::<Tabs>().list()
}

/// Which module the window is showing.
#[tauri::command(rename_all = "snake_case")]
async fn layout_module(app: AppHandle) -> String {
    app.state::<Selection>().get()
}

/// Select a module. Rust holds the selection because the rectangles depend on it; it knows only
/// that one id is `browser` and passes every other through untouched, so adding a module stays a
/// TypeScript change.
#[tauri::command(rename_all = "snake_case")]
async fn layout_select(app: AppHandle, module: String) -> Result<(), String> {
    if module.trim().is_empty() {
        return Err("a module id is required".to_string());
    }
    layout::select(&app, &module);
    Ok(())
}

// ── registrations: commands ───────────────────────────────────────────────────────────────────
// c19 bridge_list/bridge_call/bridge_reply · c20 daemon_status/daemon_restart
// c21 store_get/store_set/origins_* · c24 hands_call/screenshot_read · c27 tray_set_pending
// ──────────────────────────────────────────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .manage(Tabs::default())
        .manage(Selection::default())
        // ── registrations: state ──────────────────────────────────────────────────────────────
        // c19 `.manage(Bridge::default())` · c20 `.manage(Daemon::default())`
        // c21 `.manage(Store::open(..))` (in `setup`, it needs a path) · c27 `.manage(Tray::…)`
        // ──────────────────────────────────────────────────────────────────────────────────────
        .invoke_handler(tauri::generate_handler![
            tabs_create,
            tabs_close,
            tabs_focus,
            tabs_navigate,
            tabs_list,
            layout_module,
            layout_select,
            // ── registrations: handlers (keep one line per command, grouped by module) ────────
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            build_shell(&handle)?;

            // A start page, for launching the shell straight at something: the first non-flag
            // argument, else `ATHENA_START_URL`. Without either, the shell opens with no tab and
            // the strip's `+` is the way in. This is the dev affordance every later smoke run
            // points at a host app with, rather than driving the address field.
            if let Some(url) = start_url() {
                match tabs::create(&handle, &url) {
                    Ok(id) => eprintln!("[tabs] opened {url} as tab {id}"),
                    Err(e) => eprintln!("[tabs] cannot open {url}: {e}"),
                }
            }

            // ── registrations: setup ──────────────────────────────────────────────────────────
            // c20 spawns the daemon sidecar here and c27 builds the tray here; both are
            // non-fatal — the shell must come up even when they do not.
            // ──────────────────────────────────────────────────────────────────────────────────

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("cannot start Athena")
        .run(|_app, _event| {
            // ── registrations: exit ───────────────────────────────────────────────────────────
            // c20 kills the daemon's process tree on `ExitRequested | Exit` here. Nothing in c18
            // owns a child process, so there is nothing to clean up yet.
            // ──────────────────────────────────────────────────────────────────────────────────
        });
}

/// The URL to open at launch, if any. An argument wins over the environment variable, so a
/// shortcut and a shell session can each have their own answer.
fn start_url() -> Option<String> {
    if let Some(arg) = std::env::args().skip(1).find(|a| !a.starts_with('-')) {
        return Some(arg);
    }
    std::env::var("ATHENA_START_URL")
        .ok()
        .filter(|s| !s.is_empty())
}

/// One window, decorations off, with the chrome webview as its only child. Pages are added later,
/// one per tab.
///
/// The chrome is built at its **module-mode** geometry — the whole window — because that is what
/// the default selection means with no tab open yet, and `layout::apply` at the end is what makes
/// the first frame right whichever shape the shell actually comes up in.
fn build_shell(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let window = tauri::window::WindowBuilder::new(app, MAIN_WINDOW)
        .title("Athena")
        .inner_size(1440.0, 900.0)
        .min_inner_size(900.0, 600.0)
        .decorations(false)
        .center()
        .build()?;

    window.add_child(
        tauri::webview::WebviewBuilder::new(CHROME_WEBVIEW, WebviewUrl::App("chrome.html".into())),
        tauri::LogicalPosition::new(0.0, 0.0),
        tauri::LogicalSize::new(1440.0, 900.0),
    )?;

    let handle = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } = event {
            layout::apply(&handle);
        }
    });

    layout::apply(app);
    Ok(())
}
