# 0146. A page tool's failure is a failed reply, and a domain answer is an answer

Date: 2026-10-25

Amends [0008](0008-the-page-half-of-the-bridge-degrades-instead-of-failing.md) (what the page half
answers) by letting a tool's rejection carry a page-mintable `reason` and path-addressed `errors`,
and [0101](0101-a-timed-out-write-is-outcome-unknown-and-a-late-answer-is-heard.md) decision 7 (the
demo-kit door answered an in-band `aborted` error) by making the door's refusals reject.

## Context

`inject.js` reads only resolution versus rejection: a resolved tool is `{ ok: true, output }`, a
rejected one `{ ok: false, error }`. The demo kit's execute door (`runTool`) was built never to
throw, so a refused argument, a handler that threw and a caller's abort all RESOLVED a
`{"ok":false,"error":...}` sentence. Every kit tool's failure therefore reached the surface as
`ok: true`, the reason vocabulary never left the page for a kit tool, and the journey ledger and the
desktop row recorded a failed call as a success. A domain miss (`open_group` naming no area, with the
areas that exist) travelled the same text channel, so a protocol failure and a domain answer could
not be told apart. Two recorded deviations sat on the same seam: the door had no clock of its own
when the caller sent no signal, and it reported only the first mismatch as one prose sentence.

## Decision

1. **The door says what a call came to.** `runToolOutcome` (door.ts) returns `ok` with the bounded
   text, `refused` with a reason and every mismatch as `{ path, code, message }`, or `failed` with
   `tool failed: <message>`. Reasons the door mints: `validator_failed`, `timeout` (its own ceiling,
   `DOOR_CEILING_MS`, 60 s, longer than the bridge's 30 s so the bridge's abort normally wins) and
   `cancelled` (the caller's abort).
2. **A registered tool rejects a refusal or a fault.** `toolDescriptorFor` (hooks.ts), the pure
   descriptor `useWebMCPTool` registers, rejects a `ToolRefusal { reason, errors }` for a refusal and
   a plain `Error` with no reason for a fault. Whatever the handler RETURNED resolves, a domain
   answer that says `{ ok: false }` included: a domain answer is an answer.
3. **`runTool` keeps its string API** as the text rendering of the outcome, for the direct callers
   that read one string (ledgerbox's and tidycrm's handler tests).
4. **`inject.js` forwards only what a page can honestly mint.** A rejection's `reason` reaches the
   reply (and a `late` event) only when it is `validator_failed`, `timeout` or `cancelled`; any
   other value, a gate's `user_denied` above all, is dropped. A rejection's `errors` travels as an
   additive array (at most 32), sanitised to strings. `protocol.md` documents both.

## Consequences

- A kit tool's refusal or fault is `ok: false` at the surface, with a closed-set reason where the
  door refused, and every consumer of the reply (registry, journey ledger, desktop row) records it
  as a failure without parsing output text. Each forwarded reason is already a member of
  `ERROR_REASONS`; nothing new enters the vocabulary and nothing loosens.
- A `late` answer after the bridge's timeout is now `ok: false, reason: "cancelled"` when the door
  answered the abort, where it was `ok: true` with the text `aborted`. `cancelled` means the door
  stopped waiting, not that the handler stopped: for a write the surface must keep
  `outcome_unknown` (decision 2 of 0101) rather than read a late `cancelled` as "did not happen".
  The desktop's late handling and the doc comment on `CallReply` in `apps/desktop/src/lib/bridge.ts`
  (which says the page mints only `timeout`) are follow-ups outside this change.
- A consumer that parsed `ok: true` output for `"ok":false` would lose those rows; none was found
  in `apps/` or `src/`.
- `inject.js` still runs no schema of the kit's: its own input check (the gate's subset) answers
  first, and the door's path-addressed `errors` only arrive for a mismatch the page's stricter door
  finds, such as a key the bridge's subset lets through.
