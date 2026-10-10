# 0066. A gated host proposal carries a capture of its tab

Date: 2026-10-10

Implements README section 3.4 (tier 2 "with a screenshot captured before every gated proposal"),
section 3.5 ("the daemon mints the approval with the capture id") and the screenshot on section 5's
never-cut list. It is the panel half that ADR 0025 left open, and part 2 of the
page-operation-via-webmcp rework after ADR 0065. Builds on ADR 0063.

## Context

Three documents said a gated card carries a screenshot, and no card did. `approvals.create` took a
`capture_id` and the table had the column, but the gate passed none and the panel's card could only
draw a stylised sketch. The daemon also stamped every host tool tier 1, so a hand showed as tier 1
in the manifest reply while the shell's result rows for it said tier 2, and the panel's tool list
hard-coded tier 1 and the flag-derived class, hiding the `GATED` a first-sight tab or a pin imposes.
Last, `_names_from` cut a list past 4096 names, and a cut `gated_tools`, `gated_origins` or
`disabled_origins` loosens the gate: the name that mattered can be the one past the cut.

## Decision

**The shell takes the capture, once per request, just before it.** `stores/run.ts` `consume()`
and `stores/voice.ts` before its `start` and `text` frames call `takeCapture` (`lib/hands.ts`),
which runs `hands_call(tab, 'page_screenshot', {})` through `lib/ipc.ts` and sends the
`capture_id` the hand answers with. It needs a shell and a web origin on the focused tab. No Rust
changed: `page_screenshot` already files the `captures` row and `store_get` already reads it.

**The daemon attaches it by origin.** `TurnContext.capture_id` is read off `POST /run` and the
voice frames the way `gated_origins` is, and a value that is not a capture id (`ids.is_id`) is read
as none. `before_tool_call` passes it to `approvals.create` only when the card's origin is
`host:<ctx.app_id>`, the session's own page. A connector, a core tool or another host gets none: a
screenshot of the focused tab on a card about something else would show the user the wrong thing.

**A failed capture never blocks or fails the request.** A refusal, a throw, a missing shell, a tab
that is not a web page or a capture slower than eight seconds each send no `capture_id` and the
request goes. The reason is kept in `useRun.captureWhy`, by card id, and the card says "No capture
was taken: <reason>." A card the daemon reported on its own says it was not taken, without a reason.
The sketch stays for fixtures and the preview only; a card with an id reads `store_get('captures',
id)` and draws it, and says so when the sweep has removed the row. The captures cap and the sweep
are unchanged.

**The tier is a marker, set in one place and stripped in another.** `lib/hands.ts` sets
`athena.runner: "shell"` on each hand `withHands` appends and removes `runner` from the `athena`
block of every tool a page registered. `manifestBodyOf` carries it across `manifestOf` (which
rebuilds each tool from fixed keys) as the tool's `runner`. `HostTool.runner` reads it, a host
catalog entry with `runner == HAND_RUNNER` gets `tier_override=2`, and `/manifest` reports it.
`HAND_RUNNER` is spelled once on each side. The marker changes the tier and never the class.

**Can a page set it?** Not through the shell: the page's tool is stripped, and `gate.js`'s
`manifestOf` copies fixed keys only, so a page's `runner` never reaches the body. The page's
`athena:app-manifest` hint is not forwarded by the shell. A caller that holds the daemon token can
send `runner` in a hand-made body, and it is the user's own surface. `packages/` is unchanged.

**The panel shows the class the gate will apply.** `toolRows` lists the hands at tier 2 and shows
`GATED` for a first-sight app or a pinned tool (`gatedListsOf`), not the flag-derived class. Core's
`render_capabilities` is unchanged.

**A list past its cap is refused, not cut.** `gated_origins`, `gated_tools` (4096 each) and
`disabled_origins` (256) raise `ListTooLong` in the parse, and `POST /run` answers 400
`validator_failed` naming the field; the voice gateway sends the same `turn.error`. A list exactly
at its cap is read whole.

## Consequences

Every request costs one screenshot, whether or not a gated call follows, because the shell cannot
know in advance; the captures sweep bounds the table. Voice captures at key-down, so the microphone
opens a screenshot later. A card gets its reason when it arrives, from the latest request's capture,
so a card that outlives its turn (voice) can carry the reason of a later request. A hand-made manifest with a token can claim tier
2 for any host tool; the tier is reporting, not policy. A caller that sends an over-long list now
gets an error where it used to get a silently looser gate.
