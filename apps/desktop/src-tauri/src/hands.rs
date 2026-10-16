//! The generic hands — README section 3.4 tier 2, plan c24.
//!
//! Tier 1 is what a page chose to offer. This is what Athena can do on a page that offered
//! nothing, which is nearly every page. `hands.js` runs in the page's main world and holds the ref
//! map; this module is the catalogue, the wire and the refusals.
//!
//! **A hand never rejects.** `hands_call` returns a `Hand` result on every path, including the
//! ones where nothing ran: no such tab, no such hand, the page never answered. A command that
//! returned `Err` would surface in the panel as a thrown promise rather than as a tool result the
//! model can read and act on, and a refusal the model cannot read is a refusal it will make again.
//!
//! **Every refusal is a member of the one closed vocabulary** (`ERROR_REASONS`,
//! `src/athena/contracts/harness.py`). `unknown_ref` for a ref that was never minted or belongs to
//! a document that has been left, `validator_failed` for a control that cannot take the operation,
//! `timeout` for a page that did not answer.
//!
//! **The class is not decided here.** These are capabilities; the catalog classifies them from the
//! flags below exactly as it classifies a page's own tools, and README section 3.3 adds that the
//! hands are `GATED` on first sight for every new origin whatever those flags say. Nothing in this
//! file may argue a hand out of a card.
//!
//! **The ninth hand is the shell's, not the page's.** `page_screenshot` never reaches `hands.js`:
//! a page cannot photograph itself, and one that could would be photographing whatever it liked.
//! It is answered here — the window is drawn by the OS, cropped to the page rectangle `layout`
//! owns, and filed in the `captures` table, and the hand answers with the id of the row. That id
//! is what a gated proposal carries, so a person asked to approve `page_click` on a ref can judge
//! the page instead of the ref (README section 5 puts this on the never-cut list). See
//! [`crate::capture`] for why the window and not the webview.
//!
//! **The tenth is the shell's too.** `tabs_read` reads another open tab by its url (ADR 0105).
//! The shell resolves the url, refuses a tab whose web origin is not an enabled `origins` row
//! before that tab's relay is touched, and asks that tab's `hands.js` for `page_read` and nothing
//! else. It never calls the other page's tools and never registers it. What it brings back is
//! what the gate then guards; that rule is `harness/hooks.py`'s, not this file's.

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::{bridge, capture, store, tabs};

/// What a page's own answer may carry back before the shell cuts it.
///
/// `hands.js` packs its reads under 1,500 characters, so each survives the lane's 1,600-character
/// cut (ADR 0102), and announces what it left for a cursor; this is the second wall,
/// for a page that answered with something the script did not produce. Two bounds rather than one
/// because only one of them is in code the shell controls.
const OUTPUT_CAP: usize = 8_000;

/// Who answers a hand: the page it is on, or the shell around it.
///
/// Eight of the nine are the page's, and `hands.js` is their implementation. The ninth is the
/// shell's because a page cannot photograph itself. The field exists so that one dispatch reads
/// the table rather than matching on a name, and so the parity tests against `hands.js` compare
/// the right subset: a page hand missing from the script is a drift, and the shell hand missing
/// from it is the design.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Runner {
    Page,
    Shell,
}

/// One hand, as the catalog is told about it.
///
/// `reversible` and `side_effects` are the same two flags a page publishes for its own tools
/// (`HostTool`, `src/athena/contracts/manifest.py`), so a hand merges into a manifest with no
/// special case and the class comes out of the same derivation.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Hand {
    pub name: &'static str,
    pub description: &'static str,
    /// `false` for anything that changes the page, which is what keeps a hand out of `AUTO`.
    pub reversible: bool,
    /// `none`, `internal` or `external`. A hand never claims `external`: it cannot know whether
    /// the button it presses sends an email, and guessing low is how a chase goes out unasked.
    /// `internal` plus `reversible: false` is already `GATED`, which is the honest floor.
    pub side_effects: &'static str,
    /// Where the work happens, which is where [`call`] sends it.
    pub runner: Runner,
}

/// The ten, in the order a person would use them: look, then act, then show what was seen, then
/// look at another tab (ADR 0105).
pub const HANDS: &[Hand] = &[
    Hand {
        name: "page_read",
        description: "The visible text of the page, or of one element you have a ref for. A long answer comes in parts; its first line names a cursor, pass it back as cursor for the next part.",
        reversible: true,
        side_effects: "none",
        runner: Runner::Page,
    },
    Hand {
        name: "page_find",
        description: "Operable elements whose label matches a query, each with a ref to act on. Many matches come in parts; the first line names a cursor, pass it back as cursor for the next part.",
        reversible: true,
        side_effects: "none",
        runner: Runner::Page,
    },
    Hand {
        name: "page_wait",
        description: "Wait, up to a bound, for text to appear on the page.",
        reversible: true,
        side_effects: "none",
        runner: Runner::Page,
    },
    Hand {
        name: "page_scroll",
        description: "Bring a ref into view, or move the page by one screen.",
        reversible: true,
        side_effects: "internal",
        runner: Runner::Page,
    },
    Hand {
        name: "page_click",
        description: "Click the element a ref names. Pass expect, the label page_find gave it: if the element no longer reads that, nothing is clicked.",
        reversible: false,
        side_effects: "internal",
        runner: Runner::Page,
    },
    Hand {
        name: "page_fill",
        description: "Put a value into the field a ref names. Pass expect, the label page_find gave it: if the field no longer reads that, nothing is typed.",
        reversible: false,
        side_effects: "internal",
        runner: Runner::Page,
    },
    Hand {
        name: "page_select",
        description: "Choose an option, by its visible label, in the select a ref names. Pass expect, the label page_find gave it: if the select no longer reads that, nothing changes.",
        reversible: false,
        side_effects: "internal",
        runner: Runner::Page,
    },
    Hand {
        name: "page_submit",
        description: "Submit the form the ref sits in. Pass expect, the label page_find gave the ref: if the element no longer reads that, nothing is submitted.",
        reversible: false,
        side_effects: "internal",
        runner: Runner::Page,
    },
    Hand {
        name: SCREENSHOT,
        description: "A picture of the page as it is now, filed as evidence for a decision card.",
        // A picture changes nothing on the page, and taking one twice is taking one twice. Which
        // makes this the second hand the catalog can classify AUTO — and it still arrives GATED
        // on an origin the user has not trusted yet, like every other hand (README section 3.3).
        reversible: true,
        side_effects: "none",
        runner: Runner::Shell,
    },
    Hand {
        name: TABS_READ,
        description: "The text of another open tab, by its url, without acting there; only a tab whose site the person trusts. Pass query to keep the parts that mention it. A long answer names a cursor; pass it back with the same url.",
        // A read of another page changes nothing anywhere, which derives AUTO. What it brings back
        // is what the gate guards: every call on the focused page after it files a card for the
        // rest of the turn (ADR 0105), and that rule lives in `harness/hooks.py`, not here.
        reversible: true,
        side_effects: "none",
        runner: Runner::Shell,
    },
];

