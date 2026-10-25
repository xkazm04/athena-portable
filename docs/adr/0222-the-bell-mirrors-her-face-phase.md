# 0222. The Bell mirrors her face phase, so the default halo shows her speaking

Date: 2026-10-25

Amends the premise of `bell/pose.ts` (ADR 0026, 0087: Main sees only `athena:status`) and builds on
ADR 0120 (Athena has a face). README section 3.1. First-paint ceiling raise owner-approved in triage
2026-10-25.

## Context

Her window mirrors her face to Main on `athena:face`, up to 30 frames a second while she listens or
speaks and once per phase change otherwise (`lib/face.ts`); every face avatar speaks from it. The
Bell, which the default avatar (halo) draws on the dock and the surface, read `athena:status` alone,
and `pose.ts` said speaking could not be a pose because "the mirror does not say her voice is
playing". It does, so with the default look a person heard her talking while both Bells showed her
resting or working: the face, the halo and the Bell told three stories about one voice.

## Decision

1. **A fifth pose, `speaking`**, backed by the mirrored phase. `PoseInput` gains an optional
   `voice: FacePhase | null`. Order: a waiting card (asking), then hearing (the held key or mirrored
   `listening`), then speaking, then work, then rest. Card-first stays: whether the halo's order (her
   voice first) should reach the Bell is left open.
2. **`bell/voice-phase.ts` reduces the stream to its phase.** `createVoicePhase` tells its listener
   of a change only, never per frame, so neither the console nor the surface re-renders at 30 Hz.
   A streamed phase (listening, speaking) lapses to `null` after `STALE_MS` (1500 ms) without a
   frame, because the producer sends no rest frame when her window dies or reloads.
3. **First-frame code, without `lib/face`.** Both Bells read the phase, so the hook is in the first
   frame. It listens on `athena:face` through `lib/ipc` and reads the phase only; `FACE_EVENT` is
   spelled a second time and a test pins it to `lib/face`'s. A lazy `import()` was measured larger
   (+432 B: the build splits the preload helper into its own chunk for any new dynamic entry).
4. **The first-paint ceiling rises by the measured overshoot**, 165,412 B to 165,426 B
   (owner-approved in triage 2026-10-25). The tree measured 165,247 B before and 165,426 B after.
5. The speaking pose draws on the existing variables (the house glow `--accent`, a 1.4 s pulse,
   ripples on), no new keyframes, compositor only, off under Calm; `POSE_SPEED.speaking` is 1.8.

## Consequences

- With the default halo, the dock and the surface Bells show her speaking while her voice plays;
  the dock says "speaking" and the surface headline "Athena is speaking".
- A malformed phase moves no pose: only `listening` and `speaking` change one.
- The producer drops a mirrored frame identical to the last one, so a silence of more than 1.5 s
  inside one spoken line lets the phase lapse to `null` until the next frame; the Bell steps back
  to its status pose for that stretch.
- Rollback is the commit's revert: no stored data or contract changes.
