# Hackathon plan: what remains until submission

Nebius x NVIDIA Global AI Hackathon, track **Personal AI**. Deadline **2026-10-30 10:00 PDT** (18:00 in
CET, the clock of the git log). Written 2026-10-28 from `docs/submission-checklist.md`,
`.spark/Spark/ideas/hackathon-wrap.md`, `docs/BACKLOG.md`, `.claude/scan-history/backlog-stabilize-2026-10-27.md`
and the state of `main` (793ebbde; origin/main is 1 commit ahead, 7a66ed5c, a test fix).

## Where we are

- Every Devpost requirement except the **video** is marked done in the checklist. The demo URL is decided
  (the repository plus the local commands); no Serverless deployment.
- Desktop launches from a cold start with the README steps (`pnpm dev:ledgerbox`, then `ATHENA_START_URL=http://localhost:3001 pnpm tauri dev`
  in `apps/desktop`, checked 2026-10-28; Ledgerbox answers 200, the daemon and WebView2 come up).
- Take pieces on disk (gitignored `examples/journey/take/`): narration (14 mp3 present), `cards.webm`, `proving.webm`.
  The **desktop segment is not recorded**, and nothing is composed.
- Machine has ffmpeg (`C:\ffmpeg\bin`), root `.env` and `examples/journey/.env`.

## P0: blocks the submission

| # | Item | Owner | Notes |
|---|---|---|---|
| 1 | Record the desktop segment and compose the film (`docs/demo.md` 5.6) | operator | Needs a bundled debug build (`pnpm tauri build --debug --no-bundle`), CDP on 9222, a scratch `ATHENA_STORE`, an engine signed in, the stage set by hand (project "Studio books", Ledgerbox registered, PSLF chore opened once). Then `pnpm narrate`, `record-desktop.mjs --dry`, record, `pnpm film:compose --captions --xfade 300`. The cut must be under 2:59. |
| 2 | Re-check narration against the shipped product | Director | `film.en.json` was written 2026-10-26, before the **Wavefront** skin became the default (786abb45), the seal on the avatar, and the featured band's removal. Any line or beat that names the old look or the band is stale; re-voice with `pnpm narrate --only <id>`. |
| 3 | Video pre-flight (checklist section "Video pre-flight") | operator | Public on YouTube, not unlisted; no third-party marks, no bookmarks bar, no OS notifications; Record's "Model calls" list out of frame; no key or token visible; every on-screen number matches a run id in `docs/submission.md`. |
| 4 | Fill the Devpost form | operator | Video link is the only TBD field; paste `docs/submission.md` and `docs/feedback.md`. Submit with margin, not in the last hour. |

## P1: documents that have drifted since 2026-10-26

| # | Item | Notes |
|---|---|---|
| 5 | `docs/submission.md` counts and story | Last edited 2026-10-27. It still says 1,354 commits since 2026-10-08; `git log --since=2026-10-26` alone is 239 commits. Test counts (pytest 3,837, Vitest 3,060, `node --test` 948, Playwright 17, cargo 167) were taken 2026-10-26: **re-run and refresh once, after the last code change**. |
| 6 | Mention what landed 10-26..10-28 | Wavefront skin, Meta senses and featured chores (ADRs 0226-0231; the band itself was removed), peer pairing hardening, ADR 0233-0235. Decide per item whether the submission claims it; do not claim the featured band. |
| 7 | README | Re-read "Run it locally" against the Wavefront default and the removed band; the checklist says the README gets its numbers from `docs/submission.md`, so fix both together. |
| 8 | `docs/features/README.md` | Frozen at 2026-10-08 per the wrap session; confirm the index covers desktop, playbooks, daemon and proving after the 10-27 sweep. |
| 9 | `CHANGELOG.md` `[Unreleased]` | Long, but it is the honest ledger; leave unless a reviewer link points at it. |
| 10 | Sandboxes beta access | Blocked on the operator's access request (ADR 0033). Say "not used" in the submission instead of leaving the row open. |

## P2: open product items worth a polish day

| # | Item | Source | Why it matters for the demo |
|---|---|---|---|
| 11 | Daemon prints `ConnectionAbortedError [WinError 10053]` tracebacks from `server.py` `_send` (`do_GET`) at startup | seen in `pnpm tauri dev` log, 2026-10-28 | 6e0b9269 fixed the 401/404-before-body case; a GET reply to a client that has gone away still dumps a traceback. It is only noise, but it shows in any terminal on camera. Catch `ConnectionAbortedError` and `BrokenPipeError` in `_send`. |
| 12 | B-C10: owner re-run of the interviewer's anchor-date prompts | BACKLOG, ~$3.80 | Built 2026-10-26, awaiting the owner's run. Skip unless the film shows "Dates that matter". |
| 13 | B-C9: re-film or crop topic stills so none contradicts the tiles | BACKLOG | Matters only if the film uses the PSLF chore page stills (it does: beat C2). Check after the Wavefront skin change. |
| 14 | Lane C owner calls from `stabilize-2026-10-27` | `.claude/scan-history/backlog-stabilize-2026-10-27.md` | The headline says the owner's last calls were built (d2c1dce6); confirm the ledger is closed and the backlog file reflects it. Lane B (48 cards) is drainable with `/scan-sweep --ab-only`; not needed before submission. |
| 15 | First-paint ceiling raised twice (167,200 then 167,350 B) | 8177dcb6, 5f47c567 | Owner-approved; no action, but do not raise a third time before submit. |
| 16 | UI test pass on the surfaces the wrap left "visual check open" | hackathon-wrap Retro: fleet-surfaces, device-vitals, projects-layer, one-athena-fleet | Do it through the real desktop once, on the Wavefront default, before recording. |
| 17 | Perf gate | memory `perf-gate-browser`: `perf:skin` fails on main, needs `ATHENA_BROWSER` (no Edge here) | Known; do not chase before submit. |

## Features that need two PCs or a phone (cannot be shown in the film)

Pairing over Tailscale, write-once memory replication and the phone page are built and tested but need
a second device. The submission already says so; keep them out of the film.

## Artifacts to have before the form is open

- [ ] `take/film.mp4` and `take/film.srt`, under 2:59, uploaded to YouTube (public), link in hand.
- [ ] Final test counts in `docs/submission.md`, with the date.
- [ ] `git push` of `main` (origin must carry everything the submission links to; pull 7a66ed5c first).
- [ ] Repository About: Apache-2.0 visible, topics set (done 2026-10-07; re-verify after push).
- [ ] No `.env`, key or token in the tree: `git ls-files | grep -i env` and a secret scan of the last 250 commits.
- [ ] `proving-runs/` ids cited in the submission still resolve locally (they are gitignored).

## Suggested order, 2026-10-28 to 10-30

1. **Today:** pull origin, fix item 11, visual walk of the desktop on Wavefront (item 16), decide item 6, then
   re-run the test suites once and update item 5. Freeze code after this.
2. **Tomorrow morning:** stage the scratch store, record the desktop segment, `pnpm narrate`, compose, review the cut against the pre-flight.
3. **Tomorrow evening:** upload to YouTube, fill the Devpost form as a draft, push.
4. **10-30 before 18:00 CET:** submit. The hours after are a buffer, not a plan.