/// The shell hand that photographs the page. Named once, because three places ask for it by name.
pub const SCREENSHOT: &str = "page_screenshot";

/// The shell hand that reads another open tab (ADR 0105). The panel and the gate name it too.
pub const TABS_READ: &str = "tabs_read";

/// The longest url `tabs_read` takes: an open tab's url, as `tabs_list` reports it.
pub const URL_MAX: usize = 2048;

/// The longest query a scoped read takes. `hands.js` holds the same bound as `QUERY_MAX`.
pub const QUERY_MAX: usize = 200;

/// The most the `from` line of a `tabs_read` may be, so a 1,500-character packet plus this line
/// still fits the lane's 1,600-character cut whole (ADR 0102, 0105).
pub const FROM_LINE_MAX: usize = 99;

/// The hand of that name, if the table holds one.
///
/// The one lookup, so [`call`] reads the row it is about to dispatch on rather than asking one
/// question about the name and then a second about what to do with it.
pub fn hand(name: &str) -> Option<&'static Hand> {
    HANDS.iter().find(|hand| hand.name == name)
}

/// The hands as **WebMCP tools**, in the shape `inject.js` reports a page's own tools in.
///
/// One shape rather than two, and this is the one, because it is the shape both consumers already
/// take. `gate.js`'s `flagsOf` reads the `athena` block and `manifestOf` turns a list of these into
/// a host manifest — so a surface appends the hands to whatever the page listed, hands the single
/// list to `manifestOf`, and the classes come out of the same derivation for both. A second,
/// manifest-shaped emitter here would be a second place the flags are spelled, and the day they
/// disagree is the day a hand is `AUTO` on one surface and `GATED` on another.
///
/// A hand a page already registered under the same name is *not* filtered here: only the caller
/// knows what the page offered.
pub fn webmcp_tools() -> Vec<Value> {
    HANDS
        .iter()
        .map(|hand| {
            json!({
                "name": hand.name,
                "title": hand.name,
                "description": hand.description,
                "inputSchema": schema_for(hand.name),
                // The standard hints, so a surface that reads only those still classifies a hand
                // correctly. They agree with the `athena` block below by construction.
                "annotations": {
                    "readOnlyHint": hand.side_effects == "none",
                    "consequentialHint": !hand.reversible,
                },
                "athena": {
                    "reversible": hand.reversible,
                    "side_effects": hand.side_effects,
                },
            })
        })
        .collect()
}

/// The longest cursor `page_read` and `page_find` take back. `hands.js` holds the same bound as
/// `CURSOR_MAX`, and a test reads it out of the script. A cursor is
/// `cur_<generation>_<snapshot>_<offset>`, three integers, so 64 is generous (ADR 0102).
pub const CURSOR_MAX: usize = 64;

/// The longest `expect` an acting hand takes: the label `page_find` handed back, which `hands.js`
/// cuts at `LABEL_CAP` (ADR 0104). Optional, so a call without one acts as it always did.
pub const EXPECT_MAX: usize = 120;

/// The parameters each hand takes, as the capability block renders them.
fn schema_for(name: &str) -> Value {
    let ref_param = json!({ "type": "string", "maxLength": 64 });
    // Optional on both reads: a call without one is the read it always was, and only an answer
    // too long for one packet hands one back.
    let cursor_param = json!({ "type": "string", "maxLength": CURSOR_MAX });
    // The label the acting hands check before they act (ADR 0104).
    let expect_param = json!({ "type": "string", "maxLength": EXPECT_MAX });
    match name {
        // No parameters at all: the picture is of the page on screen, and there is nothing about
        // it for a caller to choose. A `ref` here would promise a crop the capture cannot do.
        SCREENSHOT => json!({ "type": "object", "properties": {} }),
        TABS_READ => json!({
            "type": "object",
            "properties": {
                "url": { "type": "string", "maxLength": URL_MAX },
                "query": { "type": "string", "maxLength": QUERY_MAX },
                "cursor": cursor_param,
            },
            "required": ["url"],
        }),
        "page_read" => json!({
            "type": "object",
            "properties": { "ref": ref_param, "cursor": cursor_param },
        }),
        "page_find" => json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "maxLength": 200 },
                "role": { "type": "string", "maxLength": 40 },
                "cursor": cursor_param,
            },
        }),
        "page_wait" => json!({
            "type": "object",
            "properties": {
                "text": { "type": "string", "maxLength": 200 },
                "timeout_ms": { "type": "integer", "minimum": 100, "maximum": 15000 },
            },
            "required": ["text"],
        }),
        "page_scroll" => json!({
            "type": "object",
            "properties": {
                "ref": ref_param,
                "direction": { "type": "string", "enum": ["up", "down"] },
            },
        }),
        "page_fill" | "page_select" => json!({
            "type": "object",
            "properties": {
                "ref": ref_param,
                "value": { "type": "string", "maxLength": 2000 },
                "expect": expect_param,
            },
            "required": ["ref", "value"],
        }),
        "page_click" | "page_submit" => json!({
            "type": "object",
            "properties": { "ref": ref_param, "expect": expect_param },
            "required": ["ref"],
        }),
        _ => json!({
            "type": "object",
            "properties": { "ref": ref_param },
            "required": ["ref"],
        }),
    }
}

/// What a hand answers. Never an `Err`: see the module header.
#[derive(Debug, Clone, Serialize)]
pub struct HandResult {
    pub ok: bool,
    pub output: String,
    /// A member of `ERROR_REASONS` when `ok` is false, and `null` when it is true.
    pub reason: Option<String>,
    pub error: Option<String>,
    /// Always 2. The record shows where a call happened, and a hand happens on the page.
    pub tier: u8,
    pub ms: u64,
    /// The `captures` row this call filed, and `null` for every hand but `page_screenshot`.
    ///
    /// Structured as well as spoken: the output line names the id so the model can cite it in an
    /// `OP:` line, and this field is what a surface reads to put a picture on a card without
    /// parsing a sentence.
    pub capture_id: Option<String>,
    /// The tab a `tabs_read` read, and that tab's web origin; `null` for every other hand and for
    /// a refusal. The panel sets the result's `source` from these and from nothing a model said.
    pub source_tab: Option<u32>,
    pub source_origin: Option<String>,
}

impl HandResult {
    fn refused(reason: &str, detail: impl Into<String>, ms: u64) -> Self {
        Self {
            ok: false,
            output: String::new(),
            reason: Some(reason.to_string()),
            error: Some(detail.into()),
            tier: 2,
            ms,
            capture_id: None,
            source_tab: None,
            source_origin: None,
        }
    }
}

