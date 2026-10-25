# 0181. The film's schedule is one pure plan, and no two narration clips overlap

Date: 2026-10-25

## Context

`examples/journey/scripts/compose.mjs` laid narration clips twice, once inline in take mode and
again in film mode, each mixed into the ffprobe and filtergraph code, and the two copies had
diverged. Film mode gave a clip the room `min(beat end, total) - beat start`, but a crossfade
starts the next piece `xfade` ms before the previous one ends, so the last clip of an act could
run up to `xfade` ms under the next act's first clip. Take mode warned that a beat starting
before the previous one ended "will be trimmed" and then kept both clips whole. The desktop
recorder restated `src/script.ts`'s hold rule without its stale-clip check, so after a script
edit it paced a beat to a clip the web recorder refuses, and `placeholders.mjs` carried a third
copy of the caption rule. None of the scripts had a test: `pnpm test` is the Playwright e2e.

## Decision

1. **One derivation.** `scripts/lib/timeline.mjs` is the only code that decides where a beat, a
   clip, a speed-up label or a caption lands: `planTake`, `planFilm`, `layClips`, `holdOf`,
   `captionOf`, `ffmpegArgs(plan)` and `placeholderTakes`. It reads no file and spawns no process.
   `compose.mjs`, `record-desktop.mjs` and `placeholders.mjs` read files, probe lengths, call it,
   and run or print what it returns. Flags and output are unchanged.
2. **One clip-laying rule.** `layClips` keeps a clip to the earliest of its beat's end, the next
   voiced beat's start and the end of the picture, trimmed with the existing 200 ms fade. Take and
   film mode both call it, so a crossfaded seam or an overlapping beat cannot put two voices on
   top of each other.
3. **The hold rule has one meaning.** `holdOf(beat, script, durations, manifest)` drops a
   measured length whose manifest chars no longer match the line, as `src/script.ts` does, and a
   parity test imports the .ts and compares hold and caption for every beat of both scripts.
4. **A refusal builds nothing.** A plan over the limit without `--allow-long` carries `refused`,
   lays no clips, and `ffmpegArgs` throws on it.

## Consequences

- `pnpm test:unit` (node --test, no ffmpeg, no take, no server) covers the seams, the speed-up
  maths, the refusal and parity, and pins the film's ffmpeg argv for the placeholder fixture to a
  snapshot taken before the refactor, so a change to compose is reviewed as a diff of a plan.
- A cut whose beats never overlap and that has no crossfade produces the same argv as before; a
  crossfaded cut whose seam clip filled its beat now fades that clip out at the next act's start.
- The rule is restated once in .mjs because the scripts are plain Node with no build step; the
  parity test, not a comment, keeps it equal to `src/script.ts`.
- CI does not run `test:unit` yet (the workflow excludes `@athena/journey` because its `test` is
  the e2e); wiring it in is a separate change to `.github/workflows/ci.yml`.
