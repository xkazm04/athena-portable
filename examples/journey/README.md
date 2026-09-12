# `@athena/journey` — the four acts, run end to end

The demo of README section 1 ("the demo, four acts, under five minutes"), automated: three real
example applications in a real Chromium, driven through the real bridge, with the real gate
deciding what may run and an approval standing in front of everything it calls `GATED`.

It is not a unit test of the bridge — `packages/athena-bridge/test/` is that. It is the claim the
demo makes, checked: *the apps are the environment, the gate is the policy, and the record says
what happened.*

## Run it

```bash
pnpm --filter @athena/journey test          # the journey; `e2e` is the same thing
pnpm --filter @athena/journey typecheck     # tsc --noEmit, strict
pnpm --filter @athena/journey lint
```

First time only:

```bash
pnpm install
pnpm --filter @athena/journey exec playwright install chromium
```

Headless by default, one worker, no retries, and CI needs nothing but the two commands above.

| Environment variable | Effect |
|---|---|
| `JOURNEY_KEEP_APPS=1` | do not boot anything; drive whatever is already listening on 3001/3002/3004 |
| `JOURNEY_PORT_OFFSET=100` | boot on 3101/3102/3104 instead — for a second journey, or beside a dev server somebody else is running |
| `JOURNEY_CALL_BUDGET=250` | the per-origin ceiling the gate enforces for this window |

A port that is already held is an error, not something the runner quietly adopts: driving a server
nobody asked for means asserting against whatever code that process happens to be running, which
is a green run that proves nothing. The message names both ways out.

Screenshots of each act land in `shots/`, which is gitignored.

## What it boots

The runner starts each app itself — `next dev <app directory> --port N`, spawned as Next's own
JavaScript entry point with this Node rather than through a shell, so the process tree stays
shallow and `taskkill /t /f` on Windows (a process-group signal elsewhere) actually kills it. An orphaned dev server holding port 3001 is the same failure the shell's sidecar module exists
to prevent (README section 3.5).

Freshness comes from the working directory rather than from deleting anything. Each app resolves
its SQLite file as `process.cwd()/data/<app>.sqlite` and seeds it on the first request, so the
server is started as `next dev <app directory>` from a scratch directory of this run's own: the
project is the app, the database is in the scratch, and the journey never seeds over — or
deletes — a database somebody else has open. The scratch goes away on teardown, so the next run
seeds again and act 1's beats about specific credits stay assertable.

## How the page is driven

Exactly the way the desktop shell and the side panel drive it, and no other way:

- `packages/athena-bridge/inject.js` is added with `page.addInitScript`, so it runs in the page's
  main world at document start (`src/relay.ts`);
- the surface's half is a second init script that mints ids, matches replies and owns the outer
  35 s timeout — in a shipped surface that is the content script or the webview preload;
- every `list` and `call` is an `athena-webmcp` postMessage as specified in
  `packages/athena-bridge/protocol.md`.

Nothing reaches `document.modelContext` directly. Going around the bridge would skip the
`event.source` and `event.origin` guards the protocol leans on and would test a path no surface
runs.

Classification is `@athena/bridge/gate` imported into Node — `flagsOf` → `classify` → `decide`,
plus `manifestOf`, `Budget` and `fence`. The gate is a plain ES module with no DOM, so it needs no
shim and no page context; a second copy of the policy would be a second policy (`src/surface.ts`).

## What it asserts

### Act 1 — Ledgerbox (`localhost:3001`)

Exactly `mark_paid`, `send_reminder` and `void_invoice` classify `GATED` and every other tool the
page registers classifies `AUTO`. `read_books` and `read_credits`; every credit that settles exactly
one invoice is matched with `match_bank_line`, and the one credit that could settle either of two —
the Kestrel Labs one, found by its ambiguity rather than by its memo — is left for a person. The
trading name a matched credit came in under is written as a fact citing that call.
`navigate("overdue")` and `read_inbox`, paged to the end; a `draft_reminder` for every invoice more
than 30 days old, firm for the oldest and gentle otherwise, skipping the disputed ones (the app
refuses those, and the refusal is asserted) and the client who has paid most of an invoice and gone
quiet — a decision taken from `paid_ratio`, which the journey then checks lands on Solstice
Partners. Each draft is addressed at the registry contact for its client, and the mail allow-list is
built from exactly those addresses. Two chases approved and sent through the mail connector and
recorded on the page, one declined — then *attempted*, refused `user_denied`, with the strip re-read
to prove nothing moved. `export_summary("2026-08")` filed as a new page under the allowed parent.

