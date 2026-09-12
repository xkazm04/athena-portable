//! The relay — README section 3.4, tier 1: *the page's own WebMCP tools, through `inject.js` and
//! the relay*. The wire format is `packages/athena-bridge/protocol.md` and nothing here may
//! invent a message it does not describe.
//!
//! ```text
//!   chrome ──invoke bridge_list/bridge_call──▶ Rust ──eval postMessage {dir:"to-page"}──▶ page
//!   chrome ◀─────────── the awaited reply ──── Rust ◀──invoke bridge_reply {nonce} ────── page
//! ```
//!
//! Two initialization scripts run in every page webview at document start. The first is
//! `inject.js` **verbatim from the bridge package** — `INJECT_JS` is an `include_str!` of the file
//! itself, so there is no copy to drift and a test asserts the bytes anyway. The second is
//! [`relay_script`], a closure with this tab's id and its nonce baked in, whose whole job is to
//! forward the page's `to-ext` messages back over the one command a page webview may call.
//!
//! **Why a page gets IPC at all.** `eval` is fire-and-forget: it returns nothing, so the only way
//! an answer can come back out of a webview is the IPC. Page webviews are therefore granted
//! exactly one command, `bridge_reply`, by `capabilities/page.json` — no `core:default`, no window
//! control, no filesystem. Three things then stand between a hostile page and the relay:
//!
//! 1. the per-tab **nonce**, minted in Rust and closed over by the relay script, which runs before
//!    any page script and never puts the value on an object the page can reach;
//! 2. the **id namespace**: every id is `<tab>:<n>-<random>`, a reply is only matched against a
//!    pending request of its own tab, and the random tail means a page cannot name an id it was
//!    never handed — a bare counter would let a document pre-answer calls nobody has made;
//! 3. **the page was always the responder.** Even with a perfect nonce all a page can return is a
//!    tool result, which is what it returns on every surface. Tool results are untrusted input
//!    downstream — the gate, the fence, the budget — and this module changes none of that.
//!
//! Nothing here decides anything. `AUTO` or `GATED` is `gate.js` and the catalog behind it
//! (README section 3.3): this file carries bytes between two processes and times them out.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::sync::oneshot;

use crate::tabs;

/// The one namespace on the wire (`protocol.md`, "Envelope"). Anything without it is not ours.
pub const NS: &str = "athena-webmcp";

/// A request, addressed at the page's listener.
const DIR_PAGE: &str = "to-page";

/// A reply or an event, coming back. The relay script forwards these and nothing else, so a
/// second main-world script could share this window without answering for the bridge.
const DIR_EXT: &str = "to-ext";

/// The relay's own deadline for one request, deliberately longer than the page's 30 s: the page's
/// abort is supposed to win and produce a real error, and this timer only covers a page that is
/// gone, frozen, or has no bridge at all (`protocol.md`, "Timeouts").
const CALL_TIMEOUT: Duration = Duration::from_secs(35);

/// The page's half of the bridge, embedded at compile time **from the package itself**. The path
/// is relative to this file, so the bytes the shell injects are the bytes
/// `packages/athena-bridge/inject.js` holds — there is no second copy to synchronise. `build.rs`
/// re-runs on that file and `the_embedded_bridge_is_the_packages_own_bytes` asserts it from the
/// other end.
pub const INJECT_JS: &str = include_str!("../../../../packages/athena-bridge/inject.js");

/// The relay's whole state: what is parked, and which nonce each tab's scripts were built with.
#[derive(Default)]
pub struct Bridge {
    state: Mutex<BridgeState>,
    seq: AtomicU64,
}

#[derive(Default)]
struct BridgeState {
    /// Request id → the caller waiting for it. An entry is removed by exactly one of two paths:
    /// the reply that matches it, or the timer that gave up on it.
    pending: HashMap<String, oneshot::Sender<Value>>,
    /// Tab id → the nonce its initialization scripts closed over.
    nonces: HashMap<u32, String>,
}