/// Run one hand on one tab.
pub async fn call(app: &AppHandle, tab: u32, name: &str, input: Value) -> HandResult {
    let started = std::time::Instant::now();
    let elapsed = |at: std::time::Instant| at.elapsed().as_millis() as u64;

    let Some(hand) = hand(name) else {
        return HandResult::refused(
            "unknown_ref",
            format!("no hand named {name}"),
            elapsed(started),
        );
    };
    // One dispatch, off the table, so adding a shell hand is a row rather than a branch.
    if hand.runner == Runner::Shell {
        if hand.name == TABS_READ {
            return tabs_read(app, tab, &input, started).await;
        }
        return screenshot(app, tab, elapsed(started));
    }
    let body = json!({ "hand": name, "input": input });
    match bridge::ask_hands(app, tab, body).await {
        // The relay could not reach the tab at all. Not a page refusing — a tab that is gone.
        Err(detail) => HandResult::refused("unknown_ref", detail, elapsed(started)),
        Ok(answer) => from_page(&answer, elapsed(started)),
    }
}

/// `page_screenshot`: draw the window, crop to the page, file the PNG, answer with the row id.
///
/// **Only the focused tab.** A capture is of what is on screen, and `layout` shows exactly one
/// page at a time. Asked about any other tab this refuses rather than handing back a picture of a
/// different page under that tab's id — a card whose picture is of somewhere else is worse than a
/// card with no picture, because the person approving it cannot tell.
///
/// Synchronous, unlike every other hand: nothing here waits on a page. `PrintWindow` and the store
/// write both return before the call does, which is why this takes no `.await` and why a capture
/// cannot be the thing that makes a turn time out.
fn screenshot(app: &AppHandle, tab: u32, ms: u64) -> HandResult {
    use tauri::Manager;

    let focused = app.state::<tabs::Tabs>().focused();
    if focused != Some(tab) {
        // `validator_failed`: the call is well formed and the hand exists, but the state it needs
        // is not the state the window is in. The detail names what to do about it.
        return HandResult::refused("validator_failed", not_on_screen(focused, tab), ms);
    }

    let shot = match capture::capture(app) {
        Ok(shot) => shot,
        // Nothing was photographed: no page on screen, an unsupported platform, or a window that
        // would not draw itself. All three are the same thing to a caller — there is no picture —
        // and the detail says which.
        Err(detail) => return HandResult::refused("validator_failed", detail, ms),
    };

    let url = app.state::<tabs::Tabs>().url_for(tab).unwrap_or_default();
    // The picture exists and could not be filed, which is not the caller's fault and not a policy
    // refusal either. `unknown` is the catch-all the vocabulary keeps for exactly this.
    let filed = store::opened(app)
        .and_then(|store| store.put_capture(tab, &tabs::origin_of(&url), &shot.png));
    let id = match filed {
        Ok(id) => id,
        Err(detail) => return HandResult::refused("unknown", detail, ms),
    };

    HandResult {
        ok: true,
        // The id first, because it is the part a later `OP:` line has to repeat. The size is for
        // a person reading the transcript; the model has no use for it and no way to change it.
        output: format!(
            "{id} · a capture of {} at {}x{} pixels",
            if url.is_empty() { "the page" } else { &url },
            shot.width,
            shot.height
        ),
        reason: None,
        error: None,
        tier: 2,
        ms,
        capture_id: Some(id),
        source_tab: None,
        source_origin: None,
    }
}

/// Why `page_screenshot` cannot photograph `tab`: it is not the one on screen. A sentence the
/// model reads and a person may see on the card, so it is one line with single spaces.
fn not_on_screen(focused: Option<u32>, tab: u32) -> String {
    match focused {
        Some(other) => format!(
            "a capture is of the page on screen, which is tab {other}, not tab {tab}; \
             focus tab {tab} first"
        ),
        None => "no tab is focused, so there is no page to capture".to_string(),
    }
}

/// What a `tabs_read` asked for, checked before anything is looked up.
#[derive(Debug, PartialEq, Eq)]
struct ReadAsk {
    url: String,
    query: Option<String>,
    cursor: Option<String>,
}

/// The parameters of a `tabs_read`, or the `validator_failed` sentence. Bounded as the schema is.
fn read_ask(input: &Value) -> Result<ReadAsk, String> {
    let url = input
        .get("url")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if url.is_empty() {
        return Err("tabs_read needs the url of an open tab".to_string());
    }
    if url.chars().count() > URL_MAX {
        return Err(format!("a url is at most {URL_MAX} characters"));
    }
    let optional = |key: &str, max: usize| -> Result<Option<String>, String> {
        match input.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(v)) if v.chars().count() <= max => Ok(Some(v.clone())),
            Some(_) => Err(format!("{key} is a string of at most {max} characters")),
        }
    };
    Ok(ReadAsk {
        url: url.to_string(),
        query: optional("query", QUERY_MAX)?,
        cursor: optional("cursor", CURSOR_MAX)?,
    })
}

/// The open tab a `tabs_read` names, or the refusal: `unknown_ref` when no tab is at that url,
/// `validator_failed` when it is the tab the call came from (that one is read with `page_read`).
fn pick_tab<'a>(
    open: &'a [tabs::Tab],
    caller: u32,
    url: &str,
) -> Result<&'a tabs::Tab, (&'static str, String)> {
    let wanted = url.trim_end_matches('/');
    let Some(tab) = open
        .iter()
        .find(|t| t.url.trim_end_matches('/') == wanted)
    else {
        return Err((
            "unknown_ref",
            format!("no open tab is at {url}; the open tabs are listed in host state"),
        ));
    };
    if tab.id == caller {
        return Err((
            "validator_failed",
            "that is the tab this turn is on; read it with page_read".to_string(),
        ));
    }
    Ok(tab)
}

/// Whether an `origins` row trusts its origin: present and switched on. First sight (`null`) and
/// a switched-off row are untrusted alike, and so is a store that could not be read.
fn trusts(row: &Value) -> bool {
    row.get("enabled").and_then(Value::as_bool) == Some(true)
}

/// `text` cut to `keep` characters, the last one an ellipsis when anything was cut.
fn cut_to(text: &str, keep: usize) -> String {
    if text.chars().count() <= keep {
        return text.to_string();
    }
    if keep == 0 {
        return String::new();
    }
    let kept: String = text.chars().take(keep - 1).collect();
    format!("{kept}…")
}

/// `from <origin> - <title> (<url>)`, cut to [`FROM_LINE_MAX`]: the url keeps up to two thirds
/// of the room and the title takes what is left, so the origin - the part the record and the card
/// group by - is whole.
fn from_line(origin: &str, title: &str, url: &str) -> String {
    let fixed = format!("from {origin} -  ()").chars().count();
    let room = FROM_LINE_MAX.saturating_sub(fixed);
    let url = cut_to(
        url,
        (room * 2 / 3).max(room.saturating_sub(title.chars().count())),
    );
    let title = cut_to(title, room.saturating_sub(url.chars().count()));
    cut_to(&format!("from {origin} - {title} ({url})"), FROM_LINE_MAX)
}

