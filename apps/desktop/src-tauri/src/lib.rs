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

mod companion;
mod halo;
mod hotkeys;
mod layout;
mod tabs;
mod tray;
// ── registrations: modules ────────────────────────────────────────────────────────────────────
// c19 `mod bridge;`  c20 `mod daemon;`  c21 `mod store;`  c24 `mod hands;`  c27 `mod tray;`
mod bridge;
mod capture;
mod daemon;
mod hands;
mod store;
// ──────────────────────────────────────────────────────────────────────────────────────────────

use serde::Serialize;
use tauri::{AppHandle, Emitter, EventTarget, Manager, WebviewUrl, WindowEvent};

use layout::Selection;
use tabs::{Tab, Tabs};

/// Leave the app. Both windows are hidden first so the user does not watch them tear down; the
/// exit hooks (the daemon's process tree) still run on `ExitRequested | Exit`.
pub fn quit(app: &AppHandle) {
    for label in [MAIN_WINDOW, companion::ATHENA_WINDOW] {
        if let Some(w) = app.get_window(label) {
            let _ = w.hide();
        }
    }
    app.exit(0);
}

/// The window every rectangle is measured in.
pub const MAIN_WINDOW: &str = "main";

/// The privileged webview: the module bar and the selected module. `capabilities/ui.json` grants
/// the app's commands by this label, and page webviews are granted nothing.
pub const CHROME_WEBVIEW: &str = "chrome";

/// The hands' page-world script, injected beside `inject.js` and the relay (README section 3.4).
///
/// `include_str!` rather than a copy, for the reason `INJECT_JS` is one: a second copy of a
/// capability is a second thing to keep correct, and the test that asserts the two halves declare
/// the same eight names reads this one.
pub fn hands_script() -> &'static str {
    include_str!("hands.js")
}

/// Run one generic hand on one tab (README section 3.4 tier 2).
///
/// Never `Err`: a hand that rejected would reach the panel as a thrown promise rather than as a
/// tool result the model can read, and a refusal the model cannot read is one it will make again.
/// The gate has already allowed this call; the shell carries it.
#[tauri::command]
async fn hands_call(
    app: AppHandle,
    tab_id: u32,
    name: String,
    input: serde_json::Value,
) -> hands::HandResult {
    hands::call(&app, tab_id, &name, input).await
}

/// The hands, shaped exactly as `inject.js` reports a page's own tools.
///
/// The panel appends these to whatever the page listed and hands the one list to `gate.js`'s
/// `manifestOf`, so a hand and a page tool are classified by the same derivation.
#[tauri::command]
fn hands_list() -> Vec<serde_json::Value> {
    hands::webmcp_tools()
}

/// Emit to the privileged webviews only: the chrome and the Athena window.
///
/// **Never `app.emit` in this crate.** `app.emit` broadcasts into the page webviews as well, and
/// a page webview is whatever site the user navigated to - from c20 the status event carries the
/// daemon's token, and the habit has to exist before the secret does. ADR 0026 adds a second
/// privileged label; it does not add a way to reach a page. ADR 0027's `halo-*` overlays are
/// privileged too but listen-only (`capabilities/halo.json` grants events and no command): they
/// are reached with `ui_emit_to` by label, from `halo.rs`, and never from here.
pub fn ui_emit<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    for label in [CHROME_WEBVIEW, companion::ATHENA_WINDOW] {
        ui_emit_to(app, label, event, payload.clone());
    }
}

