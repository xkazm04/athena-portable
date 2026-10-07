# 0030. Nebius is the proving ground, not the companion engine

Date: 2026-10-07

Extends [0007](0007-engines-are-configuration.md): engines stay configuration behind one gate. What
this adds is a reason to run an engine other than the user's own CLI, and the limit on what that
engine is for.

## Context

The repository is entered in the Nebius x NVIDIA Global AI Hackathon. To be eligible, a project
must make a runtime call to the Nebius Token Factory inference API, or run on Nebius AI Cloud
compute, and must use at least one NVIDIA open model. Stage one rejects "a superficial rebrand";
stage two weighs a creative, non-obvious use of Token Factory and the NVIDIA models equally with
implementation, design and impact.

Two things already decided pull against the obvious answer, which is "run Athena on Nemotron":

- **Invariant 5 (README §2).** No provider is mandatory; engines, transports and clouds are extras
  imported lazily. A hackathon cannot make Token Factory a requirement of the product.
- **The user's engines.** Athena's daily engine is the CLI the user is already signed in to,
  Claude Code or Codex, with no API key (ADR 0007). Swapping that for a hosted API would ask the
  user for a key and a bill they do not have today, for no gain they asked for.

Meanwhile the product has a real gap that an open model on fast inference fits. The gate, the
fences and the OP-grammar repair are held by hand-written tests only; nothing generates
adversarial injection or gate-bypass attempts, and no live model is ever pointed at hostile page
content. The `uat/` Characters exist, but no model plays them and no model judges the result. The
ledger already records engine, model, tokens and cost per turn, so it is ready to measure.

The quality of the NVIDIA tooling (the Nemotron models, Token Factory, its beta Sandboxes) is
unknown to this project, and the operator's instruction is to assume it is mediocre until shown
otherwise.

## Decision

**Nebius and NVIDIA are used for testing, simulation and measurement — the Proving Ground — and
not as the companion's engine.** Nemotron on Token Factory attacks the gate from four channels
(host page state, tool results, a foreign agent over MCP, memory poisoning), plays the `uat/`
Characters, and judges conversations against `uat/rubric.md`. Token Factory Sandboxes are spiked
as checkpointed, forkable worlds. Athena runs under test both on her Claude CLI and on Nemotron
through a new `nebius` engine, which is a matrix row, not her default.

**Every Nemotron role has a control row.** Claude Haiku generates, judges or is compared beside
each Nemotron role, and a Nemotron result counts only within a stated margin of its control.
This is because the tooling quality is unproven, and the gap between the two rows is itself a
finding for the hackathon's feedback field.

**Prototypes prove before they are polished.** The `nebius` engine, the Gauntlet, the
model-played Characters and the Sandbox spike each carry a falsifiable proof test and a kill
criterion (README §9). None is developed past its prototype until its proof passes; one that is
killed falls back to the control or to local processes, and the reason is recorded.

**The track is chosen after the proofs.** Coding and agentic engineering, personal AI and best
apps all fit some prototype; which one is entered depends on which prototypes prove.

**The invariants hold unchanged.** The Token Factory engine uses stdlib `urllib` under
`harness/`; anything that needs a third-party package, such as a Sandbox SDK, sits behind a lazily
imported `nebius` extra, and core imports none of it. It uses the same gate and writes
the same ledger row, with a reason from `ERROR_REASONS` on failure. Its key is read from
`NEBIUS_API_KEY` and never logged. The Proving Ground's own model calls (attacker, user, judge)
are ledgered too, and each attack runs against its own throwaway brain.

Rejected: Nemotron as Athena's daily engine (breaks the no-key promise and invariant 5 in spirit);
Claude only (not eligible); Nemotron only, with no control (an unknown-quality model judging an
unknown-quality model proves nothing); a separate repository (the Proving Ground tests this code
and belongs beside it).

## Consequences

- The product path does not change: a user with no Nebius account runs everything that runs today.
- The README and `docs/submission.md` describe the Proving Ground as planned, with a status table,
  until each prototype lands. No result is claimed before a run produces it.
- Every Proving Ground run costs twice, once for Nemotron and once for the control. That is the
  price of being able to say whether Nemotron did the job.
- A killed prototype is a result, not a failure to hide: it goes to the feedback section with the
  evidence.
- Live proof runs wait on a Token Factory key. Fixture tests come first, so the prototypes can be
  built and tested before the key exists.
