# 0228. A call keeps its words only after the consent line, and an appeal is bound to its packet hash

Date: 2026-10-26

Builds on [0226](0226-a-sense-writes-cited-world-tables-and-a-chore-earns-featured-on-its-proofs.md)
(a sense writes cited world tables), 0038 (a single-use approval) and 0057 (the authoring floor).
Spike: `docs/concepts/meta-featured-chores/02-appeal-kin/`. Code: `src/athena/senses/call/`; chore:
`playbooks/prior-auth-denial-appeal/`.

## Context

Spike 02 never records a call without the spoken consent line and never files a sentence without
a source, and the caregiver's approval must be bound to the packet she was shown. The bench's
simulated portals take scalar params only and answer a gated call with a fixed sentence, so they
cannot hash a packet Athena composes during a run.

## Decision

1. **Consent gates the words, not the call.** A recording keeps its turns only when a turn
   starting in its first 60 seconds contains the item's `consent_line` (case, punctuation and
   whitespace ignored). Otherwise `call_turns` gets nothing from it, `asked` gets
   `<media_id>.consent`, and `call_log` says `consent: "missing"`. The transcription call is still
   a priced `SenseCall` row. A line said after the first minute does not rescue the call.
2. **Speakers are roles, or the raw label.** `params.speakers` maps a diarized label to a role; a
   label it leaves out (an IVR, a third voice) stays as the label, never guessed into a role.
3. **A packet's hash is canonical.** `packet_sha256` hashes the sentences in order, text byte for
   byte, cites as a sorted set, other keys dropped. `file_appeal` takes it as `packet_sha256`, and
   the chore's truth is keyed by it: the one fully cited draft is eligible, each flawed draft a trap.
4. **Drafts are world data.** The chore's packets are drafts already in the world (a sibling's
   drafting app), each with its stored hash; Athena checks every sentence against the sheets and
   the calls and files one by its hash. A test holds every stored hash to `packet_sha256`.

## Consequences

- A call recorded without the line is invisible to Athena: a draft citing its turns has a cite
  that resolves to nothing, which F3 counts as no source.
- Athena does not yet write the packet she files. A page tool that drafts a packet and returns
  its hash would let her, and the truth would stay keyed the same way.
- The representative authority (spike 02's R4 second half) is a truth trap on the bench, not a
  sense measurement.
