//! Athena's desktop shell: one window, the page webviews and the panel (README §3.1 surfaces).
//!
//! The shell owns three things and no policy at all.
//!
//! 1. **The window.** A panel column on the right and a page webview filling the rest
//!    (`layout`). Several webviews in one window is why the `unstable` Tauri feature is on: a tab
//!    that had to be its own OS window would not be a browser, it would be a window manager.
//! 2. **The sidecar.** The Python daemon, started before the window is shown, killed with the
//!    process tree on the way out (`daemon`).
//! 3. **The relay.** The shell's half of the bridge, carrying `list` and `call` between the panel
//!    and whatever the page registered (`bridge`).
//!
//! Every decision belongs to the daemon behind it. The shell does not classify a tool, does not
//! decide whether a card is needed, and never runs a page's tool that the gate has not allowed —
//! it is told to, by a `tool.call` on the stream or by an instruction from a resolved approval.

pub mod bridge;
pub mod daemon;
pub mod layout;
pub mod store;
pub mod tabs;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::{Emitter, Listener, Manager, WebviewUrl};

use crate::bridge::{Relay, Reply, Request};
use crate::daemon::{Handshake, Sidecar, Spawn};
use crate::store::Settings;
use crate::tabs::{Tab, Tabs, PAGE_PREFIX, PANEL_LABEL};

/// The one window. Everything the shell shows lives inside it.
const WINDOW: &str = "athena";

/// The event a page's relay emits, and the one it listens for (`relay.js`).
const REPLY_EVENT: &str = "page:reply";
const REQUEST_EVENT: &str = "page:request";

/// What the panel is told when a page's registry moves, so it can re-run `list`.
const TOOLCHANGE_EVENT: &str = "page:toolchange";

/// How long a command waits for a page to answer. Longer than `inject.js`'s own 30 s abort, so the
/// page's error wins and this only ever covers a page that is gone (protocol.md).
const CALL_TIMEOUT: Duration = bridge::RELAY_TIMEOUT;

// --- shared state --------------------------------------------------------------------------------

/// Everything the commands reach for. One mutex per independent thing, never one over all of them:
/// a page that is slow to answer must not block the panel from listing its tabs.
pub struct Shell {
    pub relay: Relay,
    tabs: Mutex<Tabs>,
    waiters: Mutex<HashMap<String, Sender<Value>>>,
    sidecar: Mutex<Option<Sidecar>>,
    settings: Mutex<Settings>,
    settings_path: Mutex<PathBuf>,
}

impl Shell {
    fn new() -> Self {
        Self {
            relay: Relay::new(),
            tabs: Mutex::new(Tabs::new()),
            waiters: Mutex::new(HashMap::new()),
            sidecar: Mutex::new(None),
            settings: Mutex::new(Settings::default()),
            settings_path: Mutex::new(PathBuf::from("athena-settings.json")),
        }
    }

    fn tabs(&self) -> MutexGuard<'_, Tabs> {
        self.tabs.lock().expect("the tab lock is never poisoned")
    }

    /// The daemon's address, for the panel. `None` before the sidecar has answered.
    pub fn address(&self) -> Option<Handshake> {
        self.sidecar
            .lock()
            .expect("the sidecar lock is never poisoned")
            .as_ref()
            .map(|running| running.handshake.clone())
    }
}

#[derive(Debug, Serialize)]
pub struct CallAnswer {
    pub ok: bool,
    pub output: String,
    pub error: Option<String>,
}

impl CallAnswer {
    fn failed(error: impl Into<String>) -> Self {
        Self {
            ok: false,
            output: String::new(),
            error: Some(error.into()),
        }
    }
}

// --- commands ------------------------------------------------------------------------------------

/// Where the daemon is and what token to present. The panel's first call.
#[tauri::command]
fn daemon_address(shell: tauri::State<'_, Shell>) -> Result<Handshake, String> {
    shell
        .address()
        .ok_or_else(|| "the daemon has not started yet".to_string())
}

