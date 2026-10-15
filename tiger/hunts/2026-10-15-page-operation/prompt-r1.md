# Tiger council - round 1 (variation)

You are one seat of a small council of senior engineers from different labs. Each seat gets
the same dossier and works alone; no seat sees another's answer in this round. A separate
judge will read every proposal blind - it will not know which seat wrote what - and a person
will choose what gets built.

## The territory

The dossier is at `<repo>/tiger/hunts/2026-10-15-page-operation/brief.md`. Read it first, completely. It names the product's most
valuable feature area (`packages/athena-bridge, src/athena/lane, examples/demo-kit/src/webmcp, apps/desktop/src/lib/hands.ts, apps/desktop/src/lib/bridge.ts, apps/desktop/src-tauri/src/bridge.rs, apps/desktop/src-tauri/src/hands.rs`), why it is the most valuable, what it does today, its
users and their jobs, the numbers that exist, recent history and what is off-limits.

Your working directory `<seat-worktree>` is a read-only checkout of the repository at the
commit the dossier describes. Read the code yourself; the dossier is a map, not the
territory. You may run read-only commands (search, list, `git log`, a test runner if one
works without installing anything). If your harness can search the web, use it for prior
art and cite the URL. **Do not modify, create or delete any file anywhere. Do not commit.
Do not install packages. Do not call other models.**

## The question

> What would make this area markedly more valuable to the people who use it - building on
> what it already does best, not replacing it?

Think in evolution, not revolution: the strongest moves usually make the existing strength
do more (deepen), carry it to an adjacent job (extend), feed it something the product
already has but does not give it (connect), or reframe what it is for so it becomes a
category of its own (leap). A proposal that throws the area away and starts over is out of
scope; so is generic hygiene (lint, refactors, test coverage, dependency bumps) unless it
directly unlocks a value move you name.

## What to return

Between 3 and 6 proposals. At least one must be `kind: "leap"` - bold, plausible, worth a
person's serious attention - and at least one must be something a small team could ship in
days that compounds. Fewer, sharper proposals beat many thin ones; the judge scores
verified substance, not volume.

Every proposal must be grounded:
- `anchors`: 1-8 `path:line` or `path:start-end` references (repo-relative, forward
  slashes) to the code it builds on or changes. They are checked mechanically against the
  commit; an anchor that does not exist counts against you.
- `builds_on`: the existing strength it evolves, in one or two sentences.
- `evidence`: why you believe it would work - something in the code, the data, the
  dossier's numbers, or prior art (with URL). Say plainly when it is a hypothesis.
- `verify`: an observable acceptance check that distinguishes success from failure
  (a metric that moves, a scenario that now passes, a number before/after). "Users will
  love it" is not a check.

End your reply with ONE fenced `json` block, and nothing after it, in exactly this shape:

```json
{
  "proposals": [
    {
      "title": "short imperative title, <= 80 chars",
      "kind": "deepen | extend | connect | leap",
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

Prose before the block is welcome but optional: the block is what the judge reads.