/// A packet with the `from` line on top and a `(showing N of M)` footer at the bottom, which the
/// page's own answer has unless it was a whole page short enough to need none.
fn sourced(from: &str, packet: &str) -> String {
    let footed = packet
        .lines()
        .last()
        .is_some_and(|last| last.starts_with("(showing ") && last.ends_with(')'));
    if footed {
        format!("{from}\n{packet}")
    } else {
        let n = packet.chars().count();
        format!("{from}\n{packet}\n(showing {n} of {n})")
    }
}

/// `tabs_read`: read another open tab's text through that tab's own hands relay (ADR 0105).
///
/// Every refusal happens before a word is read. A url no tab is at is `unknown_ref`; the tab the
/// call came from is `validator_failed`; a tab whose web origin has no enabled `origins` row is
/// `foreign_origin` with an empty output - its hands relay is never asked anything. Otherwise
/// that tab's `hands.js` answers `page_read` (scoped by the query, or continued by the cursor),
/// and nothing else: none of that page's own tools is called and no manifest is posted for it.
async fn tabs_read(
    app: &AppHandle,
    caller: u32,
    input: &Value,
    started: std::time::Instant,
) -> HandResult {
    use tauri::Manager;
    let elapsed = || started.elapsed().as_millis() as u64;

    let ask = match read_ask(input) {
        Ok(ask) => ask,
        Err(detail) => return HandResult::refused("validator_failed", detail, elapsed()),
    };
    let open = app.state::<tabs::Tabs>().list();
    let tab = match pick_tab(&open, caller, &ask.url) {
        Ok(tab) => tab.clone(),
        Err((reason, detail)) => return HandResult::refused(reason, detail, elapsed()),
    };
    let origin = tabs::origin_of(&tab.url);
    let row = if origin.is_empty() {
        Value::Null
    } else {
        store::opened(app)
            .and_then(|store| store.get("origins", &origin))
            .unwrap_or(Value::Null)
    };
    if !trusts(&row) {
        let site = if origin.is_empty() { &tab.url } else { &origin };
        return HandResult::refused(
            "foreign_origin",
            format!("{site} is not a site the person trusts, so its text is not read; ask them to switch to that tab"),
            elapsed(),
        );
    }
    let body = json!({ "hand": "page_read", "input": read_input(&ask) });
    let answer = match bridge::ask_hands(app, tab.id, body).await {
        Err(detail) => return HandResult::refused("unknown_ref", detail, elapsed()),
        Ok(answer) => from_page(&answer, elapsed()),
    };
    if !answer.ok {
        return answer;
    }
    HandResult {
        output: sourced(&from_line(&origin, &tab.title, &tab.url), &answer.output),
        source_tab: Some(tab.id),
        source_origin: Some(origin),
        ..answer
    }
}

/// What the other tab's `hands.js` is asked: `page_read` with the query and the cursor, if any,
/// and never a ref - a ref belongs to the page that minted it, and the model holds none of this one.
fn read_input(ask: &ReadAsk) -> Value {
    let mut asked = serde_json::Map::new();
    if let Some(query) = ask.query.as_ref().filter(|q| !q.trim().is_empty()) {
        asked.insert("query".to_string(), Value::String(query.clone()));
    }
    if let Some(cursor) = &ask.cursor {
        asked.insert("cursor".to_string(), Value::String(cursor.clone()));
    }
    Value::Object(asked)
}

/// Read the page's answer into a result, trusting none of its shape.
///
/// A page cannot reach this path — `hands.js` runs before its scripts and the relay carries only
/// what it posts — but the reply still arrives as untyped JSON from a webview, and a missing field
/// must come out as an honest refusal rather than a panic.
fn from_page(answer: &Value, ms: u64) -> HandResult {
    if answer.get("ok").and_then(Value::as_bool) == Some(true) {
        let output = answer
            .get("output")
            .and_then(Value::as_str)
            .unwrap_or_default();
        return HandResult {
            ok: true,
            output: capped(output),
            reason: None,
            error: None,
            tier: 2,
            ms,
            capture_id: None,
            source_tab: None,
            source_origin: None,
        };
    }
    let reason = answer
        .get("reason")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let detail = answer
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or("the page refused and said nothing");
    HandResult::refused(normalised(reason), detail, ms)
}

/// Map whatever came back onto the closed vocabulary. Anything unrecognised is `unknown`.
///
/// The same rule as `normalize_reason` in `contracts/harness.py`: a reason invented at a call site
/// would be a ledger column value nobody can group by, and the row would still not say why.
fn normalised(reason: &str) -> &'static str {
    match reason {
        "unknown_ref" => "unknown_ref",
        "validator_failed" => "validator_failed",
        "timeout" => "timeout",
        "outcome_unknown" => "outcome_unknown",
        "foreign_origin" => "foreign_origin",
        "foreign_token" => "foreign_token",
        "user_denied" => "user_denied",
        _ => "unknown",
    }
}

fn capped(output: &str) -> String {
    if output.len() <= OUTPUT_CAP {
        return output.to_string();
    }
    // The footer is the one the whole system uses, to the character (invariant 4).
    let kept = &output[..floor_char_boundary(output, OUTPUT_CAP)];
    format!("{kept}\n(showing {} of {})", kept.len(), output.len())
}