#[tauri::command]
fn tab_list(shell: tauri::State<'_, Shell>) -> Vec<Tab> {
    shell.tabs().all().to_vec()
}

#[tauri::command]
fn tab_open(
    app: tauri::AppHandle,
    shell: tauri::State<'_, Shell>,
    url: String,
) -> Result<Tab, String> {
    let tab = open_page(&app, &shell, &url)?;
    show_only(&app, &tab.label);
    remember_tabs(&shell);
    Ok(tab)
}

/// Create one page webview, with the bridge injected at document start.
///
/// Shared by `tab_open` and the launch restore so a restored tab is the same thing as a typed one:
/// two construction paths would eventually differ by an injection or a position.
fn open_page(app: &tauri::AppHandle, shell: &Shell, url: &str) -> Result<Tab, String> {
    let parsed: tauri::Url = url.parse().map_err(|_| format!("not a url: {url}"))?;
    let window = app.get_window(WINDOW).ok_or("the window is gone")?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().unwrap_or(1.0);
    let (page, _) = layout::split(size.width as f64 / scale, size.height as f64 / scale);

    let tab = shell.tabs().open(url.to_string());
    let builder = tauri::webview::WebviewBuilder::new(&tab.label, WebviewUrl::External(parsed))
        .initialization_script(bridge::injection_script(&tab.label));
    if let Err(error) = window.add_child(builder, page.position(), page.size()) {
        // The bookkeeping must not keep a tab whose webview was never created, or the panel shows
        // a tab that can never answer and the relay routes replies to a label nothing holds.
        shell.tabs().close(&tab.label);
        return Err(error.to_string());
    }
    Ok(tab)
}

/// Write the open tabs back to the store, so the next launch reopens them.
fn remember_tabs(shell: &Shell) {
    let urls: Vec<String> = shell
        .tabs()
        .all()
        .iter()
        .map(|tab| tab.url.clone())
        .collect();
    let mut settings = shell
        .settings
        .lock()
        .expect("the settings lock is never poisoned");
    if settings.tabs == urls {
        return;
    }
    settings.tabs = urls;
    let path = shell
        .settings_path
        .lock()
        .expect("the settings path lock is never poisoned")
        .clone();
    // A failed write is not worth interrupting anything for: the worst outcome is a launch that
    // reopens yesterday's tabs.
    let _ = store::save(&path, &settings);
}

#[tauri::command]
fn tab_close(app: tauri::AppHandle, shell: tauri::State<'_, Shell>, label: String) -> Option<Tab> {
    let closed = shell.tabs().close(&label);
    if closed.is_some() {
        shell.relay.forget(&label);
        if let Some(webview) = app.get_webview(&label) {
            let _ = webview.close();
        }
        if let Some(next) = shell.tabs().active_label().map(str::to_string) {
            show_only(&app, &next);
        }
        remember_tabs(&shell);
    }
    closed
}

#[tauri::command]
fn tab_activate(app: tauri::AppHandle, shell: tauri::State<'_, Shell>, label: String) -> bool {
    if !shell.tabs().activate(&label) {
        return false;
    }
    show_only(&app, &label);
    true
}

/// Mark a page as registered, once the panel has merged its manifest into the daemon.
#[tauri::command]
fn tab_registered(
    shell: tauri::State<'_, Shell>,
    label: String,
    app_id: String,
    session_id: String,
    tool_count: usize,
) -> bool {
    shell
        .tabs()
        .registered(&label, app_id, session_id, tool_count)
}

/// What the lane is told about the world this turn (README §3.2 step 1).
#[tauri::command]
fn host_state(shell: tauri::State<'_, Shell>) -> Value {
    shell.tabs().host_state()
}

/// Ask a page what it registered. Blocks until it answers or the relay's window closes.
#[tauri::command]
fn page_list(app: tauri::AppHandle, shell: tauri::State<'_, Shell>, label: String) -> Value {
    let request = shell.relay.list(&label);
    match await_reply(&app, &shell, request) {
        Some(message) => message,
        None => {
            serde_json::json!({ "ok": false, "reason": "timeout", "error": "the page did not answer" })
        }
    }
}

