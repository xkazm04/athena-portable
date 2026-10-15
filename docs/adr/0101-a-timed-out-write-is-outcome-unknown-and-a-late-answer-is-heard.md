# 0101. A timed-out write is `outcome_unknown`, and a late answer is heard

Date: 2026-10-15

Amends [0009](0009-one-refusal-vocabulary-declared-in-two-languages.md) (one closed
vocabulary, ported and pinned) by adding a member, and
[0014](0014-page-webviews-get-one-command-and-the-relay-holds-the-id-map.md) (the relay's id map) by keeping a
short memory of ids that timed out. The bridge envelope and its guards do not change.

## Context

`inject.js` races a page tool against a 30 s deadline and answers `timeout` when the deadline wins,
abandoning the promise it raced. The panel carried that to the daemon as a failure, and the episode
read `host.app.send failed (...)`. For a read that is true enough. For a send, it is the wrong
story: the call reached the page, and the page may finish it a second later. A record that says
"failed" invites the model, and the user, to send again: a double send. The relay dropped the page's
eventual answer as "an unknown or expired id", so the record could never be corrected. The demo
kit's door awaited handlers with no limit and dropped the abort signal on the floor.

Commit 8cdf1e9 once added reason codes only in JavaScript; `gate.js`'s closed list and `hands.rs`
folded them into `unknown`, and 9b95915 reverted it. A new reason starts in Python.

## Decision

1. **`outcome_unknown` joins `ERROR_REASONS`** (`src/athena/contracts/harness.py`), then
   `REFUSAL_REASONS` in `gate.js` and `normalised` in `hands.rs`. `tests/test_refusal_parity.py`
   pins the first two; a `hands.rs` unit test pins the third. `plain.ts` has a sentence for it.
2. **The surface decides it, not the page.** `inject.js` still mints only `timeout`; it cannot know
   whether its tool writes. `stores/run.ts` maps a `timeout` (the page's reason, or the relay's
   own `"timeout"`) to `outcome_unknown` unless the snapshot's flags for the tool say reversible
   *and* `side_effects: none`, read with `gate.js`'s `flagsOf`. A tool nobody describes is not a
   read. A hung read stays `timeout`.
3. **The tool is held until the user answers a card about it.** After an `outcome_unknown`, the
   panel remembers origin and registry name (at most 32, mirrored to `localStorage` when it can be)
   and adds the tool to `gated_tools` on every request, the rest of the same exchange included:
   this only tightens the exchange's snapshot
   ([0067](0067-one-snapshot-of-the-tab-per-exchange.md)). A proposal that reaches the page
   before the gate heard is refused locally with `outcome_unknown` rather than dispatched. Answering a card
   whose action is the tool, approve or decline, lifts the hold.
4. **The card says it may already have run.** `GateHook.before_tool_call` asks the approval table,
   when it can answer (`SpentLookupPort`, `Approvals.spent_recently`), for an approval of the same
   action and canonical parameters spent within 24 h, and adds one line to the card's rationale:
   "You approved this exact call at HH:MM and it may already have run." (local time of the moment
   of the yes). It informs and never blocks. Core stays stdlib-only.
5. **A late answer is an additive `late` event.** `inject.js` keeps the raced promise and, if it
   settles after the deadline, posts `{id: null, type: "late", call, ok, output}` once
   (`protocol.md`, "Late answers"). `bridge.rs` places it only for an id it issued to that tab and
   saw time out, from the page's `timeout` reply or its own timer, keeping at most 16 per tab for
   10 minutes, each placeable once; it emits `bridge:late` with the tool's name and `late_ms`.
   Anything else is dropped. The panel adds "<tool> finished N s late: ..." as a follow-up
   `tool_results` row for the next frame and rewrites the call's row in the record.
6. **The episode says "may have completed"**, not "failed", for a result whose error starts
   `outcome_unknown` (`browser_lane._record_results`).
7. **The demo-kit door forwards the caller's signal** to the handler and stops waiting when it
   aborts, answering an in-band `aborted` error.

## Consequences

- A send that outlives its deadline can no longer be retried without a card, and that card tells
  the user it may be a duplicate. The cost is one extra card after a slow write, which is the point.
- The hold is per window and, at best, per browser profile; a fresh profile forgets it. The card
  line is daemon-side and survives that, for 24 h.
- `late` is trusted no more than any reply: it is a tool result, fenced and bounded downstream. A
  page can only post `late` for a call the relay timed out on its own tab, so it cannot invent
  results for calls nobody made.
- A relay or surface that predates this ignores `late`, which is exactly the old behaviour.
