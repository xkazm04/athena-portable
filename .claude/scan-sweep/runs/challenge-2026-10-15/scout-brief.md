# Scout brief - scan-sweep --challenge, run challenge-2026-10-15

You are a READ-ONLY scout. You change no source file, run no gate that writes, commit nothing.
The only file you write is your card file (below). Repo root: the current working directory.
Base sha: see `.claude/scan-sweep/runs/challenge-2026-10-15/base.sha`.

## Your job

Read ONE host context (and its riders) once, in full, and return exactly TWO challenge cards:

- **Slot A - `architecture-challenger`**: the structural move this context needs to stop being the
  reason something else is hard: the seam that caps it, the duplicated rule that should be one
  module, the synchronous path that should be a job, the hand-list that should be derived, the
  state machine hiding in booleans. Read it through architecture-analyst, risk-assessor,
  parity-auditor and tech-debt-tracker eyes.
- **Slot B - `ux-elevation`**: the experience leap, not polish: a flow that takes five steps and
  should take one, a decision the user makes blind that the app already has the data for, a
  surface that reports state it should let you act on, a missing mode (compare, bulk, undo,
  preview). A context with no user surface fills slot B with a SECOND architecture card on a
  DIFFERENT seam, `slot: "B-architecture (no UI surface)"`. An operator-facing surface (CLI
  output, a log a person reads, a spoken reply, a panel) IS a user surface.

Consider many ideas; return the best two, and name the runner-up of each slot in one line.

## Floors (a card under any floor is not a challenge card)

| Field | Floor |
| --- | --- |
| size | M or L, never S |
| effort | >= 5 (1-10) |
| impact | >= 7 (1-10): a user or operator notices, or a whole class of defect closes |
| risk | 4-8 (1-10) |
| write set | <= ~15 files, <= ~800 changed lines, declared up front (tests included) |

If your best idea in a slot is under a floor, put it in `rehomed` (one line each) and find another
for the slot. Never shrink or inflate a card to pass a floor.

## Read first

1. `README.md` (the six invariants, section 2, and the architecture, section 3: the authority),
   `AGENTS.md` (the rules: contracts first in `src/athena/contracts/`, one decision one ADR,
   one commit per feature).
2. The registry subject(s) that govern your context: `.ai/registry-map.json` -> `contexts[]`
   where `name` is your host -> `subjects[]`. Take a subject's file from `subjectIndex` VERBATIM
   (never build a path from a slug) under `../ai-registry/knowledge/`. Read its golden path and
   the techniques whose `use_when` match. Name the technique in a card when it applies.
3. NEVER RE-PROPOSE (a card restating one of these is void): `.claude/scan-history/backlog-2026-10-13.md`,
   `tiger/backlog.md`, `docs/BACKLOG.md`, and the ADRs in `docs/adr/` (an idea an ADR already
   decided against is void; read the titles, open any that touch your seam). You MAY adopt an
   open backlog item that is itself high-effort - cite it.
4. Your files: `.claude/scan-sweep/runs/challenge-2026-10-15/cohort-files.txt` lists every context
   in the cohort with its description and file paths. Read your host's files and every rider's
   files IN FULL. Follow imports out of the context only as far as a premise needs.

## The card - write ALL of it

Every anchor is `<repo-relative path>:<line>` exactly as `git ls-files` prints the path.

```json
{"context":"<host or rider name the card targets>","slot":"A|B|B-architecture (no UI surface)",
 "lens":"architecture-challenger|ux-elevation","title":"<= 80 chars",
 "size":"M|L","effort":7,"impact":8,"risk":6,
 "write_set":["<repo-relative path, existing files it edits, tests included>"],
 "new_files":["<paths it creates>"],
 "shared_surfaces":["CHANGELOG.md", "docs/adr/NNNN-... (if the change is a decision a reader could question)"],
 "generated":["<any file in the write set that is GENERATED, and by what command - else []>"],
 "acceptance":["<case: input -> expected>", "... 3 to 8 cases, each a test a builder writes FIRST and watches fail"],
 "guard_cases":["<indexes of acceptance cases that pin behaviour that must NOT change (green before by design)>"],
 "premise":["<path:line - the fact the idea stands on>", "..."],
 "rollback":"<how the commit series reverts cleanly>",
 "gate":"none|contract|policy-tighten|architecture|direction|irreversible|policy-loosen",
 "gates_to_run":["<the overlay gate commands this touches - see below>"],
 "runner_up":"<the slot's second-best idea, one line>",
 "body":"## Summary\n...\n\n## Description\n...\n\n## Flow\n- ...\n\n## Expected impact\n...\n\n## Evaluation\nClaim: ...\nBefore: 0 of N acceptance cases pass (or the measured figure)\nAfter: N of N\nMethod: gate - the acceptance cases\nResult: better\nGate: <as above>",
 "evidence":"<the exact lines / grep output / counts the premise stands on>"}
```

- `acceptance` is the heart of the card. A UX card's cases are behaviour of the logic module under
  the surface (the state it enters, the action it enables, the call it makes). A card whose claim
  cannot be written as cases is not a challenge card.
- `gate` is an escalation only when the implementation REQUIRES it. `architecture` = changes what
  the product IS (new layer, protocol redesign) - allowed here, the deck approves it. `direction` =
  a capability the context's declared description does not name. A change to
  `src/athena/contracts/` is a `contract` (in-tree; name its verifier). Anything that deletes
  user data, weakens a gate/audit/consent check, widens access or sends more data off-device is
  `irreversible` / `policy-loosen` and will NOT be built - prefer a card that is not.
- Gates (overlay): Python core from the root: `uv run ruff check .`, `uv run ruff format --check .`,
  `uv run mypy`, `uv run pytest -m "not provider and not eval"`; workspace TS from the root:
  `pnpm typecheck && pnpm lint && pnpm test`; desktop from apps/desktop: same three plus
  `pnpm perf:all` when motion or first paint is touched; Rust from apps/desktop/src-tauri:
  `cargo check && cargo clippy --all-targets`.

## Output

1. Write `.claude/scan-sweep/runs/challenge-2026-10-15/cards/<host>.json` BEFORE you reply:
   `{"host":"<host>","cards":[<slot A card>,<slot B card>],"rehomed":["..."],
     "riders":[{"name":"<rider>","checked":"<files read, hypothesis traced, why no card went there - one line>"}],
     "registry":{"subjects":["<slug>"],"techniques":["<slug>"]},
     "files_read":<n>}`
   Use the Write tool, not a shell heredoc. Validate it parses (`node -e "JSON.parse(require('fs').readFileSync(p,'utf8'))"`).
2. Reply in under 150 words: the two titles with size/effort/impact/risk, the runner-ups, and the
   rider lines. Your reasoning stays with you - the critic will not see it.