/// Run one of the page's own tools. The gate has already allowed this call; the shell carries it.
#[tauri::command]
fn page_call(
    app: tauri::AppHandle,
    shell: tauri::State<'_, Shell>,
    label: String,
    name: String,
    input: Value,
) -> CallAnswer {
    let request = shell.relay.call(&label, &name, &input);
    let Some(message) = await_reply(&app, &shell, request) else {
        return CallAnswer::failed("timeout: the page did not answer");
    };
    let ok = message.get("ok").and_then(Value::as_bool).unwrap_or(false);
    CallAnswer {
        ok,
        output: message
            .get("output")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        error: message
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_string),
    }
}

#[tauri::command]
fn settings_get(shell: tauri::State<'_, Shell>) -> Settings {
    shell
        .settings
        .lock()
        .expect("the settings lock is never poisoned")
        .clone()
}

#[tauri::command]
fn settings_set(shell: tauri::State<'_, Shell>, settings: Settings) -> Result<Settings, String> {
    let repaired = settings.repaired();
    let path = shell
        .settings_path
        .lock()
        .expect("the settings path lock is never poisoned")
        .clone();
    store::save(&path, &repaired).map_err(|e| e.to_string())?;
    *shell
        .settings
        .lock()
        .expect("the settings lock is never poisoned") = repaired.clone();
    Ok(repaired)
}

// --- the plumbing --------------------------------------------------------------------------------

/// Send a request to a page and block this command's thread until the reply lands.
///
/// A command and not an async task on purpose: Tauri runs a synchronous command on its own thread,
/// so blocking here costs one thread and nothing else. Blocking inside an async command would hold
/// a runtime worker for as long as the slowest page takes to answer.
fn await_reply(app: &tauri::AppHandle, shell: &Shell, request: Request) -> Option<Value> {
    let id = request.message.get("id")?.as_str()?.to_string();
    let (tx, rx) = channel::<Value>();
    shell
        .waiters
        .lock()
        .expect("the waiter lock is never poisoned")
        .insert(id.clone(), tx);

    if app
        .emit_to(request.label.as_str(), REQUEST_EVENT, &request)
        .is_err()
    {
        shell
            .waiters
            .lock()
            .expect("the waiter lock is never poisoned")
            .remove(&id);
        return None;
    }

    let answer = rx.recv_timeout(CALL_TIMEOUT).ok();
    // Every path out removes the entry. A pending entry that is never cleared is a panel that
    // spins forever on a call nobody remembers making.
    shell
        .waiters
        .lock()
        .expect("the waiter lock is never poisoned")
        .remove(&id);
    if answer.is_none() {
        shell.relay.sweep(std::time::Instant::now());
    }
    answer
}

/// Show one page webview and hide the rest. The panel is never hidden.
fn show_only(app: &tauri::AppHandle, label: &str) {
    let Some(window) = app.get_window(WINDOW) else {
        return;
    };
    for webview in window.webviews() {
        let name = webview.label().to_string();
        if name == PANEL_LABEL || !name.starts_with(PAGE_PREFIX) {
            continue;
        }
        let _ = if name == label {
            webview.show()
        } else {
            webview.hide()
        };
    }
}

