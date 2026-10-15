# 0105. Read a trusted tab by name; the rest of the turn files cards

Date: 2026-10-15

Amends ADR 0047 ("when the work left is in another tab, ask for that tab by name") and the origin
pin it rests on (`_origin_pinning`, README section 3.4). Adds a tenth generic hand (README 3.4
tier 2, ADR 0065) and one input to the gate's tightening (ADR 0063). Reading another tab is now
possible without switching; acting in it still is not.

## Context

A turn is pinned to one origin, and another tab's words reached the model only as a url and a
title in host state. The policy's refusal told her to recall what she had read there or to ask
the person to switch. The bench paid for it twice: $1,240 left unclaimed when the therapy notes sat
in the tab she had left (ADR 0045), and $4,200 held over terms she had read two tabs earlier (ADR
0048). ADR 0047 then made her ask for the switch by name, which works only when a person is there
to answer.

Reading alone is not harmless. Ledgerbox's `draft_reminder` is reversible and internal, so on a
trusted origin it is `AUTO`. If a figure read from the bank tab could flow into it, a number from
tab B would ride into an action on tab A with no card in front of anyone.

## Decision

1. **A shell hand, `tabs_read(url, query?, cursor?)`.** Reversible, `side_effects: none`, runner
   `shell`: its class derives `AUTO` like any read, and on a first-sight focused origin it is
   `GATED` like every other hand. The shell resolves `url` to an open tab and asks that tab's own
   `hands.js` for `page_read` - with the query, or continuing a cursor (ADR 0102's packets, cap and
   footer) - and nothing else. It never calls the other page's tools and never posts a manifest for
   it. The name is reserved: `withHands` drops a page's own tool called `tabs_read`.
2. **A scoped read.** With a query, `page_read` keeps only the rows that mention it: the deepest
   element holding the query, widened to its row (`tr`, `li`, `p`, ...) or to the first ancestor
   that holds more than the label, so a label in its own cell carries the figure beside it. A
   closing balance at character 3,000 lands in the first packet instead of past the cut. The footer
   counts what was kept against the whole page. `page_read`'s published schema is unchanged; the
   query is what the shell sends.
3. **Refusals, closed vocabulary only.** No tab at that url: `unknown_ref`. The focused tab:
   `validator_failed` (use `page_read`). A tab whose web origin is not an enabled row of the
   origins table - first sight or switched off - is `foreign_origin` with empty output, and nothing
   is read: the panel checks before it asks the shell, and the shell checks again before that
   tab's relay is touched. Only the web-origin row counts; a catalog-form row does not trust a tab,
   which fails closed.
4. **The source is the surface's.** The output's first line is `from <origin> - <title> (<url>)`,
   at most 99 characters so it fits beside a 1,500-character packet under the lane's 1,600 cut.
   `ToolResult` gains `source` (`host:<app_id>` of the tab read), set by the panel from the tab it
   resolved and checked, never from the model; `tool_results_from` keeps only that form. The lane
   marks the result's episode with it, so the record groups the text under the app it came from.
5. **The taint.** Once a `tabs_read` has returned text, the panel sends `tainted_by` (the web
   origins read) on every request until the user's next message, continuations started by an
   answered card included. `TurnContext.tainted_by` joins `gated_origins` and `gated_tools` in
   `GateHook._tightened`: every host call files a card, page tools and hands alike, whatever its
   class, and the card's summary says `uses text read from <origin>`. Nothing loosens. The one
   exception is the reading hand itself (tier 2, named `tabs_read`): it acts nowhere and only brings
   more of what is already in the turn, so a cursor continuation is not a card. A page's own tool
   of that name would be tier 1 and is held.
6. **Writes, captures and bindings are unchanged.** A call still runs only on the focused tab or
   the tab its card is bound to (ADR 0103); a card's capture is still the focused tab's (ADR 0066).
7. **Voice does not read other tabs.** The voice surface does not track the taint, so it refuses
   `tabs_read` with `validator_failed` before the shell is asked.

## Consequences

- ADR 0047's paragraph still stands for acting: work that must be done in another tab is asked
  for by name. For reading, she can now look before she asks (ADR 0048), within trusted tabs.
- The taint ends at the user's next message, while the text may stay in the conversation the
  engine resumes. A figure could be used by an `AUTO` call in a later exchange without a card. The
  user has spoken in between, which is the boundary the item drew; a stricter rule would hold every
  later call of the conversation to cards.
- One more request field (`tainted_by`, capped like `gated_tools`) and one optional result field
  (`source`); old surfaces that send neither behave as before.
- The policy's refusal for another tab's tools now names `tabs_read` beside `core.recall`.
- Unmeasured: whether the scoped read plus the taint removes the bench's "not on any page I read"
  misses. The benches are the measure.
