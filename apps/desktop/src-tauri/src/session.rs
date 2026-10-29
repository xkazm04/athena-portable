//! Session restore - a restart lands where the person left (ADR 0209, README section 3.1).
//!
//! The shell owns the tabs (`tabs.rs`), so it owns their return. Two `settings` rows carry it
//! across a launch, both written by the shell and never by a view:
//!
//! - `shell.session` - `{ "tabs": [{ "url", "focused" }] }`, the restorable part of the tab list,
//!   written only when that part changes (a title change is not a change). A closed tab leaves it
//!   at the close, so a restart never reopens what the person closed.
//! - `shell.tab_seq` - the highest tab id ever issued. A launch seeds the id counter from it, so a
//!   tab id is never reissued: a card still bound to last launch's tab 3 (ADR 0103) finds no tab 3
//!   rather than a different page that happens to be tab 3 this time.
//!
//! What is restorable is re-derived natively on the way out *and* on the way in: http and https
//! only, at most [`SESSION_MAX`] tabs with the focused one always kept, no url over [`URL_MAX`]
//! characters, and never an origin the person has since switched off (an `origins` row with
//! `enabled: false`). Everything here but [`launch`] and [`persist`] is arithmetic, tested below.
//!
//! A smoke run (`ATHENA_SMOKE`, `ATHENA_SMOKE_HANDS`) restores nothing and writes nothing: it is a
//! command-line probe, and a probe never reopens a person's tabs.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Url};

use crate::tabs::{self, Tab, Tabs};

/// The `settings` row holding the last session's restorable tabs.
pub const SESSION_KEY: &str = "shell.session";
/// The `settings` row holding the highest tab id ever issued.
pub const TAB_SEQ_KEY: &str = "shell.tab_seq";
/// At most this many tabs come back. A launch that opens forty webviews is not a restore.
pub const SESSION_MAX: usize = 12;
/// A url longer than this is not written. A deep link is a few hundred characters; anything past
/// this is a page that stuffed its state into the address bar.
pub const URL_MAX: usize = 2048;

/// One restorable tab.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub url: String,
    #[serde(default)]
    pub focused: bool,
}

/// What a change to the tab list asks the store to write. Empty is the common case.
#[derive(Debug, Default, PartialEq)]
pub struct Writes {
    pub session: Option<Value>,
    pub seq: Option<u32>,
}

impl Writes {
    pub fn is_empty(&self) -> bool {
        self.session.is_none() && self.seq.is_none()
    }
}

/// Is this url one a restart may reopen? http and https with a host, and not absurdly long.
pub fn restorable(url: &str) -> bool {
    if url.len() > URL_MAX {
        return false;
    }
    matches!(Url::parse(url), Ok(u) if matches!(u.scheme(), "http" | "https") && u.has_host())
}

/// The restorable part of a tab list, bounded.
pub fn snapshot(list: &[Tab]) -> Vec<Entry> {
    bound(
        list.iter()
            .filter(|t| restorable(&t.url))
            .map(|t| Entry { url: t.url.clone(), focused: t.focused })
            .collect(),
    )
}

/// At most one focused entry and at most [`SESSION_MAX`] entries, the focused one always kept.
fn bound(mut entries: Vec<Entry>) -> Vec<Entry> {
    let mut seen = false;
    for e in entries.iter_mut() {
        if e.focused && std::mem::replace(&mut seen, true) {
            e.focused = false;
        }
    }
    if entries.len() > SESSION_MAX {
        match entries.iter().position(|e| e.focused) {
            Some(i) if i >= SESSION_MAX => {
                let focused = entries.remove(i);
                entries.truncate(SESSION_MAX - 1);
                entries.push(focused);
            }
            _ => entries.truncate(SESSION_MAX),
        }
    }
    entries
}

/// The row a snapshot is written as.
pub fn record(entries: &[Entry]) -> Value {
    json!({ "tabs": entries })
}

