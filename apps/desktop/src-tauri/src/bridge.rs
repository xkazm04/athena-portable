//! The relay: the shell's half of the bridge (README §3.4 tier 1).
//!
//! `packages/athena-bridge/inject.js` runs in the page and answers `list` and `call` over
//! `window.postMessage`. `relay.js` beside it carries those messages across the process boundary.
//! This module is the Rust end: it mints the correlation ids, holds the pending requests, and times
//! out the ones a page never answers.
//!
//! **Two timeouts, layered, and the outer one is the longer.** `inject.js` races every call against
//! a 30-second abort of its own; the relay waits 35. That ordering is the whole point: the page's
//! own abort wins and produces a real error naming the tool, and the relay's timer only ever covers
//! a page that is gone, frozen, or has no bridge at all. A relay that timed out first would report
//! "the page did not answer" for a tool that was about to say why it failed.
//!
//! **A dropped pending entry is a hung surface.** Every path out of `resolve` removes the entry,
//! including the timeout path, because an entry that is never cleared is a panel that spins forever
//! on a tool nobody remembers calling.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// The namespace every bridge message carries. Anything without it is not ours.
pub const NAMESPACE: &str = "athena-webmcp";

/// The relay's own deadline, deliberately longer than the page's 30 s (protocol.md).
pub const RELAY_TIMEOUT: Duration = Duration::from_secs(35);

/// The scripts injected into every page webview, at document start, in this order.
///
/// `inject.js` first because `relay.js` forwards what it produces; both are the files under
/// `packages/athena-bridge/`, not copies, so a fix to the protocol lands in one place.
pub fn injection_script(label: &str) -> String {
    format!(
        "window.__ATHENA_WEBVIEW__ = {label};\n{inject}\n{relay}\n",
        label = serde_json::to_string(label).unwrap_or_else(|_| "\"\"".into()),
        inject = include_str!("../../../../packages/athena-bridge/inject.js"),
        relay = include_str!("relay.js"),
    )
}

/// A message on its way to a page.
#[derive(Debug, Clone, Serialize)]
pub struct Request {
    pub label: String,
    pub message: Value,
}

/// What a page sent back.
#[derive(Debug, Clone, Deserialize)]
pub struct Reply {
    pub label: String,
    pub message: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    /// The page answered this request.
    Answered { id: String, message: Value },
    /// The page's registry moved; the surface should re-run `list`.
    ToolChange { label: String },
    /// The relay is now able to talk to this page.
    Ready { label: String },
    /// Not ours, or a reply to a request that has already been settled.
    Ignored,
}

struct Pending {
    label: String,
    opened: Instant,
}

/// The relay's state: which requests are in flight and how ids are minted.
#[derive(Default)]
pub struct Relay {
    inner: Arc<Mutex<Inner>>,
}

#[derive(Default)]
struct Inner {
    next: u64,
    pending: HashMap<String, Pending>,
}

impl Relay {
    pub fn new() -> Self {
        Self::default()
    }

    /// Build a `list` request for one page and remember it as pending.
    pub fn list(&self, label: &str) -> Request {
        self.request(label, json!({ "type": "list" }))
    }

    /// Build a `call` request. `timeout_ms` is clamped into `1 ..= 30000` by `inject.js`; the relay
    /// may shorten the page's deadline and can never extend it.
    pub fn call(&self, label: &str, name: &str, input: &Value) -> Request {
        self.request(
            label,
            json!({ "type": "call", "name": name, "input": input }),
        )
    }

    fn request(&self, label: &str, mut body: Value) -> Request {
        let id = {
            let mut inner = self.inner.lock().expect("the relay lock is never poisoned");
            inner.next += 1;
            let id = format!("{}-{}", label, inner.next);
            inner.pending.insert(
                id.clone(),
                Pending {
                    label: label.to_string(),
                    opened: Instant::now(),
                },
            );
            id
        };
        if let Some(map) = body.as_object_mut() {
            map.insert("__ns".into(), json!(NAMESPACE));
            map.insert("dir".into(), json!("to-page"));
            map.insert("id".into(), json!(id));
        }
        Request {
            label: label.to_string(),
            message: body,
        }
    }

