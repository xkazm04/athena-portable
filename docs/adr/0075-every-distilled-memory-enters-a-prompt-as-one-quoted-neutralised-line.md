# 0075. Every distilled memory enters a prompt as one quoted, neutralised line

Date: 2026-10-11

Extends [0071](0071-an-approved-fact-rides-every-turn-and-its-file-says-so.md) from the always tier
to the keyword lane, and fixes the order of its three steps. Keeps
[0006](0006-two-output-prompt-composer.md) (a fence payload is never edited) and
[0068](0068-page-text-in-the-capabilities-block-is-neutralised-not-fenced.md) (the neutralising
rule itself). Closes provenance-backed-memory council full r1 robustness-4 and robustness-5, and
injection-resistance council full r2 robustness-1 and craft-8 (its memory half).

## Context

Recall renders three blocks. `memory.always` goes to the system prompt and `frame.memory` (the
keyword lane) to the turn frame. Neither is fenced: only `frame.episodes` is, because only it is
marked untrusted. ADR 0071 made each always-tier line one capped JSON string, and its last
consequence left the keyword lane as it was. That lane wrote `- {excerpt}`, raw. A fact or
procedural is distilled from episodes a page may have shaped, so its stored value could carry CR,
LF, U+0085, U+2028 and U+2029, bidi and zero-width characters, a `## ` heading, an `OP:` line or a
forged fence close straight into the user message, where it reads as structure.

The always tier had an ordering defect too. `always_line` ran `fence.neutralise` first and
`neutralise_text` second. `neutralise_text` drops format characters, so a marker split by U+200B
(`<<<`, U+200B, then `untrusted:0123456789abcdef`) passed the sweep in pieces and came out whole.

## Decision

**One function renders a distilled memory, `recall.memory_line(text, cap)`.** Three steps, in this
order:

1. `catalog.canonical_line`: whitespace runs become one space; Cc and Cf characters are dropped.
   This is the first half of `neutralise_text`, split out with no cut.
2. `fence.neutralise`: every marker of the default label is redacted, with no nonce, so the
   result is deterministic.
3. `neutralise_text(…, cap)` then `json.dumps(…, ensure_ascii=False)`: the cut with an ellipsis,
   and a quoted string that cannot start a line, a heading or an `OP:` line.

Canonicalising before the sweep is the rule: whatever is validated is the text that is shown.
`always_line` stays as an alias, so ADR 0071's name still resolves.

**`Memory.render` branches on kind, not lane.** A fact or procedural renders through
`memory_line` in both lanes: at `ALWAYS_LINE_CAP` (400) in the always tier and at
`KEYWORD_LINE_CAP` (`EXCERPT_BYTES`, 500) in the keyword lane. An episode renders as before, raw,
in every block. `recall_whole` builds its episode memories with lane `keyword`, so a lane test
would have edited a fenced payload, which ADR 0006 forbids. A `[machine] ` marker, which today
only an episode carries, stays outside the quotes.

**The budget holds.** Six keyword lines of 500 characters, every one a character JSON must escape,
are 6 × (2·500 + 4) ≈ 6,000 characters plus the heading and footer, inside the 12,000 of
`BUDGETS["frame.memory"]`. A test pins this through `prompt.compose`.

## Consequences

- A keyword-lane line now reads `- "text"` instead of `- text`, and its text is one line. A
  memory's `excerpt`, `as_dict` and file keep the words as written; only the rendering changes.
- The model can no longer tell a line break inside a stored fact from a space. A fact that needs
  structure should be several facts.
- `core.recall`'s keyword block is quoted too, since it uses the same render.
- `prompt.py` and `fence.py` are unchanged. The capabilities block's own marker sweep (the other
  half of injection r2 craft-8) is not part of this decision.