/// What a launch opens: urls in strip order, which one is in front, and which one is the launch
/// argument (the smokes ask that tab).
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Plan {
    pub open: Vec<String>,
    pub focus: Option<usize>,
    pub start: Option<usize>,
}

/// Turn a saved row and an optional launch url into a restore plan.
///
/// The saved row is re-filtered here rather than trusted: a hand-edited row, or one written before
/// an origin was switched off, restores only what is restorable now. A missing, `null` or
/// malformed row is an empty plan, and the shell opens as it always did.
pub fn plan(saved: &Value, start_url: Option<&str>, refused: &dyn Fn(&str) -> bool) -> Plan {
    let entries: Vec<Entry> = saved
        .get("tabs")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|v| serde_json::from_value::<Entry>(v.clone()).ok())
                .filter(|e| restorable(&e.url) && !refused(&e.url))
                .collect()
        })
        .unwrap_or_default();

    let mut out = Plan::default();
    for e in bound(entries) {
        let at = match out.open.iter().position(|u| *u == e.url) {
            Some(at) => at,
            None => {
                out.open.push(e.url);
                out.open.len() - 1
            }
        };
        if e.focused {
            out.focus = Some(at);
        }
    }
    if let Some(url) = start_url.filter(|u| !u.is_empty()) {
        let wanted = normalise(url);
        let at = match out.open.iter().position(|u| normalise(u) == wanted) {
            Some(at) => at,
            None => {
                out.open.push(url.to_string());
                out.open.len() - 1
            }
        };
        out.focus = Some(at);
        out.start = Some(at);
    }
    if out.focus.is_none() && !out.open.is_empty() {
        out.focus = Some(out.open.len() - 1);
    }
    out
}

/// Is this process a smoke run? Any smoke variable, set and non-empty.
pub fn is_smoke_run(env: &dyn Fn(&str) -> Option<String>) -> bool {
    ["ATHENA_SMOKE", "ATHENA_SMOKE_HANDS", "ATHENA_SMOKE_DAEMON"]
        .iter()
        .any(|k| env(k).is_some_and(|v| !v.is_empty()))
}

/// The stored high-water mark, or 0 for a row that is missing or not a number.
pub fn seq_of(row: &Value) -> u32 {
    row.as_u64().map_or(0, |n| u32::try_from(n).unwrap_or(u32::MAX))
}

/// Does this `origins` row switch its origin off? No row (`null`) is first sight, not a refusal.
pub fn refused_by(row: &Value) -> bool {
    row.get("enabled") == Some(&Value::Bool(false))
}

/// Restore the last session at launch, then open the launch url, and arm change-driven persisting.
/// Answers the id the launch url opened as, which is the tab the smokes ask.
///
/// Background tabs open behind, in strip order, and the one that was in front is created focused;
/// a restored tab is a page like any other, and its origin's row decides what Athena may do there.
pub fn launch(app: &AppHandle, start_url: Option<&str>, smoke: bool) -> Option<u32> {
    let store = crate::store::opened(app).ok();
    let read = |table: &str, key: &str| {
        store
            .as_ref()
            .and_then(|s| s.get(table, key).ok())
            .unwrap_or(Value::Null)
    };
    app.state::<Tabs>().seed(seq_of(&read("settings", TAB_SEQ_KEY)));
    let saved = if smoke { Value::Null } else { read("settings", SESSION_KEY) };
    let refused = |url: &str| {
        let origin = tabs::origin_of(url);
        !origin.is_empty() && refused_by(&read("origins", &origin))
    };
    let plan = plan(&saved, start_url, &refused);

    let mut start_id = None;
    for (i, url) in plan.open.iter().enumerate() {
        let made = if Some(i) == plan.focus {
            tabs::create(app, url)
        } else {
            tabs::create_background(app, url)
        };
        match made {
            Ok(id) => {
                eprintln!("[tabs] opened {url} as tab {id}");
                if Some(i) == plan.start {
                    start_id = Some(id);
                }
            }
            Err(e) => eprintln!("[tabs] cannot open {url}: {e}"),
        }
    }
    if !smoke {
        app.state::<Tabs>().arm_session();
        persist(app);
    }
    start_id
}

