# 0055. Playbook evidence: the media stay local, the index is committed

Date: 2026-10-09

Follows [0040](0040-a-playbook-is-data-and-earns-its-place-on-the-bench.md) and
[0053](0053-a-layer-opens-on-an-abstract.md). README section 14. Records the operator's decision of
2026-10-09, which was made in conversation, as a parallel run is implementing it.

## Context

A playbook proves itself in `bench.json`: the score read from cards, the trap ledger, and the
turn-by-turn trace that the desktop's layer plays back (ADR 0040, README §14). That proof can only
be read inside the app. A judge, or anyone who has not built the desktop, needs to see it without
running anything: the promise, the run, and what she filed.

Three operator rules from 2026-10-09 bound how that is done. Bench and model runs go only through
the `claude` CLI on the subscription, with no paid API and no ElevenLabs. Narration uses only
local TTS (Kokoro or Piper) and ffmpeg. Evidence media live in a gitignored `evidence/` folder,
and only a per-playbook index and a thumbnail under 100 KB are committed.

Two things already exist to build on. The module preview harness (`apps/desktop/preview.html`,
README §3.5) renders any module and fixture in a plain browser, with no Tauri. Athena's local voice
(`athena.channels.voice.kokoro`, ADR 0028) speaks `af_heart` through sherpa-onnx.

## Decision

1. **Every benched playbook gets a recording.** A playbook is benched when its `bench.json`
   exists. Playwright records `preview.html?module=playbooks` opened on that playbook, through
   three of its views: the abstract, the run replay (the `run` part) and the result (the `result`
   part) (ADR 0053).
2. **The narration is a template, not a composition.** Its text is filled from `playbook.json`
   and `bench.json` fields. No model writes or edits any of it, so every sentence it speaks can be
   traced to a committed field.
3. **The voice is local.** Kokoro speaks the narration through `athena.channels.voice.kokoro`
   with the voice `af_heart`. Piper is the fallback when Kokoro is not installed. ffmpeg muxes
   the narration and the recording into one video.
4. **The media stay local.** The video, the audio and every intermediate file live in
   `evidence/<id>/`, which is gitignored.
5. **The index is committed.** For each playbook the following are committed:
   - `playbooks/<id>/thumb.jpg`, under 100 KB.
   - `playbooks/<id>/evidence.json`, schema 1:

   ```json
   {
     "schema": 1,
     "playbook": "<id>",
     "captured_at": "<UTC ISO 8601>",
     "bench_run_at": "<bench.json run_at the recording shows>",
     "narration": {"text": "...", "engine": "kokoro | piper", "voice": "af_heart",
                   "duration_s": 0.0, "sha256": "..."},
     "video": {"path": "evidence/<id>/...", "duration_s": 0.0, "bytes": 0, "sha256": "..."},
     "thumbnail": {"path": "playbooks/<id>/thumb.jpg", "bytes": 0, "sha256": "..."}
   }
   ```

   Paths are repo-relative, as AGENTS.md requires of every committed file.
6. **Evidence is stale when `bench_run_at` differs from `bench.json`'s `run_at`.** A stale index
   says which run it shows. It is never presented as the latest run.
7. **One command produces it:** `python -m athena.proving.playbooks evidence <id>|--all`.

## Consequences

- A clone of the repo shows that each playbook has evidence, which run the evidence shows, and
  what the narration says, word for word, without holding the media. Anyone who has the media can
  check them against the committed hashes. Anyone who has not can run the command again.
- The repo still grows. A thumbnail of up to 100 KB per playbook is up to 10 MB at a hundred
  playbooks, and every re-recording adds a new blob to history. That is far less than committing
  the video, but it is not nothing.
- **Flaw: staleness misses a rescore.** `write_bench` keeps `run_at` when a run is rescored and
  only adds `rescored_at` (`proving/playbooks/bench.py`). So a rescore can change the verdict and
  the money a narration speaks while the evidence still reads as current. Rule 6 also misses an
  edit to the `playbook.json` fields the template reads. The committed `narration.text` makes both
  cases detectable, because filling the template again and comparing exposes a drift. The rule
  as decided does not check for that. This is raised as a question, not changed here.
- **Ambiguity: what `narration.sha256` hashes.** The decision names the field but not whether it
  hashes the text or the spoken audio. The `text` is already in the index, so a hash of the audio
  says more. The implementing run settles which, and its docstring says so.
- **Gap: the preview cannot name a playbook.** `preview.html` takes `module`, `fixture` and
  `theme`. The only fixtures that open a shipped playbook (`shipped-open`, `shipped-proof`) open
  `PLAYBOOKS[0]` (`modules/playbooks/fixtures.ts`). Recording "that playbook" therefore means
  either clicking its tile in `fixture=shipped` or adding a parameter to the preview. Either is the
  implementing run's work, outside `docs/adr/`.
- The recording needs the desktop's Vite dev server serving `preview.html`. That is a dependency
  of the `evidence` command and of nothing else.
- **Gap: there is no Piper backend.** Nothing under `src/athena` names Piper; Kokoro is the only
  local engine wired in. The fallback has to be added or found on the PATH, and
  `narration.engine` records which engine spoke.
- **Gap: `evidence/` is not yet ignored.** `.gitignore` already ignores `*.mp4`, `*.webm` and
  `proving-runs/`, but has no `evidence/` entry. The implementing run adds it, so that the WAVs
  and frame grabs cannot be committed.
- The README's *License and credits* still says that ElevenLabs narrates the demo video. This
  decision rules ElevenLabs out for playbook evidence. That line needs a docs change, which is
  outside this run.
- The desktop bundles only `playbook.json` and `bench.json` (`lib/playbooks.ts`). `evidence.json`
  and `thumb.jpg` are not in the app until something reads them, and this decision does not ask
  for that.

## Alternatives that lost

- **ElevenLabs or any network TTS.** Ruled out by the operator's boundary: no paid API, and no
  narration that leaves the machine.
- **Committing the media.** Videos per playbook, re-recorded after every bench, would make the
  repo heavy for every clone, and the history would never lose that weight.
- **A screen grab of the Tauri shell.** `preview.html` needs no Tauri, and Playwright records it
  directly, with a fixed viewport and theme and no window manager in the frame.
- **Model-written narration.** It would make claims that nothing checks. A template over committed
  fields can only say what the record says.
