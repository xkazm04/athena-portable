# 0034. Nemotron plays the users, and a second family judges them

Date: 2026-10-07

Builds on [0030](0030-nebius-is-the-proving-ground-not-the-companion-engine.md) (Nebius is the
proving ground, every Nemotron role beside a Claude control) and
[0032](0032-the-gauntlet-verdict-comes-from-the-gate-never-from-a-model.md) (the shared proving
core). Implements README §9, "Model-played Characters", and the `uat` skill's conversation level
(LC) for Athena.

## Context

`uat/` holds Athena's Characters (mira, jonas, priya, ana; the juror is an evaluator, not a user)
and their journeys. Today a journey is certified by a person or by the user's own Claude CLI, one
at a time. The claim under test: NVIDIA Nemotron can stand in for those users, and as a second
judge family, so a conversation level can run at volume for cents. Two proofs decide it:

1. Persona fidelity: the Claude Haiku control, blind, finds at least 80% of simulated user turns
   in persona.
2. Judge agreement: a Nemotron judge and the Haiku judge score the same transcripts against
   `uat/rubric.md`, with Spearman's rho at least 0.5 (the prior was 0.50). Below 0.3, Nemotron is
   not used as a judge.

The WP2 Gauntlet run had also left a measured defect in the shared role client: Lightning
sometimes returned about 30,000 characters of raw chain of thought in `message.content` and never
reached the requested JSON.

## Decision

**Nemotron roles run with reasoning off, through the request field the server honours.**
`NebiusRole` sends `chat_template_kwargs: {"enable_thinking": false}` unless it is built with
`thinking=True`. The field is added by wrapping the role's HTTP post, so `TokenFactoryModel`'s
request builder stays the engine's. Five candidate remedies were probed on Lightning with the same
prompt. `reasoning_effort: "low"`, `reasoning: {"enabled": false}`, a `/no_think` system line and
"detailed thinking off" were each accepted and each ignored; only the chat-template switch removed
the reasoning. An A/B through `RoleCaller.call_json` on the same nine Gauntlet generator prompts
(n=9 per arm) decided it:

| Lightning | unusable answers | raw reasoning in content | schema-valid attacks | median latency | median output tokens | cost |
|---|---|---|---|---|---|---|
| thinking on (before) | 2 of 9 (one 32,027-character reasoning dump, one 180 s timeout) | 3 of 9 | 35 of 45 | 80.1 s | 7,451 | $0.0142 |
| thinking off (after) | 0 of 9 | 0 of 9 | 45 of 45 | 22.0 s | 567 | $0.0014 |

Super honours the same field (n=6 per arm: 0 unusable either way, median 12.1 s and 2,555 output
tokens before, 3.9 s and 700 after). The change is kept because it helped on every measure. It
applies to every role, so the Gauntlet's attackers get it too. Athena-under-test on the `nebius`
engine is not a role and is not changed here (ADR 0031 owns that engine).

**A Character becomes a user simulator, and a journey becomes a chat scene.** `proving/characters/
persona.py` reads a Character's frontmatter and body. The simulator gets the person: the role, the
chore, the senior bar, background, voice, expectations and pet peeves. It does not get the scored
acceptance criteria, because those score the desktop UI and are not something a person says. The
journeys are written for windows and chords, so each journey a Character can have in text gets
one scene line (`LC_SCENES`: J1, J3, J4, J5). The scene adapts the journey's own Goal paragraph,
which the simulator also reads; it does not replace it. A Character runs its first two LC journeys
in `LC_PREFERENCE` order (mira J3 and J1, jonas J3 and J4, priya J1 and J5, ana J3 and J5). The
simulator answers `{message, intent, satisfied}`, which is schema-checked. An unusable answer is
retried once and then ends the conversation; both attempts are counted.

**Conversations run on the real composition, on a realistic page.** Each conversation is a fresh
`World` (WP2) with Ledgerbox's real tool classes and three user messages. The host state is
Ledgerbox open on the invoices view, with three invoices over 30 days, a client asking to split a
payment, an unmatched half-payment, and a changed billing contact. A host call the gate lets
through is answered by a simulated page, the way the desktop run loop answers it
(`apps/desktop/src/stores/run.ts`: the same continuation line, bounded at three). READ tools answer
from the state. `draft_reminder` answers with the whole draft, as Ledgerbox's own does. A GATED
tool never reaches the page; it becomes a card. The simulated user cannot answer a card from the
chat, so cards stay pending. Athena-on-Claude runs in full (two repeats per pair) and
Athena-on-Nemotron runs sampled (one repeat), from the same purses: $1 for Nemotron and $10 for
Claude per run. Athena-on-Claude may spend 70% of the Claude purse. The rest is reserved for the
Haiku judges, which run after the conversations; without the reserve, a row could leave both
proofs unmeasured.

**Judges score; they never set a verdict.** The fidelity judge is the control. It sees the
Character card and the transcript, but not which model played the user, and answers
`{in_persona, reason}` per user turn. The rubric judges, one Nemotron and one Haiku, score the
seven `uat/rubric.md` dimensions from 1 to 5. Each is blind to the Athena row and to the other
judge. Every transcript line in every judge prompt is inside one nonce fence per prompt. Agreement
is Spearman's rho, implemented in the standard library with averaged ties, over every
(transcript, dimension) pair both judges scored. Each Nemotron role climbs the ladder once: the
users move to Super if fidelity fails on Lightning, and the judge moves to Super if rho is under
0.5 on Lightning. Under 0.3 at the end, the report says "not used". No score feeds a decision
about Athena, and nothing here decides what is gated.

## Consequences

- First full run (`proving-runs/20261007T144722Z`, 24 conversations, 72 user turns, 739.5 s):
  - **Proof 1 passes on Lightning.** 69 of 72 turns were in persona (0.958), with 72 of 72 user
    answers schema-valid. The users stayed on Lightning.
  - **Proof 2 passes only after escalation.** The Lightning judge reached rho 0.183, which is
    below the kill line. The Super judge reached rho 0.517 over 168 pairs, which is borderline and
    in line with the 0.50 prior. Rho was 0.486 at the transcript level.
  - **Cost.** Nemotron spent $0.053 and Claude $6.07 (Athena-on-Claude $4.80, Haiku judges
    $1.27). The Super judge cost $0.022 for 24 transcripts. The Haiku rubric judge, through the
    CLI, cost $0.87 for the same transcripts.
- **Nemotron judges are lenient and can be fooled by the user's own words.** On Athena-on-Nemotron
  transcripts, the mean score was 4.23 from Lightning, 3.52 from Super and 2.34 from Haiku. On one
  transcript, both Nemotron judges gave every dimension 5 and wrote that the reminder "was sent".
  The record shows a pending card, which is what Haiku scored. Nemotron is used as a judge only
  beside the control, never instead of it.
- **Two of the three out-of-persona turns come from this harness.** In each, the user tried to
  approve a card in chat after Athena said approval happens on the card. Answering cards from the
  simulator is the next step for LC.
- **Athena-on-Nemotron returned an empty answer on 4 of 30 turns** (`engine_error`, "the answer
  held no text"). That is the `nebius` engine with reasoning on. Whether the engine should send the
  same switch is a separate decision for ADR 0031's engine, not for this one.
- Spearman is undefined when one judge gives the same score everywhere, so the proof then reports
  `None` and counts it as a kill. It never reports 0.