### Act 2 — Hirelane (`localhost:3002`)

`decide_stage`, `send_scheduling_email` and `send_rejection` are the gated three. No tool
parameter anywhere in the manifest is named `university`, `school`, `age` or `gender` — asserted
over the whole manifest rather than a list of tools, so a tool added tomorrow cannot smuggle one
in. The applied backend applicants are scored, the borderline band is read, the availability
replies are searched for in the mailbox, slots are proposed, two scheduling mails are approved and
one rejection is declined and attempted. The shortlist is appended to the studio's page.

### Act 3 — TidyCRM (`localhost:3004`)

`merge_contacts`, `delete_contacts` and `undo` are gated. `preview_normalize` over the ids
`search_records` answers with, then `normalize_fields(phone_e164)` on exactly what the preview
named, then the preview again to prove there is nothing left to do. `read_pairs`: the confident
duplicates merged one approval each, the uncertain ones closed with `resolve_pair` rather than a
merge. Then the company-name conflict act 1 already explained — `resolve_company` is called with
the registry's spelling, which is deliberately *not* the app's own consensus, because the majority
spelling on that domain is a misspelling. Finally the campaign `export`, minus the client act 1
went quiet on, held back by domain rather than by spelling, appended to the studio's page.

### Act 4 — the record

One ledger row per call, refusals included, with a reason from `REFUSAL_REASONS` and nothing else.
Both declines are present with `user_denied`, every `GATED` execution names the approval that let
it through, every connector write names an allow-listed target, and the table is printed at the
end with tier 1 (the page) and tier 3 (a connector) side by side.

## One studio, three tabs

The three apps seed from one shared registry (`examples/demo-kit/src/seed/companies.ts`), and the
journey imports it rather than copying it, so the acts are checked against the same constants the
apps were built from. That is what makes this a story rather than three runs:

- act 1 learns that Pinegrove Collective pays as `PINEGROVE COOP` and writes it as a fact citing
  the `match_bank_line` call that taught it;
- act 2 finds Wren Okafor of Kestrel Labs in the borderline band and records the relationship to
  act 1's chase as *context* — the note is written after every scoring call, and the assertion is
  that ordering, because a score that depended on who someone works for is the thing this pipeline
  must not do;
- act 3 resolves the Pinegrove duplicate using act 1's fact and the CRM spelling it implies, and
  holds Solstice Partners' contacts out of the campaign export for the same reason act 1 did not
  chase them;
- act 4 prints the facts with their citations beside the ledger.

The brain is three fields and one rule: a fact that cites no live ledger row is refused at write
(README section 2, invariant 2). No bypass, not even here.

## Why the connectors are fakes

README section 4 is explicit: connectors are built by a separate team in the reference repository
and *this build reserves the seam rather than porting them*. There is no Gmail and no Notion in
this tree — only `src/athena/connectors/port.py`. So the journey models them in process, as
`FakeMail` (`search_mail`, `read_mail`, `send_mail`) and `FakeNotes` (`search`, `read_page`,
`append_to_page`, `create_page`), and keeps every property section 4 fixes:

- a connector presents a manifest of the same shape as a page and its class comes from the same
  `classify` — it cannot argue itself out of `GATED` any more than a page can;
- reads are reads, writes are `GATED` *and* behind an egress allow-list derived from the
  arguments — recipients for mail, page ids for notes — checked **after** the approval is proved,
  because the switch layers on the gate and never replaces it;
- no tool returns, lists, mints or rotates a credential, and the fakes hold none.

The mail allow-list is built from the registry contacts of exactly the clients act 1 chases, which
is why Solstice Partners cannot receive mail even by accident.

## Layout

