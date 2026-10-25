# 0183. Narration is content-addressed and planned before it spends

Date: 2026-10-25

## Context

`examples/journey/scripts/narrate.mjs` decided which beats to voice by one rule: a beat whose mp3
was not on disk. A script edit kept its beat id and its mp3, so a plain run voiced nothing for
it, and then measured the old clip and wrote the new line's length into the manifest's `chars`.
`src/script.ts` isStale compares exactly those `chars` with the line's length, so the laundered
entry read as fresh and the take held the picture for the old clip under the new line. A
same-length edit or a recast was never caught at all. The README's answer was "a script edit is
`--only <ids> --force`", which asks the operator to remember which ids changed. `--dry` wrote an
estimate over every beat's measured length, clips on disk included. Every synthesis is paid
ElevenLabs characters, and the 20,000-character guard ran only after the voice library request.

## Decision

1. **A clip is named by what decides its audio.** Each manifest beat a real run writes carries
   `sha` = sha256 of (line, role, voice id, voice settings, model), plus `line_sha` and `model`
   so a changed key can say what changed. A beat is reused when its key matches and its mp3 is
   on disk; otherwise it is voiced, with the reason `line`, `voice`, `model`, `settings`, `new`
   or `missing` (`forced` under `--force`).
2. **The plan is one pure module.** `scripts/lib/narration-plan.mjs` (`planNarration`,
   `castFromEnv`, `overBudget`, `dryDurations`, `durationsAfterRun`, `nextManifestBeats`,
   `formatPlan`) reads no file and makes no request. narrate prints the plan before any spend;
   `--plan` prints it and stops, with no key and no network.
3. **The guard runs before any request.** The plan is made first from the environment and the
   manifest (an `ELEVENLABS_VOICE_<ROLE>` naming another voice than the recorded one is a recast);
   over 20,000 characters without `--yes` exits 4 before the library is asked. After the library
   names the real cast, the plan is made again and guarded again.
4. **The manifest never launders.** Only a clip made this run gets a new entry; every other beat
   keeps the entry of the line its clip was read from (its `ms` refreshed). A beat due for
   re-voicing whose synthesis failed loses its `durations.json` length, so the recorder estimates
   it rather than pacing to a clip of another line.
5. **Upgrading costs nothing.** An entry written before `sha` is reused while its chars equal the
   line's length and its voice and model match, and is listed as `legacy` in the plan.
6. **A rehearsal never overwrites the truth.** `--dry` estimates only the beats with no current
   clip and leaves a real run's manifest untouched.

## Consequences

- A re-take after a script edit or a recast is a plain `pnpm narrate`; `--only` still narrows a
  run and names the changed beats it left out (`staleOutOfScope`).
- `src/script.ts` needs no change: the `chars` it reads are again the chars of the clip's line.
  It still cannot see a same-length edit by itself; narrate re-voices one, and a failed one loses
  its measured length per decision 4.
- A manifest with `sha` stays readable by older code, which ignores unknown fields.
- `pnpm test:unit` covers the plan offline, and runs `narrate.mjs` itself for `--dry` and the
  guard with fetch replaced by a tripwire and every file in a temp directory
  (`JOURNEY_AUDIO_DIR`). A real synthesis run against ElevenLabs has not been made with this code.
