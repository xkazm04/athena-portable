# Submission checklist — Nebius x NVIDIA Global AI Hackathon

Deadline 2026-10-30 10:00 PDT. Track: **Personal AI**. Owner is who closes the row: the operator
(accounts, recording, the Devpost form) or the Director (repository text and runs).

## Requirements

| Requirement | Status | Evidence | Owner |
|---|---|---|---|
| Runtime call to Token Factory, or run on Nebius AI Cloud | done | `nebius` engine (README §10, ADR 0031); every Proving Ground role calls `api.tokenfactory.nebius.com`; ledgers of `20261007T140609Z`, `20261007T144722Z` | — |
| At least one NVIDIA open model | done | Nemotron 3.5 Lightning and Nemotron 3 Super (README §10) | — |
| Working demo or test-build URL | to do | today the trigger page runs locally: `PROVING_JUDGE_TOKEN=<token> uv run python -m athena.proving.server --hosted`. A public URL needs the Serverless deployment (`proving/serverless/README.md`), which needs a Nebius AI Cloud project; else submit the repo plus the local command as the test build | operator |
| Text description of features and functionality | done | `docs/submission.md` | Director |
| Public repository | done | https://github.com/xkazm04/athena-portable | — |
| OSS licence visible in About | done | Apache-2.0 detected from `LICENSE`; About description and topics updated 2026-10-07 | — |
| README with setup and run guidance | done | README **Setup**, including the Proving Ground command table | Director |
| README highlights Nemotron use, where Token Factory accelerated, other Nebius services | done | README §10, §11, §12 | Director |
| Video under 3 minutes, public on YouTube | to do | see the pre-flight list below; demo tooling is WP13 (`docs/demo.md`) | operator |
| Track identified | done | `docs/submission.md` first line; README opening | — |
| Feedback on Token Factory, AI Cloud and NVIDIA tools | done | `docs/feedback.md` (from README §13) | Director |
| Explain updates if the project predates 2026-08-26 | done, not needed | first commit 2026-09-12 (`git log --reverse`); stated in `docs/submission.md` | — |
| Repeat-run stability numbers | to do | `<!-- WP9 -->` slot in `docs/submission.md`; the earlier attempt was killed on low memory and claims nothing | Director |
| Test counts refreshed | to do | `docs/submission.md` names 931 collected Python tests; refresh at submit with `uv run pytest`, `pnpm test`, `cargo test` | Director |
| Sandboxes beta access | blocked | ADR 0033; the access request is the operator's | operator |

## Devpost form fields

| Field | Paste |
|---|---|
| Repository URL | https://github.com/xkazm04/athena-portable |
| Track | Personal AI |
| Description | `docs/submission.md`, whole file (drop the HTML comment if WP9 has not filled it) |
| Feedback | `docs/feedback.md`, whole file |
| Built with | Nebius Token Factory, NVIDIA Nemotron 3.5 Lightning, NVIDIA Nemotron 3 Super, Python, Rust, Tauri, React, TypeScript |
| Video link | TBD |
| Demo / test-build URL | TBD (Serverless URL, or the repository with the local trigger-page command) |

## Video pre-flight

- [ ] Under 3:00 by the upload's own duration. `pnpm film:compose` refuses a cut over 2:59 (docs/demo.md section 5).
- [ ] Public on YouTube, not unlisted; the link opens signed out.
- [ ] Shows the app functioning on its device: the desktop shell with a gated card, and the trigger
      page streaming a live run.
- [ ] Names Nebius Token Factory and NVIDIA Nemotron on screen or in the narration, and says what
      each does (attacker, user, judge, Athena under test).
- [ ] No third-party trademarks: browsed tabs show only the example apps (Ledgerbox, Hirelane,
      TidyCRM), no real-site logos, no browser bookmarks bar, no OS notifications.
- [ ] No copyrighted music. No music unless its licence is checked and noted.
- [ ] ElevenLabs narration: the voice and plan allow commercial and public use; keep the licence
      reference with the source files.
- [ ] Every number on screen matches a run id in `docs/submission.md`.
- [ ] No key, token or project id visible in a terminal, `.env` or the page.
