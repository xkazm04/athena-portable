# The demo recording: plan, script and timings

README section 1 gives the demo four acts under five minutes. This document is the production
plan for recording it: how the take is made, the narration script in English with the on-screen
action beside every line, the timings, and what is still needed. ADR 0017 and ADR 0018 describe
the apps it runs on.

## 1. How the take is made

**Audio first, video paced to the audio.** Narration is generated before anything is recorded,
each line as its own clip. The recorder then plays the journey beat by beat: it starts a beat's
clip, performs the beat's actions on the page, and waits for the longer of the clip and the
page's settle time before moving on. The video is therefore never faster than the voice, and a
re-take after a script change is one command, not an editing session.

```
script (docs/demo.md, mirrored in examples/journey/script/journey.en.json)
   │
   ├─ 1. narrate   ElevenLabs text-to-speech, one mp3 per beat, durations measured
   │              (examples/journey/scripts/narrate.mjs; needs ELEVENLABS_API_KEY)
   │
   ├─ 2. record    the journey in recording mode: one beat at a time, each beat held for
   │              max(clip duration, page settle), video captured by Playwright
   │              (JOURNEY_SCRIPT=script/journey.en.json
   │               pnpm exec playwright test tests/take.spec.ts)
   │
   └─ 3. compose   ffmpeg lays the clips on the video at the beat offsets the recorder logged,
                  adds the caption strip, exports mp4
                  (examples/journey/scripts/compose.mjs)
```

**Voices.** Three, so the audience never has to work out who is speaking.

| Voice | Role | ElevenLabs setting |
|---|---|---|
| Narrator | explains what the audience is seeing, third person, calm | a neutral English voice, stability high |
| Mira | the studio owner giving the commands, first person | a second voice, conversational |
| Athena | the agent's replies and questions, short sentences | a third voice, slightly slower |

Mira's lines are also typed into the command field on screen as her clip plays, so the text
input and the voice tell the same story. Athena's lines appear in the surface strip as they are
spoken.

**The surface on screen.** The take records Chromium driving the three apps through the real
bridge and the real gate, with a thin surface strip along the top of the page: the command as it
is typed, the tool Athena is calling, and the decision card when a gated call waits. The strip is
the surface's own UI, the same role the desktop panel plays; it is not part of any app. When the
desktop shell is ready to be driven, the same script runs there and the strip is simply not
injected.

**What is real and what is not.** The apps, the bridge, the gate, the approvals and the ledger
are real. Athena's reasoning in this take is scripted: the lines are written, and the tool calls
are the ones a real turn produces. Mail and notes go through connector fakes with the egress
allow-lists README section 4 describes, because the real connectors live in the reference
repository. The script is written so that swapping in a real engine changes the words Athena
says, not the beats.

## 2. The script

