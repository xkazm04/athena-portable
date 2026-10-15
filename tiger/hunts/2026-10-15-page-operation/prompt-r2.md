# Tiger council - round 2 (selection and crossbreeding)

You are one seat of the same council. Round 1 produced a pool of proposals from every seat
for the feature area `packages/athena-bridge, src/athena/lane, examples/demo-kit/src/webmcp, apps/desktop/src/lib/hands.ts, apps/desktop/src/lib/bridge.ts, apps/desktop/src-tauri/src/bridge.rs, apps/desktop/src-tauri/src/hands.rs`. The pool is at `<repo>/tiger/hunts/2026-10-15-page-operation/pool.md`; the dossier is still at
`<repo>/tiger/hunts/2026-10-15-page-operation/brief.md`; your working directory `<seat-worktree>` is the same read-only checkout. Seats
are anonymous in the pool - you may recognise your own ideas; do not rate those.

**Do not modify, create or delete any file anywhere. Do not commit. Do not install
packages. Do not call other models.**

## Do two things

1. **Rate** every proposal you did not write, 1-10, on one question: *if this were built
   well, how much more valuable would the area be to its users, given the effort?*
   Check the claims you can check in the code before you rate - an anchor that does not
   say what the proposal claims, or a capability the code already has, should cost points
   and the `why` should say so in one sentence. Use the whole scale; a pool where
   everything is a 7 tells the judge nothing.

2. **Crossbreed** up to 2 new proposals that are clearly stronger than their parents: a
   fusion of two or more pool ideas, or one pool idea with the flaw you found fixed and
   its ambition raised. Each lists its `parents` (pool ids such as `P03`). Do not restate
   a parent with new words; if nothing is stronger, return no new proposals.

End your reply with ONE fenced `json` block, and nothing after it, in exactly this shape:

```json
{
  "ratings": [
    { "id": "P01", "score": 7, "why": "one sentence, naming what you checked" }
  ],
  "proposals": [
    {
      "title": "short imperative title, <= 80 chars",
      "kind": "deepen | extend | connect | leap",
      "parents": ["P03", "P11"],
      "outcome": "what a user can do or gets afterwards that they cannot today",
      "builds_on": "the existing strength this evolves",
      "mechanism": "how it works - the key design move, concretely",
      "anchors": ["src/example/file.ts:120-168"],
      "evidence": "why it would work; hypothesis vs observed stated plainly",
      "effort": "S | M | L",
      "risk": "the main way it could fail or hurt, and the mitigation",
      "verify": "the observable acceptance check",
      "why_groundbreaking": "what changes for the product, in one or two sentences"
    }
  ]
}
```
