# Meta Model API - facts at the start of the spikes

Snapshot of 2026-10-24, read from Meta's own pages (`dev.meta.ai/docs/models`,
`dev.meta.ai/docs/pricing-rate-limits`) before any spike started. Every row is **press** (Meta
published it); nothing here is **measured** yet, because nobody on the team has a key. This file is
the seed. Live findings go to the shared know-how vault (see [know-how.md](know-how.md)), and a row
here is superseded by a measured finding, never edited to match one.

## Hosted models

| Model id | In -> out | Context | What matters for a chore | Notes |
|---|---|---|---|---|
| `muse-spark-1.3` | text, image, video, audio, PDF -> text | 1,048,576 | tool calling, structured output, search grounding; reasoning levels up to `"max"` | recommended for new work; **audio "not fully supported"** |
| `muse-spark-1.2` | same | 1,048,576 | previous version | the page recommends it **for audio input** |
| `muse-spark-1.1` | same | 1,048,576 | original | Standard mode only |
| `muse-spark-1.3-contributor`, `-1.2-contributor` | same | 1,048,576 | no `"max"` reasoning | **Contributor mode trains on your content: never with a person's data** |
| `muse-wonder-1.0` | text, image, video, audio, PDF -> text | 1,048,576 | long-horizon agents, **computer use**, tool calling, structured output; effort `"minimal"`..`"max"` | preview, Standard only; not in South Korea |
| `muse-image-1.0` | text, image -> image | - | generation and editing; can search the web and run code before rendering | `/v1/images/generations`, `/v1/images/edits`, Responses |
| `muse-voice-transcribe-1.0` | audio -> transcript | - | streaming speaker diarization, endpointing/VAD, keyword and contextual biasing, 25 languages with code-switching, **turn-level timestamps (no word-level)** | realtime `wss://api.meta.ai/v1/asr/realtime`; file `POST /v1/asr/transcribe` |
| `sam-3.1` | text prompt, image or video (+ boxes/points) -> boxes and masks | - | segments **all** matches of a noun phrase; tracks objects across video frames | Responses `POST /v1/responses`; Files API for reusing uploaded clips |

Open weights, self-hosted, not on the API: **Muse Glimmer** (text, image -> text; distilled from
Spark; vLLM, SGLang, llama.cpp, ExecuTorch) and **Muse Spark Open** (816B MoE, 42B active). Round-1
reports cite Glimmer as ~30B, Apache 2.0, one consumer GPU at 4-bit; that is press quoted second-hand,
unverified here.

## Endpoint shape

- Base URL `https://api.meta.ai/v1`; Meta's examples use the **OpenAI SDK** with that base URL.
  Endpoints listed per model: Responses, Chat Completions, Messages.
- `GET /v1/models` lists hosted models only.
- Not stated by Meta: whether chat streams, the Files API upload path, the SAM request/response schema.
  **These are the first things to measure** (spike 00).

## Prices (Standard / Contributor)

| Model | Input / 1M | Cached input / 1M | Output / 1M | Other |
|---|---|---|---|---|
| Muse Spark 1.1-1.3 | $1.25 | $0.15 | $4.25 | Contributor $0.10 / $0.002 / $0.20 |
| Muse Wonder 1.0 | $4.00 | $0.20 | $20.00 | Standard only |
| Muse Image 1.0 | - | - | - | $0.01 per image; failed or filtered images not billed |
| Voice Transcribe 1.0 | - | - | - | $0.18 per audio hour, whole seconds; zero-retention at parity |
| SAM 3.1 | - | - | - | $2.50 per 1,000 images; $0.20 per 1,000 video frames, **minimum 50 frames per video request** |
| Web search grounding | - | - | - | $2.50 per 1,000 queries |

## Rate limits (per team, not per key)

Spark 1.1-1.3 and Wonder: 3,000 req/min, 4M tok/min. Contributor: 150 req/min, 3M tok/min. SAM 3.1:
3,000 req/min. Image: 150 req/min. Voice Transcribe: 256 concurrent streams, 16,000 streams/hour
(realtime and file combined). Background responses: 600 submissions/min.

## Data use

- **Standard:** your content is not used to train Meta models. Retention period not stated.
- **Contributor:** you grant Meta permission to train on prompts, files, context and responses.
- Rule for every spike: personal data (a person's mail, calls, photos, home) goes only to Standard
  models, and the ledger row records the mode. A test proves Contributor ids are refused for those
  surfaces.

## Hackathon facts that bound the spikes

- Build window 2026-10-26 12:00 ET to 2026-11-04 21:00 ET; each accepted participant gets **$150 of
  Meta Model API credits for a 10-day window**. Partner credits for open weights: Baseten $100,
  Modal $100, Fireworks $25.
- Judging: Impact 30%, Use of Meta AI tooling 25%, Technical depth 20%, Demo 25%.
- The event page names Muse Spark, Muse Wonder, Muse Image, SAM 3.1, Muse Code and open weights; the
  Official Rules name Muse Spark, Glimmer and SAM 3. **Voice Transcribe is on neither list** - a
  chore that leans on it must also work on Spark audio input.