    /// Read one message from a page. Settles a pending request, or names an unsolicited event.
    pub fn receive(&self, reply: &Reply) -> Outcome {
        let message = &reply.message;
        if message.get("__ns").and_then(Value::as_str) != Some(NAMESPACE) {
            return Outcome::Ignored;
        }
        if message.get("dir").and_then(Value::as_str) != Some("to-ext") {
            return Outcome::Ignored;
        }
        // `id: null` marks an unsolicited event: no pending request can match it.
        if message.get("id").map(Value::is_null).unwrap_or(true) {
            return match message.get("type").and_then(Value::as_str) {
                Some("toolchange") => Outcome::ToolChange {
                    label: reply.label.clone(),
                },
                Some("ready") => Outcome::Ready {
                    label: reply.label.clone(),
                },
                _ => Outcome::Ignored,
            };
        }
        let Some(id) = message.get("id").and_then(Value::as_str) else {
            return Outcome::Ignored;
        };
        let mut inner = self.inner.lock().expect("the relay lock is never poisoned");
        match inner.pending.remove(id) {
            // A reply from a different page than the one the request went to is not an answer.
            Some(pending) if pending.label == reply.label => Outcome::Answered {
                id: id.to_string(),
                message: message.clone(),
            },
            Some(pending) => {
                inner.pending.insert(id.to_string(), pending);
                Outcome::Ignored
            }
            None => Outcome::Ignored,
        }
    }

    /// Drop everything past the deadline and name it, so a caller can answer each one.
    pub fn sweep(&self, now: Instant) -> Vec<String> {
        let mut inner = self.inner.lock().expect("the relay lock is never poisoned");
        let expired: Vec<String> = inner
            .pending
            .iter()
            .filter(|(_, pending)| now.duration_since(pending.opened) >= RELAY_TIMEOUT)
            .map(|(id, _)| id.clone())
            .collect();
        for id in &expired {
            inner.pending.remove(id);
        }
        expired
    }

    /// Forget every request to one page. Called when a tab closes: nothing will ever answer.
    pub fn forget(&self, label: &str) -> usize {
        let mut inner = self.inner.lock().expect("the relay lock is never poisoned");
        let before = inner.pending.len();
        inner.pending.retain(|_, pending| pending.label != label);
        before - inner.pending.len()
    }

    pub fn in_flight(&self) -> usize {
        self.inner
            .lock()
            .expect("the relay lock is never poisoned")
            .pending
            .len()
    }
}

