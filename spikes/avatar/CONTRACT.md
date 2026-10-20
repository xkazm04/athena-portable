# Avatar spike - the contract every track builds against

Owner: the Director (spark `athena-avatar`). Tracks never edit this file; a track that needs a
change writes the request in its report and the Director amends it.

## Where things live

Code: `spikes/avatar/` on branch `worktree-spark-athena-avatar`. Outside the pnpm workspace and the
root uv project - no app gate runs on it, and nothing in `apps/` or `src/` changes during the spike.

Data home: `ATHENA_AVATAR_HOME`, default `~/.athena-avatar/`. Never commit anything from it.

```
~/.athena-avatar/
  models/<name>/                      downloaded weights, one dir per model
  venvs/<track-id>/                   one Python env per track (uv venv)
  portraits/<portrait-id>/portrait.png       operator-supplied (Leonardo); the ONLY art input
  portraits/<portrait-id>/eyes_closed.png    optional, operator- or track-made
  portraits/<portrait-id>/mouth_<viseme>.png optional
  voice/<line-id>.wav                 24 kHz mono PCM16, Kokoro af_heart (WP-L writes)
  voice/<line-id>.timeline.json       Timeline, below (WP-L writes)
  bench/<track-id>/<portrait-id>/<line-id>.mp4   1920x1080 H.264, audio muxed
  bench/<track-id>/<portrait-id>/<line-id>.metrics.json
  gpu.lock, gpu.lock.info             tools/gpulock.py
```

A track's derived art (layer PSDs, rig files, keypoints) goes under
`portraits/<portrait-id>/<track-id>/`.

A track that benches several models keeps each under
`bench/<track-id>/<portrait-id>/<model>/<line-id>.mp4` (+ metrics.json), and copies the clips of the
model it puts forward to the contract path above, so the comparison page reads one clip per track.
In metrics.json, `realtime.vram_mb` is the process's peak reserved memory, not a device-wide figure.

Ids: `line-id` in `calm | question | long` (bench/lines.json). `track-id` in
`t1-rig | t2-neural | t4-hybrid`. `portrait-id` is the folder name the operator chose.

## The GPU rule

The RTX 4090 runs one job at a time. Every command that loads anything onto CUDA runs through
`python spikes/avatar/tools/gpulock.py --label "<track-id>: <what>" -- <command>`, or inside
`with gpu_lock(...)` in Python. Hold it for one job, not for a session. Downloads, installs and CPU
work never take it.

## Timeline (version 1) - `voice/<line-id>.timeline.json`

```json
{
  "version": 1,
  "line_id": "calm",
  "text": "...",
  "sample_rate": 24000,
  "duration_s": 4.82,
  "phonemes": [{"p": "h", "start": 0.12, "end": 0.18}],
  "visemes":  [{"v": "aa", "start": 0.18, "end": 0.27}]
}
```

Times are seconds from the first audio sample. `v` is one of the Oculus 15:
`sil PP FF TH DD kk CH SS nn RR aa E ih oh ou`. Segments are ordered, non-overlapping, and cover
`0..duration_s` (gaps are `sil`).

## RigParams track (version 1) - what drives a 2D rig

```json
{
  "version": 1,
  "fps": 60,
  "frames": [{
    "t": 0.0,
    "head":  {"yaw": 0.0, "pitch": 0.0, "roll": 0.0},
    "eyes":  {"blinkL": 0.0, "blinkR": 0.0, "gazeX": 0.0, "gazeY": 0.0},
    "brow":  {"raise": 0.0},
    "mouth": {"open": 0.0, "visemes": {"aa": 1.0}}
  }]
}
```

`head.*` in degrees (yaw right-positive, pitch down-positive, roll clockwise-positive);
`blink*` 0 open .. 1 closed; `gaze*` and `brow.raise` -1..1; `mouth.open` 0..1; `mouth.visemes`
weights 0..1 over the Oculus 15, summing to at most 1. T1's runtime consumes it; T1's procedural
idle and T4's neural motion both produce it.

## metrics.json - one per bench clip

```json
{
  "track": "t1-rig", "portrait_id": "...", "line_id": "calm",
  "render":   {"width": 1920, "height": 1080, "fps": 30, "seconds_per_clip": 12.4},
  "realtime": {"fps_p50": 60, "fps_p5": 57, "vram_mb": 900, "gpu_util_pct": 18,
               "cpu_pct": 6, "first_frame_ms": 140},
  "licence":  [{"component": "See-through weights", "licence": "unstated", "commercial_ok": null}],
  "notes": "..."
}
```

**Absent values: omit the key** when a figure was not measured or does not apply - never `0`,
never `null`. The one exception is `commercial_ok: null`, allowed only when the licence is
unknown, and `notes` then says so.

## Every track reports

`spikes/avatar/<track-dir>/README.md` (the track owns it): what was tried, in order; what worked;
the dead ends with their error or measurement; the licence table; the one command that reproduces
the bench clips; and the lessons worth keeping (they feed the registry).