/// What [`Bridge::settle`] did with a message the page sent. Every variant is a *result*: a reply
/// the relay cannot place is dropped and said so, never a panic and never an error the page can
/// read anything out of.
#[derive(Debug, PartialEq, Eq)]
enum Settled {
    /// The unsolicited change notification. The caller emits `bridge:toolchange`.
    Toolchange,
    /// Handed to the waiting request.
    Delivered,
    /// Dropped, for the reason named.
    Ignored(&'static str),
}

impl Bridge {
    fn lock(&self) -> MutexGuard<'_, BridgeState> {
        self.state.lock().expect("bridge poisoned")
    }

    /// This tab's nonce, minted on the first script build and kept for the life of the tab. It is
    /// deliberately *not* per document: an initialization script re-runs on every navigation and
    /// each run has to close over a value the shell still recognises.
    fn nonce_for(&self, tab: u32) -> String {
        self.lock()
            .nonces
            .entry(tab)
            .or_insert_with(random_token)
            .clone()
    }

    fn nonce_matches(&self, tab: u32, nonce: &str) -> bool {
        self.lock().nonces.get(&tab).is_some_and(|n| n == nonce)
    }

    /// `<tab>:<n>-<random>`. The counter keeps ids readable in a log; the random tail is what
    /// stops a page naming a request it was never handed.
    fn next_id(&self, tab: u32) -> String {
        let n = self.seq.fetch_add(1, Ordering::Relaxed);
        format!("{tab}:{n}-{}", random_token())
    }

    /// Park a request and hand back its id and the receiver the caller awaits.
    fn park(&self, tab: u32) -> (String, oneshot::Receiver<Value>) {
        let id = self.next_id(tab);
        let (tx, rx) = oneshot::channel();
        self.lock().pending.insert(id.clone(), tx);
        (id, rx)
    }

    /// Forget a parked request. The timeout path's half of the id map's invariant: a request
    /// leaves the map exactly once, whether it was answered or given up on.
    fn forget(&self, id: &str) -> bool {
        self.lock().pending.remove(id).is_some()
    }

    /// Place one `to-ext` message. Pure enough to test: it reads the map, it writes the map, and
    /// it touches no app handle — which is why the late reply and the foreign id are unit tests
    /// and not something only a running window could show.
    fn settle(&self, tab: u32, body: Value) -> Settled {
        // `toolchange` is unsolicited and carries no id (`protocol.md`, "Replies and events").
        if body.get("type").and_then(Value::as_str) == Some("toolchange") {
            return Settled::Toolchange;
        }
        let Some(id) = body.get("id").and_then(Value::as_str) else {
            return Settled::Ignored("a reply without an id");
        };
        if !id.starts_with(&format!("{tab}:")) {
            return Settled::Ignored("an id belonging to another tab");
        }
        let Some(tx) = self.lock().pending.remove(id) else {
            // The late reply: the timer already resolved this call and forgot the id, so there is
            // nobody to hand it to. It is the ordinary end of a slow page and not an error.
            return Settled::Ignored("an unknown or expired id");
        };
        if tx.send(body).is_err() {
            return Settled::Ignored("a caller that had already stopped waiting");
        }
        Settled::Delivered
    }

    #[cfg(test)]
    fn parked(&self) -> usize {
        self.lock().pending.len()
    }
}

/// The two initialization scripts a page webview is built with, in the order they must run:
/// `inject.js` first, so it reaches `document.modelContext` before the application's own scripts
/// do, then the forwarder that carries its answers out.
pub fn scripts(app: &AppHandle, tab: u32) -> (&'static str, String) {
    let nonce = app.state::<Bridge>().nonce_for(tab);
    (INJECT_JS, relay_script(tab, &nonce))
}

