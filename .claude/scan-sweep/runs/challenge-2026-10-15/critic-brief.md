# Critic brief - scan-sweep --challenge, run challenge-2026-10-15

You are the INDEPENDENT critic. Twelve challenge cards were written by scouts you have never
talked to. You get the cards and the tree - nothing of how the scouts reasoned. You change no
source file and commit nothing. The only file you write is your verdict file.

Repo root: the current working directory. Base sha: `.claude/scan-sweep/runs/challenge-2026-10-15/base.sha`.
Cards: `.claude/scan-sweep/runs/challenge-2026-10-15/cards/*.json` (6 files, `cards[]` of 2 each).
Ignore each file's `rehomed` and `riders` fields except to check a card is not one of them.

## For EVERY card

1. **Re-verify the premise.** Open every `file:line` in `premise` (and the `evidence` block) on
   the current tree. Is the fact true as stated? Is it still true (the code may already do it)?
   A false or already-fixed premise VOIDS the card - count it as `premise_false`.
2. **Check the floors.** size M or L (never S); effort >= 5; impact >= 7; risk 4-8; write set
   (write_set + new_files) <= ~15 files and <= ~800 changed lines by your own estimate;
   3-8 `acceptance` cases. Is the size honest - would a careful engineer call it an S? Is the
   risk honest?
3. **Never re-propose.** Void a card that restates an item in `.claude/scan-history/backlog-2026-10-13.md`,
   `tiger/backlog.md`, `docs/BACKLOG.md`, or that an ADR in `docs/adr/` already decided against.
   Adopting a high-effort open backlog item with a citation is allowed.
4. **Check the gate honestly.** Would the implementation, as the card describes it, weaken a
   consent/gate/audit check, widen access, send more data off-device, or delete user data? Then
   it is `policy-loosen` / `irreversible` whatever the card says. Is a `direction` card inside
   the context's declared description (in `context-map.json`, the `contexts[]` entry by name)?
   Does a `contract` card name an in-tree verifier?
5. **Grade 1-5, one sentence each:**
   - `ambition` - the move a principal engineer would make here, or a big-sounding tidy-up?
   - `grounding` - does every claim stand on the tree as it is?
   - `falsifiability` - would the acceptance cases catch a wrong build? Can each be written as a
     test BEFORE the implementation and be red on the base tree (except declared guard cases)?
6. **Verdict:** `build` / `revise` (exactly ONE concrete change the coordinator applies - e.g.
   drop case 9, narrow the write set, re-gate - no second scout round) / `void` (with the reason).
7. **Write-set conflicts.** List every pair of cards whose `write_set`/`new_files` share a file,
   and any card that changes a signature other cards call.

You never add a card of your own.

## Output

Write `.claude/scan-sweep/runs/challenge-2026-10-15/critic.json` with the Write tool BEFORE you reply:

```json
{"critic_model":"<your model id>",
 "verdicts":[{"context":"<host>","slot":"A|B|...","title":"...","premise":"true|false|stale",
   "premise_notes":"<what you checked, file:line>","floors_ok":true,"floor_notes":"",
   "gate_check":"<card gate> -> <your gate>","ambition":4,"ambition_why":"...",
   "grounding":4,"grounding_why":"...","falsifiability":4,"falsifiability_why":"...",
   "verdict":"build|revise|void","revise":"<the one change, or null>","void_reason":null}],
 "conflicts":[{"cards":["<host>/A","<host>/B"],"files":["..."]}],
 "signature_changes":[{"card":"<host>/<slot>","symbol":"...","callers_in_other_cards":["..."]}]}
```

Validate it parses. Reply in under 200 words: the verdict per card (one line each) and the
conflicts.