/// Serialises compute-and-write, so two announces on two threads cannot land their rows in the
/// opposite order to the snapshots they computed.
static PERSIST: Mutex<()> = Mutex::new(());

/// Write whatever the tab list's last change asks for. Called from `tabs::announce`, which every
/// mutation goes through; a no-op until [`launch`] armed it, and for a title-only change.
pub fn persist(app: &AppHandle) {
    let _guard = PERSIST.lock().unwrap_or_else(|e| e.into_inner());
    let writes = app.state::<Tabs>().pending_writes();
    if writes.is_empty() {
        return;
    }
    let Ok(store) = crate::store::opened(app) else {
        return;
    };
    if let Some(row) = writes.session {
        if let Err(e) = store.set("settings", SESSION_KEY, &row) {
            eprintln!("[session] cannot write {SESSION_KEY}: {e}");
        }
    }
    if let Some(seq) = writes.seq {
        if let Err(e) = store.set("settings", TAB_SEQ_KEY, &json!(seq)) {
            eprintln!("[session] cannot write {TAB_SEQ_KEY}: {e}");
        }
    }
}

fn normalise(url: &str) -> String {
    Url::parse(url)
        .map(|u| u.to_string())
        .unwrap_or_else(|_| url.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tab(id: u32, url: &str, focused: bool) -> Tab {
        Tab {
            id,
            label: tabs::label_for(id),
            url: url.to_string(),
            title: String::new(),
            focused,
            nav: 0,
        }
    }

    fn saved(entries: &[(&str, bool)]) -> Value {
        let list: Vec<Entry> = entries
            .iter()
            .map(|&(url, focused)| Entry { url: url.to_string(), focused })
            .collect();
        record(&list)
    }

    fn allow(_: &str) -> bool {
        false
    }

    #[test]
    fn a_snapshot_keeps_http_and_https_tabs_and_marks_the_focused_one() {
        let list = [
            tab(1, "https://ledger.test/inv/42", true),
            tab(2, "http://127.0.0.1:8731/", false),
            tab(3, "file:///C:/x.html", false),
            tab(4, "data:text/html,hi", false),
        ];
        assert_eq!(
            snapshot(&list),
            vec![
                Entry { url: "https://ledger.test/inv/42".into(), focused: true },
                Entry { url: "http://127.0.0.1:8731/".into(), focused: false },
            ],
            "file: and data: are not written"
        );
    }

    #[test]
    fn a_snapshot_of_twenty_tabs_keeps_twelve_with_the_focused_one_and_drops_a_long_url() {
        let mut list: Vec<Tab> =
            (1..=20).map(|i| tab(i, &format!("https://a.test/{i}"), i == 20)).collect();
        list[0].url = format!("https://a.test/{}", "x".repeat(URL_MAX));
        let snap = snapshot(&list);
        assert_eq!(snap.len(), SESSION_MAX);
        assert!(
            snap.iter().any(|e| e.focused && e.url == "https://a.test/20"),
            "the focused tab is always among them"
        );
        assert!(snap.iter().all(|e| e.url.len() <= URL_MAX), "a url over the cap is dropped");
        assert_eq!(snap.iter().filter(|e| e.focused).count(), 1);
    }

    #[test]
    fn a_plan_reopens_the_saved_tabs_and_a_launch_url_wins_focus_without_a_duplicate() {
        let a = "https://a.test/one";
        let b = "https://b.test/two";
        let c = "https://c.test/three";
        let row = saved(&[(a, false), (b, true)]);

        let p = plan(&row, None, &allow);
        assert_eq!(p.open, vec![a, b]);
        assert_eq!(p.focus, Some(1), "b was in front and is in front again");
        assert_eq!(p.start, None);

        let p = plan(&row, Some(c), &allow);
        assert_eq!(p.open, vec![a, b, c]);
        assert_eq!(p.focus, Some(2), "a launch argument wins focus");
        assert_eq!(p.start, Some(2));

        let p = plan(&row, Some("https://a.test/one"), &allow);
        assert_eq!(p.open, vec![a, b], "a launch url equal to a saved one is not opened twice");
        assert_eq!((p.focus, p.start), (Some(0), Some(0)));

        for broken in [
            Value::Null,
            json!("nonsense"),
            json!({ "tabs": "no" }),
            json!({ "tabs": [{ "url": 7 }, { "focused": true }, "x"] }),
            json!([1, 2]),
        ] {
            assert_eq!(plan(&broken, None, &allow), Plan::default(), "{broken} restores nothing");
        }
        let p = plan(&Value::Null, Some(c), &allow);
        assert_eq!((p.open, p.focus, p.start), (vec![c.to_string()], Some(0), Some(0)));
    }

    #[test]
    fn a_plan_never_reopens_an_origin_since_switched_off_or_a_scheme_written_by_hand() {
        let row = saved(&[
            ("https://ok.test/a", false),
            ("https://off.test/b", true),
            ("file:///C:/x.html", false),
        ]);
        let off = |url: &str| tabs::origin_of(url) == "https://off.test";
        let p = plan(&row, None, &off);
        assert_eq!(p.open, vec!["https://ok.test/a"], "the switched-off origin stays closed");
        assert_eq!(p.focus, Some(0), "focus falls to what was restored");

        assert!(refused_by(&json!({ "origin": "https://off.test", "enabled": false })));
        assert!(!refused_by(&json!({ "origin": "https://on.test", "enabled": true })));
        assert!(!refused_by(&Value::Null), "no row is first sight, not a refusal");
    }

    #[test]
    fn the_high_water_mark_reads_a_number_and_nothing_else() {
        assert_eq!(seq_of(&json!(41)), 41);
        assert_eq!(seq_of(&Value::Null), 0);
        assert_eq!(seq_of(&json!("41")), 0);
        assert_eq!(seq_of(&json!(-3)), 0);
    }

    #[test]
    fn a_smoke_run_restores_nothing_and_writes_nothing() {
        let env = |set: &'static [(&'static str, &'static str)]| {
            move |k: &str| set.iter().find(|(n, _)| *n == k).map(|(_, v)| v.to_string())
        };
        assert!(is_smoke_run(&env(&[("ATHENA_SMOKE", "1")])));
        assert!(is_smoke_run(&env(&[("ATHENA_SMOKE_HANDS", "1")])));
        assert!(is_smoke_run(&env(&[("ATHENA_SMOKE_DAEMON", "1")])));
        assert!(!is_smoke_run(&env(&[("ATHENA_SMOKE", "")])), "an empty variable is unset");
        assert!(!is_smoke_run(&env(&[])));

        // What `launch` does under a smoke: the saved row is not read, so only the start url opens
        // and it is the tab the smoke asks; and `Tabs` is never armed, so nothing is written.
        let row = saved(&[("https://a.test/", true)]);
        let smoke_saved = if is_smoke_run(&env(&[("ATHENA_SMOKE", "1")])) { Value::Null } else { row };
        let p = plan(&smoke_saved, Some("http://127.0.0.1:5173/scratch/webmcp-page.html"), &allow);
        assert_eq!(p.open.len(), 1);
        assert_eq!(p.start, Some(0));

        let unarmed = Tabs::default();
        unarmed.seed(41);
        let _ = unarmed.add("https://a.test/", true);
        assert!(unarmed.pending_writes().is_empty(), "an unarmed shell writes no session row");
    }
}