/// The forwarder. Everything it needs is baked in as a JSON literal, so nothing in it can be
/// broken out of, and the nonce lives only in this closure's scope.
fn relay_script(tab: u32, nonce: &str) -> String {
    let ns = json_literal(NS);
    let dir = json_literal(DIR_EXT);
    let nonce = json_literal(nonce);
    format!(
        r#"(() => {{
  "use strict";
  const NS = {ns};
  const DIR = {dir};
  const TAB = {tab};
  const NONCE = {nonce};
  const internals = window.__TAURI_INTERNALS__;
  const invoke = internals && internals.invoke;
  if (typeof invoke !== "function") return;
  window.addEventListener("message", (event) => {{
    // A frame is not the page, exactly as in inject.js: only this document answers for itself.
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.__ns !== NS || msg.dir !== DIR) return;
    const payload = {{}};
    for (const key of Object.keys(msg)) {{
      if (key !== "__ns" && key !== "dir") payload[key] = msg[key];
    }}
    try {{
      const answered = invoke("bridge_reply", {{ tab_id: TAB, nonce: NONCE, payload: payload }});
      // A rejection means the shell dropped it — a wrong nonce, a closed tab. Nothing the page
      // can do about that, and an unhandled rejection would only noise up its console.
      if (answered && typeof answered.catch === "function") answered.catch(() => {{}});
    }} catch (e) {{
      // The shell is gone. The page is not ours to break.
    }}
  }});
}})();
"#
    )
}

/// Send one `to-page` message and wait for its answer, with the relay's own 35 s deadline.
pub async fn ask(app: &AppHandle, tab: u32, body: Value) -> Result<Value, String> {
    ask_with(app, tab, body, CALL_TIMEOUT).await
}

/// [`ask`] with a deadline of its own. Only the smoke shortens it: the protocol's two-timer
/// arrangement (30 s in the page, 35 s here) is what the panel gets.
async fn ask_with(
    app: &AppHandle,
    tab: u32,
    body: Value,
    timeout: Duration,
) -> Result<Value, String> {
    let webview = app
        .get_webview(&tabs::label_for(tab))
        .ok_or_else(|| format!("no tab {tab}"))?;

    let bridge = app.state::<Bridge>();
    let (id, rx) = bridge.park(tab);
    let script = post_script(&envelope(DIR_PAGE, &id, body))?;
    if let Err(e) = webview.eval(script) {
        bridge.forget(&id);
        return Err(format!("cannot reach tab {tab}: {e}"));
    }
    Ok(awaited(&bridge, id, rx, timeout).await)
}

/// The wait, and the one place a request is given up on. Separate from [`ask_with`] so the timer
/// and the id map can be tested without a window: everything above this line needs a webview and
/// nothing below it does.
async fn awaited(
    bridge: &Bridge,
    id: String,
    rx: oneshot::Receiver<Value>,
    timeout: Duration,
) -> Value {
    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(value)) => value,
        // The sender was dropped without sending: the map was cleared out from under us.
        Ok(Err(_)) => json!({ "ok": false, "error": "the relay was dropped" }),
        Err(_) => {
            bridge.forget(&id);
            json!({ "ok": false, "error": "timeout" })
        }
    }
}

/// The page's answer, arriving over the one command page webviews may call.
fn reply(app: &AppHandle, tab: u32, nonce: &str, payload: Value) -> Result<(), String> {
    let bridge = app.state::<Bridge>();
    if !bridge.nonce_matches(tab, nonce) {
        // Not worth detailing to the caller: a wrong nonce is either a stale script from a closed
        // tab or a page trying it on. Drop it, and say so once, quietly.
        eprintln!("[bridge] dropped a reply for tab {tab} with the wrong nonce");
        return Err("rejected".to_string());
    }
    match bridge.settle(tab, payload) {
        Settled::Toolchange => crate::ui_emit(app, "bridge:toolchange", json!({ "tab_id": tab })),
        Settled::Delivered => {}
        Settled::Ignored(why) => eprintln!("[bridge] dropped a reply for tab {tab}: {why}"),
    }
    Ok(())
}

// ==============================================================================================
// Commands. Declared here rather than in `lib.rs` so that registering the relay is one line per
// command in `lib.rs`'s `── registrations ──` blocks and three branches can land beside each
// other. `capabilities/ui.json` grants the first two to `chrome`; `capabilities/page.json` grants
// the third to the page webviews and nothing else.
// ==============================================================================================

/// What the page registered: `{ ok, page, tools }`, or `{ ok: false, error }`.
#[tauri::command(rename_all = "snake_case")]
pub async fn bridge_list(app: AppHandle, tab_id: u32) -> Result<Value, String> {
    ask(&app, tab_id, json!({ "type": "list" })).await
}

