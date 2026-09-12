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

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::{bridge, capture, store, tabs};

/// What a page's own answer may carry back before the shell cuts it.
///
/// `hands.js` bounds its reads at 4,000 characters and announces the cut; this is the second wall,
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

/// The nine, in the order a person would use them: look, then act, then show what was seen.
pub const HANDS: &[Hand] = &[
    Hand {
        name: "page_read",
        description: "The visible text of the page, or of one element you have a ref for.",
        reversible: true,
        side_effects: "none",
        runner: Runner::Page,
    },
    Hand {
        name: "page_find",
        description: "Operable elements whose label matches a query, each with a ref to act on.",
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
        description: "Click the element a ref names.",
        reversible: false,
        side_effects: "internal",
        runner: Runner::Page,
    },
    Hand {
        name: "page_fill",
        description: "Put a value into the field a ref names.",
        reversible: false,
        side_effects: "internal",
        runner: Runner::Page,
    },
    Hand {
        name: "page_select",
        description: "Choose an option, by its visible label, in the select a ref names.",
        reversible: false,
        side_effects: "internal",
        runner: Runner::Page,
    },
    Hand {
        name: "page_submit",
        description: "Submit the form the ref sits in.",
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
];

/// The one hand the shell answers. Named once, because three places ask for it by name.
pub const SCREENSHOT: &str = "page_screenshot";

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

/// The parameters each hand takes, as the capability block renders them.
fn schema_for(name: &str) -> Value {
    let ref_param = json!({ "type": "string", "maxLength": 64 });
    match name {
        // No parameters at all: the picture is of the page on screen, and there is nothing about
        // it for a caller to choose. A `ref` here would promise a crop the capture cannot do.
        SCREENSHOT => json!({ "type": "object", "properties": {} }),
        "page_read" => json!({ "type": "object", "properties": { "ref": ref_param } }),
        "page_find" => json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "maxLength": 200 },
                "role": { "type": "string", "maxLength": 40 },
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
            "properties": { "ref": ref_param, "value": { "type": "string", "maxLength": 2000 } },
            "required": ["ref", "value"],
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
        return HandResult::refused(
            "validator_failed",
            match focused {
                Some(other) => format!(
                    "a capture is of the page on screen, which is tab {other}, not tab {tab};                      focus tab {tab} first"
                ),
                None => "no tab is focused, so there is no page to capture".to_string(),
            },
            ms,
        );
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
    }
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
    fn there_are_nine_hands_and_every_name_is_distinct() {
        let names: std::collections::BTreeSet<_> = HANDS.iter().map(|h| h.name).collect();
        assert_eq!(names.len(), HANDS.len());
        assert_eq!(HANDS.len(), 9);
    }

    #[test]
    fn eight_hands_are_the_pages_and_the_ninth_is_the_shells() {
        // Not a count for its own sake: the split is what `call` dispatches on, and a hand that
        // drifted to the wrong runner would either be asked of a page that cannot answer it or
        // answered by the shell for a page that could.
        let shell: Vec<_> = HANDS
            .iter()
            .filter(|h| h.runner == Runner::Shell)
            .map(|h| h.name)
            .collect();
        assert_eq!(shell, [SCREENSHOT]);
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
                SCREENSHOT
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
        assert_eq!(tools.len(), 9);
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
}