impl Clone for Relay {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

/// Turn a page's `list` answer into the manifest the daemon merges (README §3.3).
///
/// The shape is `HostManifest.from_dict`'s, and the flags are read as the page's *claim*: the
/// class is derived from them by the catalog, and a page that omits `reversible` gets `GATED`.
pub fn manifest_from_list(answer: &Value) -> Option<Value> {
    let page = answer.get("page")?;
    let tools = answer.get("tools")?.as_array()?;
    let app_id = page.get("app_id").and_then(Value::as_str).unwrap_or("");
    if app_id.is_empty() {
        return None;
    }
    let mapped: Vec<Value> = tools
        .iter()
        .map(|tool| {
            let athena = tool.get("athena");
            json!({
                "name": tool.get("name").and_then(Value::as_str).unwrap_or(""),
                "description": tool.get("description").and_then(Value::as_str).unwrap_or(""),
                "params_schema": tool.get("inputSchema").cloned().unwrap_or_else(|| json!({})),
                "reversible": athena.and_then(|a| a.get("reversible")).cloned(),
                "side_effects": athena
                    .and_then(|a| a.get("side_effects"))
                    .and_then(Value::as_str)
                    .unwrap_or("internal"),
                "transport": "webmcp",
            })
        })
        .collect();
    Some(json!({
        "app_id": app_id,
        "app_version": page.get("app_version").and_then(Value::as_str).unwrap_or("0"),
        "page_origin": page.get("origin").and_then(Value::as_str).unwrap_or(""),
        "tools": mapped,
        "origin_kind": "host",
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reply(label: &str, message: Value) -> Reply {
        Reply {
            label: label.into(),
            message,
        }
    }

    #[test]
    fn a_request_carries_the_namespace_the_direction_and_an_id() {
        let relay = Relay::new();
        let request = relay.list("page-1");

        assert_eq!(request.message["__ns"], NAMESPACE);
        assert_eq!(request.message["dir"], "to-page");
        assert!(request.message["id"].is_string());
        assert_eq!(relay.in_flight(), 1);
    }

    #[test]
    fn two_requests_never_share_an_id() {
        let relay = Relay::new();
        let first = relay.list("page-1");
        let second = relay.list("page-1");

        assert_ne!(first.message["id"], second.message["id"]);
    }

    #[test]
    fn an_answer_settles_its_request_exactly_once() {
        let relay = Relay::new();
        let id = relay.list("page-1").message["id"]
            .as_str()
            .unwrap()
            .to_string();
        let message = json!({ "__ns": NAMESPACE, "dir": "to-ext", "id": id, "ok": true });

        let first = relay.receive(&reply("page-1", message.clone()));
        let second = relay.receive(&reply("page-1", message));

        assert!(matches!(first, Outcome::Answered { .. }));
        assert_eq!(second, Outcome::Ignored);
        assert_eq!(relay.in_flight(), 0);
    }

    #[test]
    fn another_pages_reply_does_not_settle_this_pages_request() {
        let relay = Relay::new();
        let id = relay.list("page-1").message["id"]
            .as_str()
            .unwrap()
            .to_string();
        let message = json!({ "__ns": NAMESPACE, "dir": "to-ext", "id": id, "ok": true });

        assert_eq!(relay.receive(&reply("page-2", message)), Outcome::Ignored);
        assert_eq!(relay.in_flight(), 1, "the real page can still answer");
    }

    #[test]
    fn a_message_without_the_namespace_is_not_ours() {
        let relay = Relay::new();
        let outcome = relay.receive(&reply("page-1", json!({ "dir": "to-ext", "id": "x" })));
        assert_eq!(outcome, Outcome::Ignored);
    }

    #[test]
    fn a_message_going_the_wrong_way_is_ignored() {
        // `to-page` on the reply channel would be the relay hearing its own request back.
        let relay = Relay::new();
        let outcome = relay.receive(&reply(
            "page-1",
            json!({ "__ns": NAMESPACE, "dir": "to-page", "id": "x" }),
        ));
        assert_eq!(outcome, Outcome::Ignored);
    }

    #[test]
    fn a_toolchange_is_an_event_and_not_a_reply() {
        let relay = Relay::new();
        let outcome = relay.receive(&reply(
            "page-1",
            json!({ "__ns": NAMESPACE, "dir": "to-ext", "id": null, "type": "toolchange" }),
        ));
        assert_eq!(
            outcome,
            Outcome::ToolChange {
                label: "page-1".into()
            }
        );
    }

    #[test]
    fn the_sweep_drops_what_the_page_never_answered() {
        let relay = Relay::new();
        relay.list("page-1");
        let later = Instant::now() + RELAY_TIMEOUT + Duration::from_secs(1);

        let expired = relay.sweep(later);

        assert_eq!(expired.len(), 1);
        assert_eq!(relay.in_flight(), 0);
    }

    #[test]
    fn the_sweep_leaves_a_request_that_is_still_inside_its_window() {
        let relay = Relay::new();
        relay.list("page-1");

        assert!(relay.sweep(Instant::now()).is_empty());
        assert_eq!(relay.in_flight(), 1);
    }

    #[test]
    fn closing_a_tab_forgets_only_that_tabs_requests() {
        let relay = Relay::new();
        relay.list("page-1");
        relay.list("page-2");

        assert_eq!(relay.forget("page-1"), 1);
        assert_eq!(relay.in_flight(), 1);
    }

    #[test]
    fn a_list_answer_becomes_a_manifest_the_daemon_can_merge() {
        let answer = json!({
            "ok": true,
            "page": { "app_id": "invoices", "origin": "https://invoices.example", "app_version": "1.4.0" },
            "tools": [{
                "name": "chase",
                "description": "Send a chase.",
                "inputSchema": { "type": "object" },
                "athena": { "reversible": false, "side_effects": "external" }
            }]
        });

        let manifest = manifest_from_list(&answer).expect("a page that named itself");

        assert_eq!(manifest["app_id"], "invoices");
        assert_eq!(manifest["page_origin"], "https://invoices.example");
        assert_eq!(manifest["tools"][0]["reversible"], false);
        assert_eq!(manifest["tools"][0]["side_effects"], "external");
    }

    #[test]
    fn a_tool_that_claims_nothing_keeps_a_null_reversible() {
        // Null and not `false`: the manifest's validator refuses the omission by name, and a
        // relay that guessed would be deciding a class here instead of in the catalog.
        let answer = json!({
            "ok": true,
            "page": { "app_id": "invoices", "origin": "https://invoices.example" },
            "tools": [{ "name": "peek", "inputSchema": {} }]
        });

        let manifest = manifest_from_list(&answer).unwrap();

        assert!(manifest["tools"][0]["reversible"].is_null());
    }

    #[test]
    fn a_page_that_names_no_app_id_yields_no_manifest() {
        let answer = json!({ "ok": true, "page": { "origin": "https://x.example" }, "tools": [] });
        assert!(manifest_from_list(&answer).is_none());
    }

    #[test]
    fn the_injection_carries_both_halves_of_the_bridge() {
        let script = injection_script("page-1");

        assert!(script.contains("__ATHENA_WEBVIEW__"));
        assert!(script.contains("modelContext"), "inject.js is missing");
        assert!(script.contains("page:reply"), "relay.js is missing");
    }
}