| File | What it is |
|---|---|
| `src/apps.ts` | the three apps: port, directory, and the tools each act asserts are `GATED` |
| `tests/journey.spec.ts` | one test, four steps — see below |
| `src/boot.ts` | boot, readiness, database freshness, tree kill |
| `src/relay.ts` | `inject.js` at document start and the `athena-webmcp` relay |
| `src/surface.ts` | the surface: the real gate, the manifest, the budget, the fence |
| `src/approvals.ts` | the approvals fake: card → answer → `describe` proves it covers this call |
| `src/connector-surface.ts` | tier 3 at the same gate, plus the egress allow-list |
| `src/connectors/` | the seam, `FakeMail` and `FakeNotes` |
| `src/ledger.ts` | one row per call and the act 4 table |
| `src/brain.ts` | facts, each citing the ledger rows it was learned from |
| `src/contracts.ts` | **every** field the apps answer with, behind one adapter each |

The four acts are four `test.step`s of one test, not four tests: Playwright starts a fresh worker
process after a failed test, which would throw away the ledger, the approval table and the brain —
the three things act 4 exists to read. A step that fails is recorded and the run continues, so one
app moving under the journey still leaves the other acts and the record readable; the collected
failures are asserted at the end.

`src/contracts.ts` is the file to edit when an app changes shape. The tool *names* are the stable
half of the contract with the three app agents; what a tool answers is theirs, so no beat in the
spec reads a field directly and each adapter accepts more than one spelling and throws — rather
than defaulting — when it finds none. A silent `?? 0` is a beat that passes while asserting
nothing.

## Recording a take

`docs/demo.md` section 1 is the plan: narration is made first, the video is paced to it, and
ffmpeg lays one back on the other. Three commands, in order, from this directory.

```bash
# 1. narrate — one ElevenLabs mp3 per beat of script/journey.en.json, durations measured
pnpm narrate                       # needs ELEVENLABS_API_KEY
pnpm narrate -- --dry              # no network: estimated durations only, so the recorder can run
pnpm narrate -- --only 1.3,1.4 --force   # re-cut two beats after a script edit

# 2. record — the journey in recording mode, one beat at a time, held for max(clip, settle)
JOURNEY_VIDEO=1 JOURNEY_SCRIPT=script/journey.en.json pnpm test

# 3. compose — the clips onto the video at the offsets the recorder logged
pnpm compose -- --captions
```

Everything the three write lands in `take/`, which is not committed:

| Path | Written by | What it is |
|---|---|---|
| `take/audio/<beat id>.mp3` | narrate | one clip per beat, e.g. `take/audio/1.3.mp3` |
| `take/audio/durations.json` | narrate | `{ "<beat id>": <ms> }` — what the recorder paces to |
| `take/audio/manifest.json` | narrate | the three voice choices, the model, and per-beat chars and ms |
| `take/take.json` | the recorder | the video path, its size, and each beat's `start_ms`/`end_ms`/`caption` |
| `take/journey.mp4` | compose | the cut: H.264 yuv420p, AAC 48 kHz, faststart |
| `take/journey.srt` | compose | the caption strip, with `--captions` |

**The key.** `narrate.mjs` reads `ELEVENLABS_API_KEY` from the environment, or from a `.env` file
here or at the repository root; both are ignored by git and the key is never printed. Without it
the script exits 2 naming the variable — only `--dry` runs without one. `ELEVENLABS_VOICE_NARRATOR`,
`ELEVENLABS_VOICE_MIRA` and `ELEVENLABS_VOICE_ATHENA` (a voice id or a name) override the three
voices it would otherwise pick from the account library by the hints in the script's `voices`
block; `ELEVENLABS_MODEL` overrides `eleven_multilingual_v2`. Synthesis skips a beat whose mp3 is
already on disk unless `--force`, and refuses to spend more than 20,000 characters without `--yes`.

**Re-takes.** A script edit is `pnpm narrate -- --only <ids> --force`, then the recorder, then
compose: no editing session. `pnpm compose -- --dry` prints the ffmpeg command without running it.
A beat whose mp3 is missing is skipped with a warning rather than failing the cut, and a clip
longer than its beat is trimmed with a 200 ms fade so two clips can never overlap.

Both scripts need `ffmpeg` and `ffprobe` on `PATH` and nothing else: they are plain Node ESM with
no dependencies beyond the runtime.
