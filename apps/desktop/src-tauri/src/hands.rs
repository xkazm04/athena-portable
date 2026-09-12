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
//! The ninth hand, `page_screenshot`, is the shell's rather than the page's: it writes a PNG into
//! the `captures` table and the daemon mints an approval with its id, so a gated proposal carries
//! the page it is about. It lands in the commit after this one; the eight below are the ones a
//! page can answer.

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::bridge;

/// What a page's own answer may carry back before the shell cuts it.
///
/// `hands.js` bounds its reads at 4,000 characters and announces the cut; this is the second wall,
/// for a page that answered with something the script did not produce. Two bounds rather than one
/// because only one of them is in code the shell controls.
const OUTPUT_CAP: usize = 8_000;

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
}

/// The eight a page answers. The order is the order a person would use them: look, then act.
pub const HANDS: &[Hand] = &[
    Hand {
        name: "page_read",
        description: "The visible text of the page, or of one element you have a ref for.",
        reversible: true,
        side_effects: "none",
    },
    Hand {
        name: "page_find",
        description: "Operable elements whose label matches a query, each with a ref to act on.",
        reversible: true,
        side_effects: "none",
    },
    Hand {
        name: "page_wait",
        description: "Wait, up to a bound, for text to appear on the page.",
        reversible: true,
        side_effects: "none",
    },
    Hand {
        name: "page_scroll",
        description: "Bring a ref into view, or move the page by one screen.",
        reversible: true,
        side_effects: "internal",
    },
    Hand {
        name: "page_click",
        description: "Click the element a ref names.",
        reversible: false,
        side_effects: "internal",
    },
    Hand {
        name: "page_fill",
        description: "Put a value into the field a ref names.",
        reversible: false,
        side_effects: "internal",
    },
    Hand {
        name: "page_select",
        description: "Choose an option, by its visible label, in the select a ref names.",
        reversible: false,
        side_effects: "internal",
    },
    Hand {
        name: "page_submit",
        description: "Submit the form the ref sits in.",
        reversible: false,
        side_effects: "internal",
    },
];

pub fn is_hand(name: &str) -> bool {
    HANDS.iter().any(|hand| hand.name == name)
}

/// The hands as manifest tools, for the panel to append to whatever the page registered.
///
/// Shaped for `HostManifest.from_dict`, so the daemon merges them through the same path and
/// derives the same classes. A hand a page already registered under the same name is *not*
/// filtered here: the panel drops it, because only the panel knows what the page offered.
pub fn manifest_tools() -> Vec<Value> {
    HANDS
        .iter()
        .map(|hand| {
            json!({
                "name": hand.name,
                "description": hand.description,
                "params_schema": schema_for(hand.name),
                "reversible": hand.reversible,
                "side_effects": hand.side_effects,
                "transport": "hands",
            })
        })
        .collect()
}

/// The parameters each hand takes, as the capability block renders them.
fn schema_for(name: &str) -> Value {
    let ref_param = json!({ "type": "string", "maxLength": 64 });
    match name {
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
        }
    }
}

/// Run one hand on one tab.
pub async fn call(app: &AppHandle, tab: u32, name: &str, input: Value) -> HandResult {
    let started = std::time::Instant::now();
    let elapsed = |at: std::time::Instant| at.elapsed().as_millis() as u64;

    if !is_hand(name) {
        return HandResult::refused(
            "unknown_ref",
            format!("no hand named {name}"),
            elapsed(started),
        );
    }
    let body = json!({ "hand": name, "input": input });
    match bridge::ask_hands(app, tab, body).await {
        // The relay could not reach the tab at all. Not a page refusing — a tab that is gone.
        Err(detail) => HandResult::refused("unknown_ref", detail, elapsed(started)),
        Ok(answer) => from_page(&answer, elapsed(started)),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn there_are_eight_hands_and_every_name_is_distinct() {
        let names: std::collections::BTreeSet<_> = HANDS.iter().map(|h| h.name).collect();
        assert_eq!(names.len(), HANDS.len());
        assert_eq!(
            HANDS.len(),
            8,
            "the ninth, page_screenshot, lands with captures"
        );
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
        assert_eq!(auto, ["page_read", "page_find", "page_wait", "page_scroll"]);
    }

    #[test]
    fn the_manifest_is_shaped_for_host_manifest_from_dict() {
        let tools = manifest_tools();
        assert_eq!(tools.len(), HANDS.len());
        for tool in &tools {
            assert!(tool["name"].is_string());
            // Never absent: the manifest validator refuses a tool that does not declare it, and
            // a hand that arrived without one would be refused whole with the page's own tools.
            assert!(tool["reversible"].is_boolean());
            assert!(tool["side_effects"].is_string());
            assert_eq!(tool["params_schema"]["type"], "object");
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
        for tool in manifest_tools() {
            let props = tool["params_schema"]["properties"].clone();
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
        let script = crate::hands_script();
        for hand in HANDS {
            assert!(
                script.contains(hand.name),
                "hands.js is missing {}",
                hand.name
            );
        }
    }
}
