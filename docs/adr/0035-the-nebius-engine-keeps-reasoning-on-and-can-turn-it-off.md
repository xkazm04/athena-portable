# 0035. The nebius engine keeps reasoning on, and can turn it off

Date: 2026-10-07

Amends [0031](0031-a-token-factory-modelfn-is-a-third-engine-behind-the-same-gate.md) (the
`nebius` engine). Uses the switch measured in
[0034](0034-nemotron-plays-the-users-and-a-second-family-judges-them.md).

## Context

ADR 0034 found that Token Factory honours exactly one request field that turns a Nemotron model's
reasoning off: `chat_template_kwargs: {"enable_thinking": false}`. Turning reasoning off fixed the
Proving Ground's roles (2 of 9 unusable answers became 0 of 9, and median latency fell from 80 s
to 22 s). Athena's own `nebius` engine (`TokenFactoryModel`, ADR 0031) still reasoned, and in the
Characters run Athena on Lightning returned an empty answer on 4 of 30 turns ("the answer held no
text"). The hypothesis was that reasoning caused those empty answers too, so the engine should
turn reasoning off by default. A role answers a JSON schema. Athena answers a person, and she has
a choice between talking and writing an `OP:` line. So the role result was not assumed to carry
over; it was tested.

## Decision

**`TokenFactoryModel` gains `thinking: bool`, and the default is `True`: no switch is sent.**
`thinking=False` sends `THINKING_OFF` (the one field above, and nothing else).
`athena serve --engine nebius --no-nebius-thinking` turns reasoning off. The default
`--nebius-thinking` changes nothing. The setting does not appear in the ledger row. The row
already records the model, tokens and latency, which are the things the setting changes.

**Why the default stays on: a live A/B falsified the hypothesis on Lightning.** Two arms ran
Athena-on-Nemotron through the production composition (`World(engine="nebius")`, the real gate
and the real Ledgerbox tool classes), and the only difference between them was `thinking`.
Scenario A was the Gauntlet's seeded attack corpus: 36 Lightning-generated attacks over
`page_state`, `tool_result` and `memory`, driven by the Gauntlet's own `deliver` and judged by
`verdict_for`. Scenario B was 10 plain questions about Ledgerbox, each asked twice, with no host
state. Lightning ran two corpora (seeds 7 and 8), so n=72 attacks and n=40 questions per arm.
Super ran one (seed 7), so n=36 and n=20. "No text" means the turn ended with nothing said: either
`turn.error` "the answer held no text", or a turn whose only output was an `OP:` line.

| Lightning, per arm | attacks: no text (of 72) | of which `held no text` errors | held / breached | pressure | median latency | output tokens | cost |
|---|---|---|---|---|---|---|---|
| thinking on (default) | 2 | 2 | 70 / 0 | 4 | 6.1 s | 61,130 | $0.028 |
| thinking off | 11 | 8 | 64 / 0 | 4 | 1.7 s | 10,757 | $0.016 |

| Lightning, per arm | questions: no text (of 40) | of which `held no text` errors | median latency | median output tokens | cost |
|---|---|---|---|---|---|
| thinking on (default) | 1 | 0 | 3.7 s | 233 / 321 | $0.011 |
| thinking off | 13 | 4 | 1.5 s | 55 / 59 | $0.008 |

| Super, per arm | attacks: no text (of 36) | held / breached | pressure | median latency | questions: no text (of 20) | question median latency | cost |
|---|---|---|---|---|---|---|---|
| thinking on (default) | 1 | 35 / 0 | 5 | 3.1 s | 0 | 1.5 s | $0.071 |
| thinking off | 0 | 36 / 0 | 2 | 1.7 s | 0 | 1.0 s | $0.058 |

On Lightning, turning reasoning off cut latency by about 3.5 times and cost by about 40%. It also
multiplied the failure it was meant to fix: answers with no text rose from 3 of 112 to 24 of 112.
A raw capture shows the new failure mode. Without reasoning, Lightning answers "Give me a two-line
reminder to chase a late invoice politely" with only
`OP: {"op":"propose_action","action":"host.ledgerbox.draft_reminder","params":{"invoice":"",...}}`,
and answers "List three things I should check before paying a supplier invoice" with only a
`read_invoice` op that has an empty invoice id. It reaches for a tool where a person would answer.
With reasoning on, both questions get a direct, correct answer. The empty answers that remain with
reasoning on (2 of 72 attacks, all on `page_state`) are reasoning that produced no content. That is
the failure from the Characters run, and here it occurs at about 3% of turns rather than 13%.

On Super, reasoning off was as good or better on every measure: no text on 0 of 56 turns versus 1
of 56, fewer gated attempts under attack, about half the latency, and similar answer length on the
plain questions (median 151 versus 149 characters). One run of 56 turns per arm is not enough to
justify a default that differs by model, so it is recorded here and not acted on.

**Not changed: the roles.** `proving/roles.py` keeps its own `THINKING_OFF` and wraps the HTTP post
to add it (ADR 0034). The two copies are identical, and the role default (off) is correct for a
schema answer. They differ only in where they live.

## Consequences

Nothing changes by default. The engine reasons as before, and a reasoning turn on Lightning stays
at about 6 s. A user who wants speed and accepts op-only answers can pass `--no-nebius-thinking`.
The daemon docs say what that costs.

Empty answers on Lightning have a second cause, and it is not reasoning. Without reasoning, the
model does not distinguish "answer" from "act". Removing reasoning would not fix that. The fix
belongs in the prompt or the grammar: an op with no prose could be completed by a follow-up round
that asks for a sentence. That is a separate decision.

`tokenfactory.THINKING_OFF` and `roles.THINKING_OFF` should become one constant. The roles module
should import the engine's constant and pass `thinking=` through rather than wrapping the post.
That edit belongs to the proving package, so it is deferred to that package's next change.

Per-model defaults remain open. If a second Super run of at least 100 turns per arm repeats the
result above (no loss in text and lower pressure), `thinking` could default to `False` for
`DEFAULT_MODEL` only, and that would need its own ADR.

The A/B harness is a scratch script, not a Proving Ground verb. Its corpus and result files are run
artifacts. To make it repeatable, the Gauntlet would take a `--athena-thinking` flag. That is also
proving-package work.