Timings are estimates: narration at 2.5 words per second, plus the page's settle time for the
beat's action, plus a one-second breath between beats. "Settle" is the longest animation the
action triggers (Tidycrm's zoom is 2.9 s; a dossier or card opens in about 1 s).

### Act 0. Three tabs, one studio — about 40 s

| # | On screen | Voice | Line | s |
|---|---|---|---|---|
| 0.1 | Ledgerbox at the books, the presence line grey | Narrator | Halden Studio is two people and fifteen clients. Their books, their hiring pipeline and their contact list are three web apps, and none of them has an agent. | 12 |
| 0.2 | The bridge attaches; the presence line turns on: "Athena is connected. 23 capabilities offered, 3 gated" | Narrator | Athena arrives beside the page. Each app tells her what it can do, and says which of those actions reach a person or cannot be undone. Those are gated. She never decides that herself. | 14 |
| 0.3 | Quick cut to Hirelane and Tidycrm, each presence line lighting up | Narrator | The same happens on the other two tabs. Sixteen capabilities here, twenty-two there. Nothing runs yet. | 8 |

### Act 1. The books — about 95 s

| # | On screen | Voice | Line | s |
|---|---|---|---|---|
| 1.1 | Command field; the text types as Mira speaks | Mira | Reconcile August and chase anything over thirty days. | 5 |
| 1.2 | `read_books`, `read_credits` in the strip; the unmatched chip lights | Athena | Nineteen credits on the statement are unapplied. Fourteen fit exactly one invoice. I'll match those first. | 8 |
| 1.3 | `open_group("retainer")`, `open_item(inv)`, `match_bank_line`: the card's lead figure flips to settled | Narrator | Each match is reversible, so it runs on its own. She opens the invoice, applies the credit, and the card shows what changed. | 10 |
| 1.4 | Two more matches on camera, one line in the strip: "and 11 more" | Athena | Fourteen matched. | 3 |
| 1.5 | `read_credits(only: ambiguous)`; the Kestrel credit with two candidate invoices | Athena | One credit from Kestrel Labs fits two identical retainers. I can't tell which. I'll leave it for you. | 8 |
| 1.6 | `open_item(inv_0930)`, match; the strip shows "counterparty: PINEGROVE COOP"; a fact card: "Pinegrove Collective pays as PINEGROVE COOP" | Athena | This one arrived as Pinegrove Coop. That's Pinegrove Collective's bank name. I'll remember that. | 9 |
| 1.7 | `navigate("overdue")`: the Late chip presses, the sheet dims to 44 | Athena | Forty-four invoices are past due. Twenty-nine are over thirty days. | 6 |
| 1.8 | `open_item(inv_0057)` (LB-2026-0057, Halcyon Works, 57 days past due), `draft_reminder(inv_0057, firm)`: the draft block appears on the card | Narrator | A draft is a whole message, addressed to the client's billing contact. Writing it is reversible. Sending it is not. | 9 |
| 1.9 | `send_reminder`: the strip shows a decision card, the page's own gate arms with the recipient | Athena | Ready to send to Nils Eriksen at Halcyon Works. Shall I? | 5 |
| 1.10 | Mira approves; the card resolves; "Reminders sent 1" in the aside | Mira | Yes. | 3 |
| 1.11 | Second draft, gentle, on `inv_0105` (LB-2026-0105, Verdant Supply, part paid, 49 days); second card; approved | Athena | Verdant Supply, forty-nine days, gentle tone. | 5 |
| 1.12 | Solstice card: `paid_ratio 0.8` visible in the strip | Athena | Solstice Partners paid eighty percent of theirs in August and went quiet. I'd hold off. | 8 |
| 1.13 | Mira declines the Solstice card; the ledger row reads user_denied | Mira | Agreed, skip them. | 3 |
| 1.14 | `export_summary("2026-08")`; the notes connector card: "create page: August 2026 close" | Athena | August is closed. I'll file the summary in your notes. | 6 |
| 1.15 | Approved; the page appears in the fake notes list | Narrator | The close is a page in her notes, written through a connector that sits behind the same gate as everything else. | 8 |

### Act 2. The pipeline — about 80 s

| # | On screen | Voice | Line | s |
|---|---|---|---|---|
| 2.1 | Hirelane; the command types | Mira | Screen this week's backend applicants, and book the ones worth talking to. | 6 |
| 2.2 | `set_filter(arguable)`, `open_group("screening::role_backend")`: the carousel opens | Athena | Eleven applied. Six are borderline: the rubric can't decide them on its own. | 7 |
| 2.3 | `open_item` on the first; `score_against_rubric`; the criterion bars fill with the quoted sentence | Narrator | Every score points at the sentence that earned it. The rubric has five criteria and no column for age, school or nationality, because there is none in the data. | 12 |
| 2.4 | `open_item(app1_012)`: Wren Okafor's dossier; the strip shows "employer: Kestrel Labs" and cites act 1 | Athena | Wren Okafor works at Kestrel Labs, the client whose credit I left unmatched this morning. Context only. It changes nothing about the score. | 10 |
| 2.5 | `search_mail` in the strip: three availability replies from the fake inbox | Athena | Three of them have already sent availability. | 4 |
| 2.6 | `propose_slots` on two dossiers: slots appear held | Athena | I've held slots with the two interviewers who are free Thursday. | 6 |
| 2.7 | `send_scheduling_email`: decision card, the dossier gate arms | Athena | Two invitations to send. From your inbox, signed by you. | 5 |
| 2.8 | Mira approves both; two messages recorded | Mira | Send them. | 3 |
| 2.9 | `send_rejection` card for one applicant, template "encouraging" | Athena | One rejection, encouraging wording. | 4 |
| 2.10 | Mira declines; user_denied | Mira | Not yet. I want to read that one myself. | 4 |
| 2.11 | `read_shortlist`; the notes card "append: Backend Engineer shortlist"; approved | Narrator | The shortlist, with each quoted sentence, goes onto the hiring page in her notes. | 7 |

### Act 3. The contact list — about 70 s

| # | On screen | Voice | Line | s |
|---|---|---|---|---|
| 3.1 | Tidycrm; the command types | Mira | Before the campaign, clean the list and fix the phone numbers. | 5 |
| 3.2 | `preview_normalize` then `normalize_fields(phone_e164)`: one summary toast | Athena | One hundred and twenty numbers weren't in international format. Fixed, and every change is in the revisions log. | 9 |
| 3.3 | `open_group("A")`: the cube flattens (2.9 s) | Narrator | The list is read at three depths. A zone, then a block, one company per block. | 7 |
| 3.4 | `open_item` on the Pinegrove block; the dossier shows three spellings | Athena | Pinegrove is spelled three ways here, including Pinegrove Coop. | 5 |
| 3.5 | `preview_company`, `resolve_company`: the spellings collapse; the strip cites act 1's fact | Athena | That's the bank name I learned this morning. Resolved to Pinegrove Collective. | 6 |
| 3.6 | `read_pairs`: 43 confident, 17 uncertain | Athena | Sixty near-duplicates. Forty-three the rules agree on. Seventeen I'd leave to you. | 8 |
| 3.7 | Two merges on camera through the block's gate; then "and 41 more" | Narrator | A merge destroys a record, so each one is a gate. Two on screen, the rest approved as a batch. | 9 |
| 3.8 | `export(clients)`: the companies list; Solstice highlighted and left out | Athena | The campaign list is two hundred fifty-four contacts at your fifteen clients. I've left Solstice out, for the same reason as this morning. | 10 |
| 3.9 | Notes card: append to the close page; approved | Mira | Good. | 2 |

### Act 4. The record — about 35 s

| # | On screen | Voice | Line | s |
|---|---|---|---|---|
| 4.1 | The ledger table: 140-odd rows, by app and tier | Narrator | Everything she did is one table. Every call, its app, whether it was gated, and what the answer was. | 9 |
| 4.2 | The two declines highlighted: user_denied | Narrator | Two declines. Both recorded as the user's decision, not as errors. | 6 |
| 4.3 | The three facts with the rows they cite | Narrator | And three things she now knows, each pointing at the moment she learned it. One of them she used twice today. | 9 |
| 4.4 | Title card: Athena | Narrator | Athena. Your agent, in the apps you already have. | 5 |

**Total: about 5 minutes 20 seconds.** Cutting act 3 to beats 3.1, 3.4, 3.5 and 3.8 brings it
under five minutes.

## 3. Time to produce

| Step | Time | Notes |
|---|---|---|
| Script sign-off | your reading | this document |
| Narration | 1 h | narrate.mjs: 42 clips, three voices, durations logged; re-runs are cheap |
| Surface strip and recording mode | 3 to 4 h | the strip overlay, beat pacing from the script, the offsets log; per-beat caption text is the script's "on screen" column |
| Page-side proposal state | 2 h across three apps | so a gated call arms the app's own gate with Athena's question (today gates arm only on a click) |
| Compose | 1 h | compose.mjs: mux, captions, mp4 |
| Rehearsals | 1 h | ten runs; each is one command and about six minutes |

About one working day to a finished take, given the key.

## 4. What is needed

- **`ELEVENLABS_API_KEY`** in the environment, and three voice ids (or let narrate.mjs pick from
  the account's library by name). The key is never written to the repository; narrate.mjs reads
  it from the environment and refuses to run without it.
- The three apps on ports 3001, 3002 and 3004, booted by the recorder itself.
- Nothing from the desktop shell. When it is ready to be driven, the same script runs there.

## 5. The Proving Ground film

A second film, under three minutes, for the Nebius x NVIDIA submission: the gate on the desktop,
the Proving Ground attacking it live, and the measured proofs. The script is
`examples/journey/script/proving.en.json`, **a draft**: its lines and its on-screen claims are for
the operator's review, and nothing has been narrated or shot for it yet. It names "NVIDIA
Nemotron" and "Nebius Token Factory" in words and no other product.

### 5.1 The script and its clock

Fifteen beats in five acts, 1,526 characters of narration. At fifteen characters a second (the
rate the first forty-two ElevenLabs clips measured) that is **1:42 of voice and 1:49 held on
screen** with settles and half-second breaths, before any live wait.

| Act | Segment | Beats | What it shows |
|---|---|---|---|
| open | card | T1 | Title: Athena, personal AI, in the apps you already have |
| gate | desktop | D1–D3 | Mira's command typed into Athena's window, the decision card for `send_reminder`, Approve |
| claim | card | K1 | "Can she be talked past her own gate?" |
| proving | proving | P1–P5 | The hosted trigger page: token, Gauntlet, Small, Start; the live feed; 0 breached; the cost |
| results | card | R1–R5 | 93 hostile turns and 0 breaches; persona fidelity 0.97; an approval is spent once; the model ladder on Nebius Token Factory; close |

The live waits are what the script cannot know: the desktop engine's turn before the card arrives,
and the Gauntlet's calls. Both are logged by their recorders and played at 4x under a "sped up 4x"
label. The rehearsal below measured the small hosted Gauntlet at 12 s of wall clock (6 calls,
$0.0016 of Nemotron), so on the day it finishes inside P2's hold and nothing needs speeding up; an
engine turn of 20 to 60 s adds 5 to 15 s. The expected cut is **about 1:55 to 2:05**, and compose
refuses anything over 2:59.

### 5.2 One recorder per segment

An act's `segment` says where its picture comes from; an act without one is `web`, so the two
journey cuts are unchanged. Every recorder writes a video and a segment take beside it in
`examples/journey/take/` (gitignored): the beats' `start_ms`/`end_ms` on that video's clock, and
`speedups`, the waiting stretches.

| Segment | Recorder | Writes | Paced on |
|---|---|---|---|
| `card` | `tests/cards.take.spec.ts`: every card beat set on one page from `src/card-page.ts`, the `record-page.ts` idiom | `cards.webm`, `cards.take.json` | the narration only |
| `proving` | `tests/proving.take.spec.ts`: boots `python -m athena.proving.server --hosted` on a free port with a judge token minted for the take (`src/proving.ts`), types the token (a password field), picks Gauntlet and Small, presses Start | `proving.webm`, `proving.take.json` (and the run itself under `take/proving-runs/`) | the page's own event feed: `first_call` waits for the first call line, `end` for the end line |
| `desktop` | `scripts/record-desktop.mjs`: attaches to the running shell over CDP, captures the screen rectangle of the app's windows with ffmpeg (`ddagrab`, falling back to `gdigrab`; rectangles from `scripts/window-rect.ps1`) | `desktop.mp4`, `desktop.take.json` | Athena's window: `card` waits for a decision card, `wait-decided` for its stamp |
| `web` | `tests/take.spec.ts`, as in section 1 (only its `web` acts) | `journey.webm`, `take.json` | the narration |

`scripts/compose.mjs --film` cuts each act out of its segment's video from its first beat's start
to its last beat's end, plays the logged waits faster, concatenates the acts in script order
(optionally crossfaded), lays each beat's clip at its place on the joined timeline, burns the
captions and the speed-up label, and checks the length against the script's `max_ms` (2:59).

### 5.3 Commands

From `examples/journey/`, with `JOURNEY_SCRIPT=script/proving.en.json` set for every step:

```bash
# 0. rehearse without spending anything
pnpm narrate -- --dry                  # durations at 15 chars/s; prints the characters it would spend
pnpm film:placeholders                 # colour clips, tones and segment takes in take/placeholder/
pnpm film:compose -- --takes take/placeholder --captions --xfade 300   # a real mp4, end to end
node scripts/record-desktop.mjs --dry  # the beats, the grabbers this ffmpeg has, the capture command

# 1. narrate (ElevenLabs; about 1,500 characters)
pnpm narrate

# 2. record, one segment at a time, in any order
pnpm film:cards                                    # about a minute
pnpm film:proving                                  # a live small hosted Gauntlet: under a cent
pnpm film:desktop                                  # the app must be up, see below

# 3. compose
pnpm film:compose -- --captions --xfade 300        # take/film.mp4 and take/film.srt
```

`CARDS_ONLY=T1,R5` renders only those cards. `--speed 8` overrides every logged wait's factor;
`--allow-long` lets a draft past 2:59 with a warning; `--max-s` changes the limit for one run.
ffmpeg and ffprobe come from `PATH`, or from `FFMPEG` and `FFPROBE`.

**The desktop app for the capture.** Build and start it as `uat/env.md` describes, with its CDP
port open and Ledgerbox as its tab, then open Athena's window and leave both windows on the
primary display (ddagrab captures output 0; `--grabber gdigrab` takes virtual-desktop coordinates
if a window must sit elsewhere):

```bash
pnpm dev:ledgerbox                     # port 3001, from the repository root
cd apps/desktop && pnpm dev            # the dev server the debug binary loads
ATHENA_STORE=<a scratch store> ATHENA_START_URL=http://localhost:3001 \
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 \
  ./src-tauri/target/debug/athena-desktop.exe
```

The D1 command needs a real engine turn, which spends whatever engine the shell is set to; the
recorder only types, waits and clicks. `--window largest` films only the biggest window when the
union of both is too wide to read.

### 5.4 What it needs and what it costs

| Need | For | Cost |
|---|---|---|
| `ELEVENLABS_API_KEY` (env or a gitignored `.env`) | narration | about 1,500 characters a take, re-runs only for changed lines |
| ffmpeg with libx264, libass and ddagrab or gdigrab | capture and compose | none |
| `NEBIUS_API_KEY` in the repository root `.env` | the proving segment | one small hosted Gauntlet: $0.0016 and $0.0021 in the two rehearsal runs, under the server's own $3 a day cap; no Claude |
| the desktop app built, with CDP, and an engine signed in | the desktop segment | one engine turn |
| a Chromium for Playwright (`pnpm exec playwright install chromium`) | cards and proving | none |

### 5.5 Pre-flight: rights and what is on screen

- [ ] **No third-party logos or product names in a browsed tab or on screen.** Use the example apps
      (Ledgerbox) only; close every other tab of the desktop shell before D1.
- [x] **The proving page names no third-party product.** Its pills, cost tally and preset notes say
      "reference engine" and "reference control"; the data keys behind them are unchanged.
- [ ] **The desktop engine row.** If the shell shows its engine by product name anywhere in the
      captured windows, keep that panel closed during the capture.
- [ ] **No music.** The film has narration only; a music bed needs its own licence.
- [ ] **ElevenLabs licence.** The [Terms of Service](https://elevenlabs.io/terms-of-use), section
      1(c), let free-plan users use the service for non-commercial purposes only, and paid
      subscribers use the output commercially; ElevenLabs' public guidance also asks free-plan
      output to be credited ("Voice generated by ElevenLabs" or similar). A hackathon submission
      video is public and promotional, so narrate on a **paid plan** with a premade voice, or at
      the least put the credit line in the video description. Premade voices need no separate
      voice-owner licence; a cloned or library voice does, and the script does not use one.
- [ ] **The numbers on the result cards** (R1 to R4) are typed from README section 9 and the
      Proving Ground's reports: 93 hostile turns and 0 breaches, persona fidelity 0.972 shown as
      0.97, the approval spent once, Lightning then Super. Re-read them against the latest reports
      the day of the shoot.
- [ ] **P4 says "Zero breached".** The film records a live run, so the line is only true if the run
      is; read `notes` in `take/proving.take.json` (the end line and the tally) before composing.