/// Re-lay the window's webviews after a resize.
fn relayout(app: &tauri::AppHandle) {
    let Some(window) = app.get_window(WINDOW) else {
        return;
    };
    let Ok(size) = window.inner_size() else {
        return;
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let (page, panel) = layout::split(size.width as f64 / scale, size.height as f64 / scale);
    for webview in window.webviews() {
        let rect = if webview.label() == PANEL_LABEL {
            panel
        } else {
            page
        };
        let _ = webview.set_position(rect.position());
        let _ = webview.set_size(rect.size());
    }
}

/// Route one page reply: settle a pending request, or tell the panel the registry moved.
fn on_reply(app: &tauri::AppHandle, shell: &Shell, reply: Reply) {
    match shell.relay.receive(&reply) {
        bridge::Outcome::Answered { id, message } => {
            if let Some(waiter) = shell
                .waiters
                .lock()
                .expect("the waiter lock is never poisoned")
                .remove(&id)
            {
                let _ = waiter.send(message);
            }
        }
        bridge::Outcome::ToolChange { label } | bridge::Outcome::Ready { label } => {
            // The panel re-runs `list` and merges the manifest. The shell does not, because
            // merging a manifest is a decision and the daemon owns it.
            let _ = app.emit(TOOLCHANGE_EVENT, label);
        }
        bridge::Outcome::Ignored => {}
    }
}

// --- the app -------------------------------------------------------------------------------------

/// Build and run the shell.
pub fn run() {
    tauri::Builder::default()
        .manage(Shell::new())
        .invoke_handler(tauri::generate_handler![
            daemon_address,
            tab_list,
            tab_open,
            tab_close,
            tab_activate,
            tab_registered,
            host_state,
            page_list,
            page_call,
            settings_get,
            settings_set,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let shell = app.state::<Shell>();

            // Settings first: the window's size comes from them.
            let path = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("settings.json");
            let settings = store::load(&path);
            *shell.settings_path.lock().unwrap() = path;
            *shell.settings.lock().unwrap() = settings.clone();

            // The sidecar before the window: a panel that renders before it knows the port is a
            // panel whose first request fails for a reason the user cannot see.
            match Sidecar::start(&Spawn::from_checkout()) {
                Ok(running) => *shell.sidecar.lock().unwrap() = Some(running),
                Err(error) => eprintln!("athena: the daemon did not start: {error}"),
            }

            let window = tauri::window::WindowBuilder::new(app, WINDOW)
                .title("Athena")
                .inner_size(settings.window_width, settings.window_height)
                .min_inner_size(layout::MIN_WIDTH, layout::MIN_HEIGHT)
                .build()?;
            let (_, panel) = layout::split(settings.window_width, settings.window_height);
            window.add_child(
                tauri::webview::WebviewBuilder::new(
                    PANEL_LABEL,
                    WebviewUrl::App("index.html".into()),
                ),
                panel.position(),
                panel.size(),
            )?;

            let replies = handle.clone();
            app.listen_any(REPLY_EVENT, move |event| {
                if let Ok(reply) = serde_json::from_str::<Reply>(event.payload()) {
                    on_reply(&replies, &replies.state::<Shell>(), reply);
                }
            });

            // Something to look at on first launch. A window with a 380 px column and a large
            // empty rectangle beside it reads as a crash, not as an empty browser.
            let wanted: Vec<String> = if settings.tabs.is_empty() {
                vec![settings.home_url.clone()]
            } else {
                settings.tabs.clone()
            };
            let shell_state = app.state::<Shell>();
            let mut first: Option<String> = None;
            for url in wanted {
                match open_page(&handle, &shell_state, &url) {
                    Ok(tab) => first.get_or_insert(tab.label),
                    Err(error) => {
                        eprintln!("athena: could not reopen {url}: {error}");
                        continue;
                    }
                };
            }
            if let Some(label) = first {
                show_only(&handle, &label);
            }
            // Lay everything out once more, now that every webview exists and the window has a
            // real size. The rects computed while the window was still being built are a guess.
            relayout(&handle);

            let resized = handle.clone();
            window.on_window_event(move |event| {
                if matches!(
                    event,
                    tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }
                ) {
                    relayout(&resized);
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("the shell could not be built")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                // Exit hygiene, on the one path every quit takes. The job object covers a kill
                // this handler never sees; this covers the ordinary close.
                if let Some(running) = app.state::<Shell>().sidecar.lock().unwrap().as_mut() {
                    running.stop();
                }
            }
        });
}