/// Run one of the page's own tools. `params` rides the wire as the protocol's `input`;
/// `timeout_ms` may shorten the page's 30 s deadline and can never extend it (`inject.js` clamps
/// it), while the relay's own timer stays where it is.
#[tauri::command(rename_all = "snake_case")]
pub async fn bridge_call(
    app: AppHandle,
    tab_id: u32,
    name: String,
    params: Value,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    let mut body = json!({ "type": "call", "name": name, "input": params });
    if let (Some(object), Some(ms)) = (body.as_object_mut(), timeout_ms) {
        object.insert("timeout_ms".to_string(), json!(ms));
    }
    ask(&app, tab_id, body).await
}

/// The page's half of every conversation above. The only command a page webview may call.
#[tauri::command(rename_all = "snake_case")]
pub async fn bridge_reply(
    app: AppHandle,
    tab_id: u32,
    nonce: String,
    payload: Value,
) -> Result<(), String> {
    reply(&app, tab_id, &nonce, payload)
}

// ==============================================================================================
// The envelope, and the one place a JSON value becomes a line of JavaScript.
// ==============================================================================================

/// The protocol's envelope with `body`'s fields at the top level beside it.
fn envelope(dir: &str, id: &str, body: Value) -> Value {
    let mut message = json!({ "__ns": NS, "dir": dir, "id": id });
    if let (Some(target), Some(source)) = (message.as_object_mut(), body.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }
    message
}

/// `window.postMessage(<the message>, location.origin);`
///
/// The message is JSON-encoded **once** — `serde_json` is what escapes the quotes, the newlines
/// and the control characters — and then three characters JSON allows raw are spelled as escapes
/// by [`js_safe`], because a JSON document and a JavaScript expression are not quite the same
/// language. What comes out still parses as JSON, which is what the round-trip test asserts.
fn post_script(message: &Value) -> Result<String, String> {
    let json = serde_json::to_string(message).map_err(|e| e.to_string())?;
    Ok(format!(
        "window.postMessage({}, location.origin);",
        js_safe(&json)
    ))
}

