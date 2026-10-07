# Feedback on Nebius Token Factory, AI Cloud and NVIDIA Nemotron

Measured while building the Proving Ground (README §13). Run ids are folders under the gitignored
`proving-runs/`.

## Token Factory

**The reasoning switch works in one spelling only.** `chat_template_kwargs: {"enable_thinking":
false}` turns reasoning off on Lightning and Super. `reasoning_effort: "low"`, `reasoning:
{"enabled": false}`, a `/no_think` system line and "detailed thinking off" each return HTTP 200 and
are silently ignored (five-way probe, ADR 0034). *Suggestion:* reject or warn on ignored reasoning
parameters, and say in `GET /v1/models` how to control the `reasoning` feature it lists.

**Reasoning leaks into `message.content`.** With reasoning on, 2 of 9 Lightning generator answers
were about 30,000 characters of chain of thought with no `<think>` tags and no
`reasoning_content` field, and never reached the requested JSON (`20261007T140609Z`).
*Suggestion:* return reasoning in a separate field.

**Price is the headline.** The Nemotron side of a 93-turn adversarial run cost $0.023
(`20261007T140609Z`); a Super judge scored 24 transcripts for $0.022 against $0.87 for the Claude
Haiku control (`20261007T144722Z`).

## Token Factory Sandboxes

**Beta access is invisible from the key.** A key without access sees only an all-false permission
map from `GET /v1/whoami`, with no pointer to the access form (spike, ADR 0033). *Suggestion:* name
the missing permission and link the form in the 403.

**The `Project` header has no visible value.** Every call needs it, Token Factory never displays
it, and it had to be found through Nebius IAM; `whoami` accepts any string, so it cannot validate
one. *Suggestion:* show the project id next to the key and validate it in `whoami`.

**`contree-sdk` 0.3.6 disagrees with itself.** The documented Getting Started constructor raises
`ValueError`; the SDK reads `NEBIUS_PROJECT_ID` while the CLI reads `NEBIUS_AI_PROJECT`, and with the
variable unset it sends a literal string as the project. Pricing is not published.
*Suggestion:* one variable name, a tested docs example, published prices.

## Nebius AI Cloud: Serverless Endpoints

**A Token Factory key cannot deploy an endpoint.** It needs a separate AI Cloud tenant and project,
`editor`, VM and VPC quota and a signed-in `nebius` CLI, so the trigger page's container
(`proving/serverless/`) is built and not deployed. `ai endpoint create` documents no health-check
flag. *Suggestion:* a path from a Token Factory account to a small endpoint.

## NVIDIA Nemotron models

**Lightning is a good user simulator.** 69 of 72 turns in persona and 72 of 72 valid JSON
(`20261007T144722Z`); 70 of 72 on the shipped code (`20261007T162204Z`).

**Lightning is not a judge; Super is a borderline one.** Rubric agreement with Haiku was rho 0.183
on Lightning and 0.517 to 0.528 on Super over three runs. Both were lenient (mean 4.23 and 3.52
against Haiku's 2.34), and both scored a pending card as "sent" (`20261007T144722Z`). Stating each card's status in the
prompt removed that error. *Suggestion:* publish judge-calibration guidance for Nemotron.

**Lightning breaks nested JSON more than flat.** A nested `card` object closed wrongly on 5 of 76
live answers (`20261007T155137Z`) and 2 of 32 in a probe; the same fields flat parsed 32 of 32.

**Reasoning off helps roles and hurts the agent.** Off, Lightning's JSON roles went from 35 to 45
of 45 schema-valid at a tenth of the cost. As Athena with tools, off was 3.5 times faster (1.7 s
against 6.1 s median) and held the gate equally (0 breaches in 72 attacks per arm), but turns with no
text rose from 3 to 24 of 112: it answered plain questions with a bare tool call (ADR 0035). On
Super, off lost nothing. *Suggestion:* document the trade per model.

**Nemotron Safety Guard is not on Token Factory**, so our attack labeller used the Haiku control
instead. *Suggestion:* serve it.