/// Emit to one privileged label (`chrome`, `athena` or a `halo-*`), for an event only it hears.
pub fn ui_emit_to<S: Serialize + Clone>(app: &AppHandle, label: &str, event: &str, payload: S) {
    let _ = app.emit_to(
        EventTarget::AnyLabel {
            label: label.to_string(),
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
// c21 store_get/store_set/origins_* · c24 hands_call/hands_list · c27 tray_set_pending
// c24 has no command of its own for reading a capture back: `page_screenshot` answers with the
// `captures` row id and `store_get("captures", id)` is the read. A second command would be a
// second way to reach one table.
// c19: the three are declared in `bridge.rs` beside the state they read, and registered below.
// c20: `daemon.rs` declares its own two commands beside the state they read, so the only line
// this file needs for them is the pair in the handler list below (ADR 0015).
// c21's six are `store.rs`'s own `pub` functions — one table description, not one command per
// table — so they are named in the handler list below rather than wrapped here.
// ──────────────────────────────────────────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .manage(Tabs::default())
        .manage(Selection::default())
        .manage(companion::Companion::default())
        .manage(halo::Halo::default())
        // ── registrations: state ──────────────────────────────────────────────────────────────
        // c19 `.manage(Bridge::default())` · c20 `.manage(Daemon::default())`
        // c21 `.manage(Store::open(..))` (in `setup`, it needs a path) · c27 `.manage(Tray::…)`
        .manage(bridge::Bridge::default())
        .manage(daemon::Daemon::default())
        // c21: `store::init` manages it from `setup`, where the app data path is resolvable.
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
            bridge::bridge_list,
            bridge::bridge_call,
            bridge::bridge_reply,
            daemon::daemon_status,
            daemon::daemon_restart,
            store::store_get,
            store::store_set,
            store::store_list,
            store::store_delete,
            store::store_path,
            store::captures_sweep,
            hands_call,
            hands_list,
            companion::athena_set_size,
            companion::athena_show,
            companion::athena_hide,
            companion::athena_pin,
            companion::athena_report,
            companion::athena_snap_to,
            companion::athena_open_main,
            halo::athena_halo,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // The store comes first: whether this is a first launch decides which window the
            // user sees, and the store is what knows (`settings.onboarded`).
            store::init(&handle);
            let first_launch = is_first_launch(&handle);
            build_shell(&handle, first_launch)?;
            if let Err(e) = companion::build(&handle, first_launch) {
                eprintln!("[companion] cannot build her window: {e}");
            }
            // ADR 0027: one hidden, click-through overlay per monitor. Non-fatal inside.
            halo::build(&handle);
            if let Err(e) = tray::build(&handle) {
                eprintln!("[tray] not built: {e}");
            }
            hotkeys::init(&handle);
            companion::show(&handle);

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
            bridge::smoke_if_asked(&handle);
            // c24's own smoke: one page hand and the shell's capture, against a real window.
            hands::smoke_if_asked(&handle);
            daemon::start_at_launch(&handle);
            // ──────────────────────────────────────────────────────────────────────────────────

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("cannot start Athena")
        .run(|_app, _event| {
            // ── registrations: exit ───────────────────────────────────────────────────────────
            // c20 kills the daemon's process tree on `ExitRequested | Exit` here. Nothing in c18
            // owns a child process, so there is nothing to clean up yet.
            daemon::on_app_event(_app, &_event);
            // ──────────────────────────────────────────────────────────────────────────────────
        });
}

/// `true` until the Setup wizard has been finished once (`settings.onboarded`). An unreadable
/// store counts as a first launch: showing her welcome is the recoverable mistake.
fn is_first_launch(app: &AppHandle) -> bool {
    match store::opened(app).and_then(|s| s.get("settings", "onboarded")) {
        Ok(serde_json::Value::Bool(b)) => !b,
        Ok(serde_json::Value::String(s)) => s != "true",
        _ => true,
    }
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
///
/// **On first launch Main is built hidden** (ADR 0026): the only window the user sees is Athena at
/// `welcome`, and "Open your first app" is what shows Main (`companion::after_onboarded`).
fn build_shell(app: &AppHandle, first_launch: bool) -> Result<(), Box<dyn std::error::Error>> {
    // 1440x900 can exceed a 1080p work area at 150%: size to the primary monitor's work area.
    let start = app.primary_monitor().ok().flatten().map(|m| {
        let scale = m.scale_factor();
        let a = m.work_area();
        companion::main_start_rect(&layout::Rect {
            x: a.position.x as f64 / scale,
            y: a.position.y as f64 / scale,
            width: a.size.width as f64 / scale,
            height: a.size.height as f64 / scale,
        })
    });
    let builder = tauri::window::WindowBuilder::new(app, MAIN_WINDOW)
        .title("Athena")
        .min_inner_size(companion::MAIN_MIN.0, companion::MAIN_MIN.1)
        .decorations(false)
        .visible(!first_launch);
    let builder = match start {
        Some(r) => builder.inner_size(r.width, r.height).position(r.x, r.y),
        None => builder
            .inner_size(companion::MAIN_WIDE.0, companion::MAIN_WIDE.1)
            .center(),
    };
    let window = builder.build()?;

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
        // Closing Main quits the app: she is off the taskbar, so a Main that closed and left her
        // running would leave nothing to find her by but the tray.
        if let WindowEvent::CloseRequested { .. } = event {
            quit(&handle);
        }
        companion::on_main_event(&handle, event);
    });

    layout::apply(app);
    Ok(())
}
