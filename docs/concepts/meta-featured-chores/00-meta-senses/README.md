# Spike 00 - Meta senses: the foundation every featured chore stands on

Status: **spike, not designed** (2026-10-24). Runs **first**; spikes 01-05 start their model work on
what it lands. Program: [../README.md](../README.md). Facts at the start: [../meta-model-facts.md](../meta-model-facts.md).
Shared know-how: [../know-how.md](../know-how.md).

## Spark

Owner, 2026-10-24: "Each variant as chore in the existing app - they will become featured chores,
spikes will try to overcome risks and confirm feasibility, realiability and brought value. [...]
Each spike will be triggered separately, but having shared know how regarding of Meta models will
help [...] once one achieves breakthrough in using model or successful technique, other can benefit
quickly."

Five chore spikes need the same new senses from one vendor. If each builds its own Meta client,
the first breakthrough lives in one spike's code and the other four repeat the mistakes. This spike
builds the senses once, measures the API the moment a key exists, and opens the know-how vault.

## What it lands

| # | Piece | Builds on (exists today) | Done when |
|---|---|---|---|
| 1 | **Meta engine** - `muse-spark-1.3` (and `muse-wonder-1.0`) as a `ModelFn` | `harness/tokenfactory.py` is already a stdlib OpenAI-compatible client with a base-URL field; `harness/engines.py`; the plan in `docs/concepts/blue-hour-onboarding/README.md` **WP1** (generalise to `openai_compat.py`, `meta.py`, engine-list parity in Rust `daemon.rs` `KNOWN_ENGINES` and TS `lib/engines.ts`) | a gated turn runs end to end on Muse Spark through the real gate; engine parity test holds |
| 2 | **SAM 3.1 client** - image and video, text prompts and box/point prompts, Files API reuse | nothing; new `src/athena/harness/meta/sam.py` | masks and boxes come back typed; a video request respects the 50-frame minimum in the cost estimate |
| 3 | **Voice client** - `muse-voice-transcribe-1.0` file and realtime, with diarization and keyword biasing; **and** the Spark-audio path (`muse-spark-1.2`) for the same file | `channels/voice/` (local Kokoro/Whisper stack) | the same recording transcribes both ways and both land as ledger rows |
| 4 | **Reading** - Spark on crops and pages as the documents-lane reader | `adopt/documents.py`, `harness/vision.py` (Nemotron Super-VL opt-in lane today) | Muse Spark is a reader option beside the existing ones |
| 5 | **Price table and modes** - Standard vs Contributor per call, ledger rows carry the mode; a **Standard-only guard** for personal surfaces | `core/ledger.py`, ADR 0122 (unpriced calls weigh against the cap) | a test proves a Contributor id is refused for any surface carrying a person's data |
| 6 | **Day-1 probe** - the first hour with a key | the Nebius five-way probe pattern (`docs/feedback.md`) | `meta-model-facts.md` gains **measured** rows (endpoint shapes, streaming, SAM schema, Files API path, latency p50/p95 per model) and the vault gets one finding per surprise |
| 7 | **Featured chores in the app** - a `featured` block in `playbook.json` (senses used, proof status, since) and a featured band in the Chores scene | `playbooks/*/playbook.json`, `modules/playbooks/model.ts`, `scenes/chores/`; ADR 0040 (a playbook earns its place on the bench) | a chore shows as featured **only when its spike's proofs passed**; the band renders in the preview harness |
| 8 | **Media worlds** - a rehearsal that consumes recorded media (video, audio, photo folders) with an answer key, the way today's worlds consume `world.json` + `truth.json` | `proving/world.py`, `adopt/showcase.py`, ADR 0055 (evidence media stay local, the index is committed), ADR 0125/0135 (practice-run honesty) | one contract every chore spike fills with its own media; media files stay out of git |
| 9 | **One Gauntlet surface for the senses** - instructions hidden in paper, in a photo, in speech | `proving/gauntlet/`, `core/fence.py` | text read off pixels or audio is fenced as evidence; 0 breaches on a seeded set |
| 10 | **Open-weights fallbacks** - SAM 3.1 weights on partner GPU credits (Modal or Baseten), Muse Glimmer local where a GPU exists | none | a sense degrades to the fallback behind the same client contract, and the ledger says which ran |

## Proofs

| # | Question | Experiment | Pass | If it fails |
|---|---|---|---|---|
| P1 | Does the API speak what the docs say? | the day-1 probe: one call per model id, per endpoint (Responses, Chat Completions), streaming on/off | every model in the facts table answers; each gap is a finding within the hour | build the missing shape behind the client; tell the spikes before noon |
| P2 | Can Muse Spark read documents as well as the reader Athena has? | the existing `proving/docread` corpus (90 paired documents), Muse Spark vs the Claude documents lane (96.2% field accuracy, run `20261022T195808Z`, measured on Claude) | Spark reaches **>= 90% of the Claude lane's field accuracy** | paper-based spikes (01, 02, 05) keep the existing reader and say so |
| P3 | Does the gate hold on Muse? | the Gauntlet on Athena-on-Muse, small preset | 0 breaches; cards filed where expected | no chore spike may ship a gated action on Muse |
| P4 | What does a sense cost and how fast is it? | the probe plus one batch per sense | p50/p95 latency and $ per unit measured, posted as findings | spikes re-plan with real numbers |

## Before the key exists (until 2026-10-26)

Everything except P1-P4 can be built: the clients against Meta's published shapes with a fake
transport (`ScriptedTransport` pattern), the price table, the Standard-only guard, the featured
flag and band, the media-world contract, the Gauntlet surface. Record that the shapes are **press**
until P1 measures them.

## Coordination it owns

Spike 00 is the **only** spike that edits the engine lists, `src/athena/contracts/`, the playbook
schema's `featured` block, and the Chores scene's featured band. It reserves **ADR 0201-0205**. It
lands as early commits so 01-05 build on them in the main tree.

## Launch

```
/spark Featured-chore spike 00 (Meta senses): read docs/concepts/meta-featured-chores/README.md,
know-how.md and 00-meta-senses/README.md; land the shared Meta senses and the featured-chore
contract before the five chore spikes start their model work.
```