/// The largest index at or below `at` that is a char boundary. `str::floor_char_boundary` is
/// still unstable, and cutting mid-codepoint would panic on the slice.
fn floor_char_boundary(text: &str, at: usize) -> usize {
    let mut index = at.min(text.len());
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

// ==============================================================================================
// Describing a card's refs
// ==============================================================================================

/// The most refs one `describe` asks about. A card has a handful of parameters.
const DESCRIBE_CAP: usize = 32;

/// The longest label a description carries back, in characters; `hands.js` already cuts at 120.
const DESCRIBE_LABEL_CAP: usize = 160;

/// What the panel's card learns about its refs (ADR 0099). Never an `Err`, like a hand: a card
/// that cannot be described keeps its raw ref and says so, which needs a sentence, not a throw.
#[derive(Debug, Clone, Serialize)]
pub struct Described {
    pub ok: bool,
    /// `ref -> { role, label }`, only for refs the page still holds. The label is the page's claim.
    pub targets: serde_json::Map<String, Value>,
    pub error: Option<String>,
}

/// Ask `hands.js` what each ref still names. Not a hand: it is in no table, no manifest offers it
/// and a model cannot call it. The panel asks it through `hands_describe` over the same relay a
/// hand uses; a page webview is granted nothing new (ADR 0014).
pub async fn describe(app: &AppHandle, tab: u32, refs: &[String]) -> Described {
    let asked = asked_refs(refs);
    if asked.is_empty() {
        return Described {
            ok: true,
            targets: serde_json::Map::new(),
            error: None,
        };
    }
    match bridge::ask_hands(app, tab, json!({ "describe": asked })).await {
        Err(detail) => Described {
            ok: false,
            targets: serde_json::Map::new(),
            error: Some(detail),
        },
        Ok(answer) => described(&answer, &asked),
    }
}

/// The refs worth asking about: in the minted form, short, distinct, and at most [`DESCRIBE_CAP`].
fn asked_refs(refs: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for r in refs {
        if out.len() == DESCRIBE_CAP {
            break;
        }
        if r.starts_with("ref_") && r.len() <= 64 && !out.contains(r) {
            out.push(r.clone());
        }
    }
    out
}

/// Read the page's answer, trusting none of its shape: only refs that were asked, and only a role
/// and a label that are strings, cut to [`DESCRIBE_LABEL_CAP`].
fn described(answer: &Value, asked: &[String]) -> Described {
    if answer.get("ok").and_then(Value::as_bool) != Some(true) {
        let detail = answer
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("the page did not describe its refs");
        return Described {
            ok: false,
            targets: serde_json::Map::new(),
            error: Some(detail.to_string()),
        };
    }
    let mut targets = serde_json::Map::new();
    if let Some(given) = answer.get("targets").and_then(Value::as_object) {
        for r in asked {
            let Some(entry) = given.get(r) else { continue };
            let (Some(role), Some(label)) = (
                entry.get("role").and_then(Value::as_str),
                entry.get("label").and_then(Value::as_str),
            ) else {
                continue;
            };
            let role: String = role.chars().take(40).collect();
            let label: String = label.chars().take(DESCRIBE_LABEL_CAP).collect();
            targets.insert(r.clone(), json!({ "role": role, "label": label }));
        }
    }
    Described {
        ok: true,
        targets,
        error: None,
    }
}

// ==============================================================================================
// The smoke
// ==============================================================================================

/// `ATHENA_SMOKE_HANDS=1`: run one hand of each kind on the first tab, print both, and exit.
///
/// The capture is the one path in this build that cannot be unit-tested: it needs a window, a
/// composited webview and the OS's own drawing. `cargo test` proves the table, the schema, the
/// dispatch and the refusals; this proves that `PrintWindow` returns pixels of the page on this
/// machine, which is the part a test can only assume.
///
/// Two hands rather than one, because the dispatch has two arms: `page_read` is answered by
/// `hands.js` through the relay and `page_screenshot` by the shell. A run where the first works
/// and the second does not is a capture problem; one where neither works is a relay problem.
pub fn smoke_if_asked(app: &AppHandle) {
    if std::env::var("ATHENA_SMOKE_HANDS")
        .ok()
        .filter(|v| !v.is_empty())
        .is_none()
    {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move { smoke(app, 1).await });
}

async fn smoke(app: AppHandle, tab: u32) {
    const ATTEMPTS: u32 = 20;
    const EVERY: std::time::Duration = std::time::Duration::from_millis(500);

    // `page_read` is the wait as well as the first assertion: it cannot answer until the page's
    // own script is in, so polling it is how the smoke knows the tab is ready. A fixed sleep
    // would be either slow or flaky, which is the same reasoning as the bridge's own smoke.
    let mut last = String::from("the page never answered");
    for _ in 0..ATTEMPTS {
        tokio::time::sleep(EVERY).await;
        let read = call(&app, tab, "page_read", json!({})).await;
        if read.ok {
            println!(
                "[smoke] page_read ok=true chars={} ms={}",
                read.output.chars().count(),
                read.ms
            );
            let shot = call(&app, tab, SCREENSHOT, json!({})).await;
            match (shot.ok, shot.capture_id.is_some()) {
                (true, true) => println!("[smoke] {SCREENSHOT} ok=true {}", shot.output),
                _ => println!(
                    "[smoke] {SCREENSHOT} ok=false reason={} error={}",
                    shot.reason.unwrap_or_default(),
                    shot.error.unwrap_or_default()
                ),
            }
            // And the guard, against a tab that exists in the model but is not the one on screen.
            // It is the one refusal in this file that no unit test can reach — it reads the live
            // focus — and it is the one that stops a card carrying a picture of somewhere else.
            let elsewhere = call(&app, tab + 1, SCREENSHOT, json!({})).await;
            println!(
                "[smoke] {SCREENSHOT} on an unfocused tab: ok={} reason={}",
                elsewhere.ok,
                elsewhere.reason.unwrap_or_default()
            );
            app.exit(0);
            return;
        }
        last = read.error.unwrap_or_else(|| "no detail".to_string());
    }
    println!("[smoke] page_read ok=false after {ATTEMPTS} attempts: {last}");
    app.exit(1);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn describe_asks_only_about_minted_refs_once_each() {
        let refs = vec![
            "ref_0_aa".to_string(),
            "#send".to_string(),
            "ref_0_aa".to_string(),
            format!("ref_{}", "f".repeat(80)),
            "ref_0_bb".to_string(),
        ];
        assert_eq!(asked_refs(&refs), vec!["ref_0_aa", "ref_0_bb"]);
        let many: Vec<String> = (0..50).map(|i| format!("ref_0_{i:02x}")).collect();
        assert_eq!(asked_refs(&many).len(), DESCRIBE_CAP);
    }

    #[test]
    fn describe_keeps_only_asked_refs_with_a_string_role_and_label() {
        let asked = vec!["ref_0_aa".to_string(), "ref_0_bb".to_string()];
        let answer = json!({
            "ok": true,
            "targets": {
                "ref_0_aa": { "role": "button", "label": "Send reminder" },
                "ref_0_bb": { "role": 3, "label": "odd" },
                "ref_0_cc": { "role": "link", "label": "not asked" },
            },
        });
        let d = described(&answer, &asked);
        assert!(d.ok);
        assert_eq!(d.targets.len(), 1);
        assert_eq!(d.targets["ref_0_aa"]["label"], "Send reminder");
    }

    #[test]
    fn a_describe_the_page_refused_is_not_ok_and_says_why() {
        let d = described(
            &json!({ "ok": false, "error": "timeout" }),
            &["ref_0_aa".to_string()],
        );
        assert!(!d.ok);
        assert!(d.targets.is_empty());
        assert_eq!(d.error.as_deref(), Some("timeout"));
    }

    #[test]
    fn describe_is_not_a_hand() {
        // The panel asks it; a model must never be offered it.
        assert!(hand("describe").is_none());
        assert!(webmcp_tools().iter().all(|t| t["name"] != "describe"));
    }

    #[test]
    fn there_are_ten_hands_and_every_name_is_distinct() {
        let names: std::collections::BTreeSet<_> = HANDS.iter().map(|h| h.name).collect();
        assert_eq!(names.len(), HANDS.len());
        assert_eq!(HANDS.len(), 10);
    }

    #[test]
    fn eight_hands_are_the_pages_and_two_are_the_shells() {
        // Not a count for its own sake: the split is what `call` dispatches on, and a hand that
        // drifted to the wrong runner would either be asked of a page that cannot answer it or
        // answered by the shell for a page that could.
        let shell: Vec<_> = HANDS
            .iter()
            .filter(|h| h.runner == Runner::Shell)
            .map(|h| h.name)
            .collect();
        assert_eq!(shell, [SCREENSHOT, TABS_READ]);
        assert_eq!(HANDS.iter().filter(|h| h.runner == Runner::Page).count(), 8);
    }

    #[test]
    fn every_hand_that_changes_the_page_is_irreversible() {
        // Which is what keeps it out of AUTO when the catalog derives its class. A hand that
        // claimed reversible would be a click that happens with no card in front of it.
        for hand in HANDS {
            let changes = matches!(
                hand.name,
                "page_click" | "page_fill" | "page_select" | "page_submit"
            );
            assert_eq!(
                hand.reversible, !changes,
                "{} claims the wrong reversibility",
                hand.name
            );
        }
    }

    #[test]
    fn no_hand_claims_external_side_effects() {
        // A hand cannot know whether the button it presses sends an email. `internal` plus
        // irreversible is already GATED, which is the honest floor; `external` would be a claim.
        for hand in HANDS {
            assert_ne!(hand.side_effects, "external", "{}", hand.name);
            assert!(
                matches!(hand.side_effects, "none" | "internal"),
                "{}",
                hand.name
            );
        }
    }

    #[test]
    fn the_reading_hands_would_classify_as_auto_and_the_acting_ones_gated() {
        // Mirrors `HostTool.default_class`: AUTO iff reversible and not external.
        let auto: Vec<_> = HANDS
            .iter()
            .filter(|h| h.reversible && h.side_effects != "external")
            .map(|h| h.name)
            .collect();
        assert_eq!(
            auto,
            [
                "page_read",
                "page_find",
                "page_wait",
                "page_scroll",
                SCREENSHOT,
                TABS_READ
            ]
        );
    }

    #[test]
    fn the_tools_are_shaped_the_way_a_page_reports_its_own() {
        let tools = webmcp_tools();
        assert_eq!(tools.len(), HANDS.len());
        for tool in &tools {
            assert!(tool["name"].is_string());
            assert_eq!(tool["inputSchema"]["type"], "object");
            // Never absent: `flagsOf` falls through to `{reversible: false, side_effects:
            // "external"}` when a tool declares nothing, and a hand that arrived without the block
            // would be classified from a claim it never made.
            assert!(tool["athena"]["reversible"].is_boolean());
            assert!(tool["athena"]["side_effects"].is_string());
        }
    }

    #[test]
    fn the_standard_hints_agree_with_the_athena_block() {
        // A surface that reads only the annotations must reach the same class as one that reads
        // the block. `flagsOf` prefers the block, so a disagreement would be invisible until a
        // surface that has only the hints ran a gated hand without a card.
        for tool in webmcp_tools() {
            let reversible = tool["athena"]["reversible"].as_bool().unwrap();
            let external = tool["athena"]["side_effects"] == "none";
            assert_eq!(tool["annotations"]["consequentialHint"], !reversible);
            assert_eq!(tool["annotations"]["readOnlyHint"], external);
        }
    }

    #[test]
    fn a_hand_that_takes_a_ref_requires_it() {
        for name in ["page_click", "page_fill", "page_select", "page_submit"] {
            let schema = schema_for(name);
            let required = schema["required"].as_array().expect("required list");
            assert!(required.iter().any(|r| r == "ref"), "{name}");
        }
        // And the two that read the whole page do not: a read with no ref is the page itself.
        assert!(schema_for("page_read").get("required").is_none());
        assert!(schema_for("page_find").get("required").is_none());
    }

    #[test]
    fn an_array_parameter_would_need_max_items() {
        // The manifest validator refuses an unbounded array. None of the hands takes one; this is
        // the test that notices the day one does.
        for tool in webmcp_tools() {
            let props = tool["inputSchema"]["properties"].clone();
            for (name, schema) in props.as_object().cloned().unwrap_or_default() {
                if schema["type"] == "array" {
                    assert!(schema.get("maxItems").is_some(), "{name}");
                }
            }
        }
    }

    #[test]
    fn a_page_answer_becomes_a_tier_two_result() {
        let answer = json!({ "ok": true, "output": "INV-118, INV-120" });
        let result = from_page(&answer, 12);

        assert!(result.ok);
        assert_eq!(result.output, "INV-118, INV-120");
        assert_eq!(result.tier, 2);
        assert!(result.reason.is_none());
    }

    #[test]
    fn a_page_refusal_keeps_its_reason_when_the_vocabulary_holds_it() {
        let answer = json!({ "ok": false, "reason": "unknown_ref", "error": "no element" });
        let result = from_page(&answer, 3);

        assert!(!result.ok);
        assert_eq!(result.reason.as_deref(), Some("unknown_ref"));
        assert_eq!(result.error.as_deref(), Some("no element"));
    }

    #[test]
    fn a_reason_outside_the_vocabulary_collapses_to_unknown() {
        let answer = json!({ "ok": false, "reason": "it exploded", "error": "boom" });
        assert_eq!(from_page(&answer, 0).reason.as_deref(), Some("unknown"));
    }

    #[test]
    fn an_answer_with_no_shape_at_all_is_still_a_refusal() {
        let result = from_page(&json!({}), 0);

        assert!(!result.ok);
        assert_eq!(result.reason.as_deref(), Some("unknown"));
        assert!(result.error.is_some(), "a refusal always says something");
    }

    #[test]
    fn a_long_answer_is_cut_and_says_so() {
        let long = "x".repeat(OUTPUT_CAP + 500);
        let result = from_page(&json!({ "ok": true, "output": long }), 0);

        assert!(result.output.len() < OUTPUT_CAP + 60);
        assert!(result.output.ends_with(&format!(
            "(showing {} of {})",
            OUTPUT_CAP,
            OUTPUT_CAP + 500
        )));
    }

    #[test]
    fn a_cut_never_lands_mid_character() {
        // A multi-byte page is the normal case, not the exotic one.
        let long = "é".repeat(OUTPUT_CAP);
        let result = from_page(&json!({ "ok": true, "output": long }), 0);
        assert!(result.output.starts_with('é'));
    }

    #[test]
    fn the_hands_script_declares_the_same_names_this_module_does() {
        // The two halves are one capability each, in two languages, and nothing imports across.
        // The shell's hand is exempt in one direction only: it must be absent from the script,
        // which the third parity test below asserts from the other side.
        let script = crate::hands_script();
        for hand in HANDS.iter().filter(|h| h.runner == Runner::Page) {
            assert!(
                script.contains(hand.name),
                "hands.js is missing {}",
                hand.name
            );
        }
    }

    #[test]
    fn the_script_claims_the_same_two_flags_for_every_hand() {
        // The parity test this repository already has for the refusal vocabulary
        // (`tests/test_refusal_parity.py`), applied to the one other thing declared twice. A drift
        // here is a hand that is AUTO on one surface and GATED on another, and nothing else would
        // notice: a surface reads its flags from the script, the daemon from this table.
        let script = crate::hands_script();
        for hand in HANDS.iter().filter(|h| h.runner == Runner::Page) {
            let declared = format!(
                "{}: [{}, \"{}\"]",
                hand.name, hand.reversible, hand.side_effects
            );
            assert!(
                script.contains(&declared),
                "hands.js does not declare `{declared}`"
            );
        }
    }

    #[test]
    fn the_script_declares_no_hand_this_module_does_not() {
        // The other direction: a hand added to the script and not here is one the daemon would
        // never classify, so the page would answer a call the catalog does not hold.
        let script = crate::hands_script();
        let table = script
            .split("const FLAGS = {")
            .nth(1)
            .and_then(|rest| rest.split("};").next())
            .expect("hands.js declares a FLAGS table");
        for line in table.lines() {
            let name = line.split(':').next().map(str::trim).unwrap_or("");
            if name.is_empty() || name.starts_with("//") || name.starts_with('*') {
                continue;
            }
            assert!(
                hand(name).is_some(),
                "hands.js declares {name}, which this module does not"
            );
        }
    }

    #[test]
    fn the_three_reads_take_an_optional_bounded_cursor_and_nothing_else_does() {
        // ADR 0102. Optional, because a read without one is the read it always was; bounded,
        // because the manifest validator refuses an unbounded string.
        for name in ["page_read", "page_find"] {
            let schema = schema_for(name);
            assert_eq!(schema["properties"]["cursor"]["type"], "string", "{name}");
            assert_eq!(
                schema["properties"]["cursor"]["maxLength"], CURSOR_MAX,
                "{name}"
            );
            assert!(schema.get("required").is_none(), "{name}");
        }
        // ADR 0105: a read of another tab continues the same way, with its url beside the cursor.
        assert_eq!(
            schema_for(TABS_READ)["properties"]["cursor"]["maxLength"],
            CURSOR_MAX
        );
        for hand in HANDS
            .iter()
            .filter(|h| !matches!(h.name, "page_read" | "page_find" | TABS_READ))
        {
            assert!(
                schema_for(hand.name)["properties"].get("cursor").is_none(),
                "{} takes no cursor",
                hand.name
            );
        }
    }

    #[test]
    fn the_script_bounds_a_cursor_where_this_module_does() {
        // The schema promises a bound the script then enforces; two numbers for one bound would be
        // a cursor the catalog accepts and the page refuses, or the other way round.
        let script = crate::hands_script();
        assert!(
            script.contains(&format!("const CURSOR_MAX = {CURSOR_MAX};")),
            "hands.js does not declare CURSOR_MAX = {CURSOR_MAX}"
        );
        assert!(script.contains("cursor: { type: \"string\", maxLength: CURSOR_MAX }"));
    }

    #[test]
    fn every_description_fits_the_catalog_and_the_script_says_the_same() {
        // ADR 0068: the catalog cuts a description at 240 characters, and a cut one would lose the
        // half that tells a model how to continue. The script reports the same words, so a surface
        // that reads its tools from there is told the same thing.
        let script = crate::hands_script();
        for hand in HANDS {
            assert!(
                hand.description.chars().count() <= 240,
                "{} is {} characters",
                hand.name,
                hand.description.chars().count()
            );
            if hand.runner == Runner::Page {
                assert!(
                    script.contains(&format!("\"{}\"", hand.description)),
                    "hands.js describes {} differently",
                    hand.name
                );
            }
        }
    }

    #[test]
    fn the_acting_hands_take_an_optional_expect_bounded_where_the_script_cuts_a_label() {
        // ADR 0104. The bound is the script's LABEL_CAP, because the value is a label the script
        // handed back; and the script spells the same schema, so both catalogues agree.
        let script = crate::hands_script();
        assert!(
            script.contains(&format!("const LABEL_CAP = {EXPECT_MAX};")),
            "hands.js does not cut a label at {EXPECT_MAX}"
        );
        assert!(script.contains("const EXPECT = { type: \"string\", maxLength: LABEL_CAP };"));
        for name in ["page_click", "page_fill", "page_select", "page_submit"] {
            let schema = schema_for(name);
            assert_eq!(
                schema["properties"]["expect"]["maxLength"], EXPECT_MAX,
                "{name}"
            );
            let required = schema["required"].as_array().expect("required list");
            assert!(
                !required.iter().any(|r| r == "expect"),
                "{name}: expect is optional"
            );
            assert!(
                script.contains(&format!(
                    "{name}: {{ type: \"object\", properties: {{ ref: REF,"
                )),
                "hands.js spells no schema for {name}"
            );
        }
        for name in [
            "page_read",
            "page_find",
            "page_wait",
            "page_scroll",
            SCREENSHOT,
        ] {
            assert!(
                schema_for(name)["properties"].get("expect").is_none(),
                "{name}"
            );
        }
    }

    #[test]
    fn the_script_does_not_declare_the_shells_hand() {
        // The other half of the exemption above, asserted rather than assumed. A `page_screenshot`
        // in `hands.js` would be a page offering to photograph itself, which is a page choosing
        // what the evidence for a decision card is.
        let script = crate::hands_script();
        assert!(
            !script.contains(SCREENSHOT),
            "hands.js declares {SCREENSHOT}, which only the shell can answer"
        );
    }

    #[test]
    fn the_shells_hand_takes_no_parameters() {
        // The picture is of the page on screen. A `ref` would promise a crop the capture cannot
        // do, and a `tab` would promise a picture of a page that is not showing.
        let schema = schema_for(SCREENSHOT);
        assert_eq!(schema["type"], "object");
        assert_eq!(
            schema["properties"],
            serde_json::json!({}),
            "a parameter here would be a promise the capture cannot keep"
        );
        assert!(schema.get("required").is_none());
    }

    #[test]
    fn the_shells_hand_is_reported_like_every_other() {
        // The surface appends this list to whatever the page offered and hands one list to
        // `gate.js`. A ninth entry shaped differently would be classified differently.
        let tools = webmcp_tools();
        assert_eq!(tools.len(), 10);
        let ninth = tools
            .iter()
            .find(|t| t["name"] == SCREENSHOT)
            .expect("the ninth hand is reported");
        assert_eq!(ninth["athena"]["reversible"], true);
        assert_eq!(ninth["athena"]["side_effects"], "none");
        assert_eq!(ninth["annotations"]["readOnlyHint"], true);
        assert_eq!(ninth["annotations"]["consequentialHint"], false);
    }

    #[test]
    fn only_a_capture_carries_a_capture_id() {
        // Every other hand's result must leave the field null, because a surface that finds an id
        // there puts a picture on a card — and a picture of the wrong moment is evidence of the
        // wrong thing.
        let answered = from_page(&json!({ "ok": true, "output": "some text" }), 1);
        assert!(answered.capture_id.is_none());

        let refused = from_page(&json!({ "ok": false, "reason": "unknown_ref" }), 1);
        assert!(refused.capture_id.is_none());
    }

    #[test]
    fn a_capture_refusal_is_a_member_of_the_vocabulary() {
        // `screenshot` needs a window, so its own paths are exercised by hand rather than here.
        // What is asserted here is the contract every one of those paths returns through: the two
        // reasons it may answer with are in `ERROR_REASONS`, so a card refused for want of a
        // picture groups in the ledger like every other refusal.
        for reason in ["validator_failed", "unknown"] {
            let result = HandResult::refused(reason, "why", 3);
            assert_eq!(normalised(reason), reason);
            assert_eq!(result.reason.as_deref(), Some(reason));
            assert!(!result.ok);
            assert_eq!(result.tier, 2);
            assert!(result.capture_id.is_none());
        }
    }

    #[test]
    fn a_capture_of_a_tab_not_on_screen_says_so_in_one_plain_sentence() {
        // The refusal is read by the model and can reach a card, so it is spelled the way every
        // other refusal is: one line, single spaces, naming the tab to focus.
        let detail = not_on_screen(Some(2), 3);
        assert_eq!(
            detail,
            "a capture is of the page on screen, which is tab 2, not tab 3; focus tab 3 first"
        );
        let none = not_on_screen(None, 3);
        for text in [&detail, &none] {
            assert!(!text.contains("  "), "a run of spaces in {text:?}");
            assert!(!text.contains('\n'), "a line break in {text:?}");
        }
    }

    // --- tabs_read (ADR 0105) ---------------------------------------------------------------

    fn tab(id: u32, url: &str, title: &str) -> tabs::Tab {
        tabs::Tab {
            id,
            label: tabs::label_for(id),
            url: url.to_string(),
            title: title.to_string(),
            focused: id == 1,
            nav: 0,
        }
    }

    #[test]
    fn tabs_read_is_a_shell_hand_that_derives_auto_and_takes_a_required_bounded_url() {
        let read = hand(TABS_READ).expect("tabs_read is a hand");
        assert_eq!(read.runner, Runner::Shell);
        assert!(read.reversible);
        assert_eq!(read.side_effects, "none");
        let schema = schema_for(TABS_READ);
        assert_eq!(schema["required"], json!(["url"]));
        assert_eq!(schema["properties"]["url"]["maxLength"], URL_MAX);
        assert_eq!(schema["properties"]["query"]["maxLength"], QUERY_MAX);
        assert!(schema["properties"].get("ref").is_none());
    }

    #[test]
    fn the_script_does_not_declare_the_tab_reader_and_bounds_a_query_the_same() {
        // The shell answers tabs_read; a page cannot offer to read another page. The query it
        // forwards is bounded where the script cuts it.
        let script = crate::hands_script();
        let table = script
            .split("const FLAGS = {")
            .nth(1)
            .and_then(|rest| rest.split("};").next())
            .expect("FLAGS");
        assert!(!table.contains(TABS_READ));
        assert!(script.contains(&format!("const QUERY_MAX = {QUERY_MAX};")));
    }

    #[test]
    fn a_tab_read_asks_for_a_url_and_bounds_the_rest() {
        assert!(read_ask(&json!({})).is_err());
        assert!(read_ask(&json!({ "url": "  " })).is_err());
        assert!(read_ask(&json!({ "url": "x".repeat(URL_MAX + 1) })).is_err());
        assert!(read_ask(
            &json!({ "url": "https://bank.test/", "query": "q".repeat(QUERY_MAX + 1) })
        )
        .is_err());
        assert!(read_ask(&json!({ "url": "https://bank.test/", "cursor": 3 })).is_err());
        let ask =
            read_ask(&json!({ "url": "https://bank.test/s", "query": "Closing balance" })).unwrap();
        assert_eq!(ask.url, "https://bank.test/s");
        assert_eq!(ask.query.as_deref(), Some("Closing balance"));
        assert_eq!(
            read_input(&ask),
            json!({ "query": "Closing balance" }),
            "the other page is asked page_read with the query and never a ref"
        );
    }

    #[test]
    fn a_tab_read_names_an_open_tab_other_than_its_own() {
        let open = [
            tab(1, "https://ledger.test/invoices", "Invoices"),
            tab(2, "https://bank.test/statements/9", "Statement"),
        ];
        assert_eq!(
            pick_tab(&open, 1, "https://bank.test/statements/9")
                .unwrap()
                .id,
            2
        );
        // A trailing slash is the same address.
        assert_eq!(
            pick_tab(&open, 1, "https://bank.test/statements/9/")
                .unwrap()
                .id,
            2
        );
        let (reason, _) = pick_tab(&open, 1, "https://bank.test/other").unwrap_err();
        assert_eq!(reason, "unknown_ref");
        let (reason, detail) = pick_tab(&open, 1, "https://ledger.test/invoices").unwrap_err();
        assert_eq!(reason, "validator_failed");
        assert!(detail.contains("page_read"));
    }

    #[test]
    fn only_an_enabled_origins_row_trusts_a_tab() {
        assert!(trusts(&json!({ "enabled": true, "overrides": {} })));
        assert!(!trusts(&json!({ "enabled": false })));
        assert!(!trusts(&Value::Null), "first sight is untrusted");
        assert!(!trusts(&json!({ "enabled": 1 })));
    }

    #[test]
    fn a_refused_tab_read_carries_no_text_and_names_no_source() {
        let refused = HandResult::refused("foreign_origin", "not trusted", 0);
        assert!(refused.output.is_empty());
        assert!(refused.source_tab.is_none() && refused.source_origin.is_none());
        assert_eq!(normalised("foreign_origin"), "foreign_origin");
    }

    #[test]
    fn the_from_line_names_the_origin_whole_and_fits_beside_a_packet() {
        let line = from_line("https://bank.test", "Statement", "https://bank.test/s/9");
        assert_eq!(
            line,
            "from https://bank.test - Statement (https://bank.test/s/9)"
        );
        let long = from_line(
            "https://bank.test",
            &"A very long statement title ".repeat(10),
            &format!("https://bank.test/{}", "p".repeat(500)),
        );
        assert!(
            long.chars().count() <= FROM_LINE_MAX,
            "{}",
            long.chars().count()
        );
        assert!(long.starts_with("from https://bank.test - "));
        // 1,500 for the packet (hands.js PACKET_CAP), one newline, and this line: the lane's cut.
        const { assert!(1500 + 1 + FROM_LINE_MAX <= 1600) };
    }

    #[test]
    fn a_sourced_packet_starts_with_its_from_line_and_ends_with_a_footer() {
        let short = sourced("from o - t (u)", "Closing balance $12,480.22");
        assert_eq!(
            short,
            "from o - t (u)\nClosing balance $12,480.22\n(showing 26 of 26)"
        );
        let packet = "cursor: cur_0_1_1400 (...)\nbody\n(showing 1400 of 3200)";
        assert_eq!(
            sourced("from o - t (u)", packet),
            format!("from o - t (u)\n{packet}")
        );
    }

    #[test]
    fn a_call_that_may_have_run_keeps_its_reason_through_the_relay() {
        // ADR 0101. 9b95915 reverted reasons that existed only in JavaScript, because this map
        // folded them into `unknown`; `outcome_unknown` is a member of `ERROR_REASONS` first.
        assert_eq!(normalised("outcome_unknown"), "outcome_unknown");
        assert_eq!(normalised("timeout"), "timeout");
        assert_eq!(normalised("made_up"), "unknown");
    }
}