/// The three sequences a JSON string may hold raw and a script host may not.
///
/// `U+2028` and `U+2029` were line terminators in JavaScript before ES2019 and are still the
/// classic way a JSON payload becomes a syntax error in someone else's parser. `</` is escaped so
/// the same text is safe the day somebody puts it inside a `<script>` element — a page's tool
/// output is untrusted text that has already travelled through the model, and `</script>` is the
/// first thing anyone tries. `\/` and `\u2028` are both valid JSON escapes, so the value on the
/// other side is unchanged.
///
/// A global replacement is sound because none of the three can occur outside a JSON string: the
/// only characters `serde_json` writes between values are `{}[],:` and the bare literals.
fn js_safe(json: &str) -> String {
    json.replace("</", "<\\/")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

/// A Rust string as a JavaScript string literal.
fn json_literal(value: &str) -> String {
    js_safe(&serde_json::to_string(value).expect("a string always encodes"))
}

/// 128 bits of hex. Falls back to the clock only if the OS refuses entropy, which on the desktop
/// means something is very wrong; a predictable nonce is still better than a shell that will not
/// open a tab.
fn random_token() -> String {
    let mut bytes = [0u8; 16];
    if getrandom::fill(&mut bytes).is_err() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        bytes[..16].copy_from_slice(&nanos.to_le_bytes());
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ==============================================================================================
// The smoke (README section 8, layer 2). `ATHENA_SMOKE=1` turns the shell into a one-claim
// command-line tool: open the start url, ask the page what it has, print one assertable line,
// exit. `scripts/smoke.mjs` is what runs it against `scratch/webmcp-page.html`.
// ==============================================================================================

/// Arm the smoke, if the environment asked for it. Called from `setup` after the start url's tab
/// has been created, which is why the tab it asks about is always tab 1.
pub fn smoke_if_asked(app: &AppHandle) {
    if std::env::var("ATHENA_SMOKE")
        .ok()
        .filter(|v| !v.is_empty())
        .is_none()
    {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move { smoke(app, 1).await });
}

/// One `list` against a freshly opened tab, printed to stdout, and then the process ends.
///
/// It polls rather than sleeping once: `inject.js` runs at document start, so the page can answer
/// long before it has finished loading, and a fixed sleep is either a slow smoke or a flaky one.
/// Every attempt is a whole request with a short deadline of its own, so a page that never
/// answers costs the attempt and not the run.
async fn smoke(app: AppHandle, tab: u32) {
    const ATTEMPTS: u32 = 20;
    const EVERY: Duration = Duration::from_millis(500);
    const PER_TRY: Duration = Duration::from_secs(2);

    let mut last = "the page never answered".to_string();
    for _ in 0..ATTEMPTS {
        tokio::time::sleep(EVERY).await;
        match ask_with(&app, tab, json!({ "type": "list" }), PER_TRY).await {
            Ok(reply) if reply.get("ok").and_then(Value::as_bool) == Some(true) => {
                let tools = reply
                    .get("tools")
                    .and_then(Value::as_array)
                    .map(Vec::len)
                    .unwrap_or(0);
                let transport = reply
                    .get("page")
                    .and_then(|page| page.get("transport"))
                    .and_then(Value::as_str)
                    .unwrap_or("?");
                println!("[smoke] tab {tab}: ok=true tools={tools} transport={transport}");
                app.exit(0);
                return;
            }
            Ok(reply) => {
                last = reply
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("no answer")
                    .to_string();
            }
            Err(e) => last = e,
        }
    }
    println!("[smoke] tab {tab}: ok=false error={last}");
    app.exit(1);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    /// The bridge package is the source of truth for what runs in a page, and `INJECT_JS` is an
    /// `include_str!` of that very file — so this asserts the *path* has not been pointed at a
    /// copy. The day somebody vendors `inject.js` into the crate to make a build simpler, this is
    /// the test that says the two halves of the protocol have stopped being one file.
    #[test]
    fn the_embedded_bridge_is_the_packages_own_bytes() {
        let package = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/athena-bridge/inject.js");
        let bytes = std::fs::read_to_string(&package)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", package.display()));
        assert_eq!(
            bytes, INJECT_JS,
            "the injected script is not packages/athena-bridge/inject.js any more"
        );
        assert!(
            INJECT_JS.contains("athena-webmcp"),
            "and it is the bridge rather than an empty file"
        );
    }

    #[test]
    fn request_ids_stay_in_their_tabs_namespace_and_are_not_guessable() {
        let bridge = Bridge::default();
        let mut seen = HashSet::new();
        for _ in 0..10_000 {
            let id = bridge.next_id(1);
            assert!(id.starts_with("1:"), "{id} left its tab's namespace");
            assert!(seen.insert(id), "an id repeated");
        }
        assert!(bridge.next_id(2).starts_with("2:"));

        // The tail is not derivable from the counter: two ids one apart differ by more than the
        // number in them, which is what stops a page spraying `1:0`..`1:500`.
        let (a, b) = (bridge.next_id(3), bridge.next_id(3));
        assert_ne!(
            a.split_once('-').map(|(_, tail)| tail),
            b.split_once('-').map(|(_, tail)| tail)
        );
    }

    #[test]
    fn a_tabs_nonce_is_stable_and_another_tabs_is_not_it() {
        let bridge = Bridge::default();
        let first = bridge.nonce_for(1);
        assert_eq!(first, bridge.nonce_for(1), "re-injection gets the same nonce");
        assert_ne!(first, bridge.nonce_for(2));
        assert!(bridge.nonce_matches(1, &first));
        assert!(!bridge.nonce_matches(1, "guessed"));
        assert!(!bridge.nonce_matches(9, &first), "no tab 9 has been built");
    }

    /// The timer's half of the id map's invariant, at a deadline a test can wait out. The 35 s in
    /// `CALL_TIMEOUT` is the panel's number; the behaviour is this.
    #[tokio::test]
    async fn a_request_nobody_answers_times_out_and_is_forgotten() {
        let bridge = Bridge::default();
        let (id, rx) = bridge.park(7);
        assert_eq!(bridge.parked(), 1);

        let answer = awaited(&bridge, id.clone(), rx, Duration::from_millis(10)).await;
        assert_eq!(answer, json!({ "ok": false, "error": "timeout" }));
        assert_eq!(bridge.parked(), 0, "the id map does not grow a leak per call");

        // And the reply that arrives after that is ignored rather than panicking on a channel
        // whose receiver is gone.
        assert_eq!(
            bridge.settle(7, json!({ "id": id, "ok": true, "output": "late" })),
            Settled::Ignored("an unknown or expired id")
        );
    }

    #[tokio::test]
    async fn an_answer_that_arrives_in_time_is_the_calls_result() {
        let bridge = Bridge::default();
        let (id, rx) = bridge.park(2);
        assert_eq!(
            bridge.settle(2, json!({ "id": id.clone(), "ok": true, "output": "12 invoices" })),
            Settled::Delivered
        );
        let answer = awaited(&bridge, id, rx, Duration::from_secs(5)).await;
        assert_eq!(answer["output"], json!("12 invoices"));
        assert_eq!(bridge.parked(), 0);
    }

    #[test]
    fn a_reply_the_relay_cannot_place_is_dropped_and_never_panics() {
        let bridge = Bridge::default();
        let (id, _rx) = bridge.park(1);

        assert_eq!(
            bridge.settle(1, json!({ "ok": true })),
            Settled::Ignored("a reply without an id")
        );
        assert_eq!(
            bridge.settle(1, json!({ "id": 17, "ok": true })),
            Settled::Ignored("a reply without an id"),
            "an id that is not a string is not an id"
        );
        assert_eq!(
            bridge.settle(1, json!({ "id": "9:0-beef", "ok": true })),
            Settled::Ignored("an id belonging to another tab")
        );
        // Tab 2 cannot answer tab 1's real, still-parked request either.
        assert_eq!(
            bridge.settle(2, json!({ "id": id.clone(), "ok": true })),
            Settled::Ignored("an id belonging to another tab")
        );
        assert_eq!(bridge.parked(), 1, "and none of that unparked anything");
    }

    #[test]
    fn toolchange_is_the_one_message_with_no_id() {
        let bridge = Bridge::default();
        assert_eq!(
            bridge.settle(4, json!({ "id": null, "type": "toolchange" })),
            Settled::Toolchange
        );
    }

    /// The escaping, from the outside: whatever the page's tool said, the script is one statement
    /// and the value that reaches `postMessage` is the value we sent.
    #[test]
    fn a_payload_full_of_teeth_survives_becoming_javascript() {
        let nasty = "</script><script>alert(\"x\")</script>\u{2028}\u{2029}\"quoted\"\n\\ ☕";
        let message = envelope(DIR_PAGE, "1:0-abc", json!({ "type": "call", "input": nasty }));
        let script = post_script(&message).expect("the message encodes");

        assert!(script.starts_with("window.postMessage("));
        assert!(script.ends_with(", location.origin);"));
        assert!(
            !script.contains("</script>"),
            "a closing script tag survived: {script}"
        );
        assert!(!script.contains('\u{2028}') && !script.contains('\u{2029}'));
        assert!(!script.contains('\n'), "one statement, one line");

        // The round trip is the point: escaping that changed the value would be a bug the page
        // reports as a tool called with the wrong arguments.
        let argument = script
            .trim_start_matches("window.postMessage(")
            .trim_end_matches(", location.origin);");
        let parsed: Value = serde_json::from_str(argument).expect("still JSON");
        assert_eq!(parsed["input"], json!(nasty));
        assert_eq!(parsed["__ns"], json!(NS));
        assert_eq!(parsed["dir"], json!(DIR_PAGE));
        assert_eq!(parsed["id"], json!("1:0-abc"));
    }

    /// The relay script carries two values out of Rust and both are literals, so a nonce with a
    /// quote in it could never end the statement it sits in.
    #[test]
    fn the_relay_script_bakes_its_values_in_as_literals() {
        let script = relay_script(3, "no\"such\\nonce</script>");
        assert!(script.contains("const TAB = 3;"));
        assert!(script.contains(r#"const NONCE = "no\"such\\nonce<\/script>";"#));
        assert!(script.contains(r#"invoke("bridge_reply", { tab_id: TAB, nonce: NONCE"#));
        assert!(script.contains("event.source !== window"), "a frame is not the page");
    }
}
