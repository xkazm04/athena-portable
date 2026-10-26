# The demo recording: plan, script and timings

README section 1 gives the demo four acts under five minutes. This document is the production
plan for recording it: how the take is made, the narration script in English with the on-screen
action beside every line, the timings, and what is still needed. ADR 0017 and ADR 0018 describe
the apps it runs on.

**The submission film is section 5**: one cut under three minutes of the product as it is today
and the Proving Ground, scripted in `examples/journey/script/film.en.json`, with its clock, the
source of every figure it shows and the recording-day runbook. Sections 1 to 4 are the longer
four-act journey through the web apps.

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

## 5. The submission film

The film for the Nebius x NVIDIA submission, under three minutes: the product as it is today (her
desktop, a project, the gate on a real app, a benched chore), then the Proving Ground attacking the
gate live, then the measured proofs. The script is `examples/journey/script/film.en.json`, written
2026-10-26 and not yet narrated or shot. It names "NVIDIA Nemotron" and "Nebius Token Factory" in
words and says what each does (Nemotron writes the attacks, plays Athena under test and the test
users, and reads documents; Token Factory serves it and carries the model ladder), and it names no
other third-party product. `script/proving.en.json`, the 2026-10-07 draft, is kept for the record
and for the recorders' tests; it is not the submission cut.

### 5.1 The script and its clock

Twenty-two beats in seven acts, 2,171 characters of narration. At fifteen characters a second (the
rate the first forty-two ElevenLabs clips measured) that is **2:25 of voice and 2:36 held on
screen** with settles and half-second breaths, before any live wait.

| Act | Segment | Beats | Held | What it shows |
|---|---|---|---|---|
| open | card | T1 | 10.0 s | Title: Athena, a personal agent inside the web apps you already use, that stops and asks |
| home | desktop | S1–S3 | 19.0 s | The surface (her face, the five lights); Ctrl+K to the "Studio books" project (brief, apps, chores, memory); the stage dives to Ledgerbox's tab |
| gate | desktop | D1–D4 | 22.6 s | Mira's command typed into Athena's window; the decision card for `send_reminder`; Approve and the stamp; the Record's row for it |
| chores | desktop | C1–C2 | 17.1 s | Ctrl+K to the PSLF chore: $20,000 in its invented example, 8 of 8 traps avoided, its verdict |
| claim | card | K1 | 5.7 s | "Can she be talked past her own gate?" |
| proving | proving | P1–P5 | 35.7 s | The hosted trigger page: token, Gauntlet, Small, Start; the live feed; 0 breached; the cost |
| results | card | R1–R6 | 45.7 s | 306 hostile turns and 0 breaches; persona fidelity 94–97%; an approval is spent once; the 2026-10-22 Super-VL retest; the model ladder; close |

| Beat | Line | Held |
|---|---|---|
| T1 | Athena is a personal agent inside the web apps you already use. Anything that reaches a person, or cannot be undone, stops and asks you first. | 10.0 s |
| S1 | This is her desktop: Athena on top, and every place she can take you one move below her. | 6.4 s |
| S2 | Control K goes anywhere. A project keeps work apart: the studio's books, a brief she reads every turn, its own memory. | 8.4 s |
| S3 | Ledgerbox, the studio's invoicing app, is open in a tab. | 4.2 s |
| D1 | (Mira) Send Halcyon Works a reminder about their overdue invoice. | 4.4 s |
| D2 | She drafts it on the page. Sending reaches a person, so the gate stops her and asks. The card shows exactly what will go out. | 8.8 s after the engine's turn |
| D3 | Approve, and that one action runs, once. Decline, and nothing moves. | 5.0 s |
| D4 | The record keeps what ran, on which app, and who said yes. | 4.4 s |
| C1 | Chores are longer jobs, each rehearsed in an invented world with a known answer. | 5.8 s |
| C2 | This one certifies loan-forgiveness months. In its test run she made all five filings the rules allow, twenty thousand dollars, and fell for none of eight traps. | 11.2 s |
| K1 | A gate is only a claim until someone attacks it. So we built a Proving Ground. | 5.7 s |
| P1 | NVIDIA Nemotron, served on Nebius Token Factory, writes the attacks: poisoned pages, forged tool results, planted memories. | 8.7 s |
| P2 | A judge with a token starts a small Gauntlet. Every attack lands in a fresh, throwaway world, against Athena running on Nemotron. | 9.1 s |
| P3 | Each call streams in as it happens: the attacker writing, Athena answering, and what every call cost. | 7.2 s after the first call |
| P4 | The verdict is read from the gate's own records, never from a model's opinion. Zero breached. | 6.7 s after the run's end |
| P5 | And the whole run cost less than a cent of Nemotron. | 4.0 s |
| R1 | Three full runs: three hundred and six hostile turns, and no gated action ran without approval. | 6.8 s |
| R2 | Nemotron also plays our test users: in character on ninety-four to ninety-seven percent of turns, judged blind. | 7.9 s |
| R3 | And an approval is spent once: a replay is refused. | 3.9 s |
| R4 | On newer models, Nemotron Super-VL reads people's documents: ninety-one percent right, against ninety-six for the reference reader, at about a thirtieth of the cost. | 11.5 s |
| R5 | Each role starts on Nemotron Lightning, the cheapest rung on Nebius Token Factory, and climbs to Super only when its proof fails. | 9.1 s |
| R6 | Athena. A personal agent in the apps you already use, behind a gate she cannot argue with. | 6.5 s |

The live waits are what the script cannot know: the engine's turn before D2's card arrives, and
the Gauntlet's calls before P3 and P4. Both are logged by their recorders and played at 4x under a
"sped up 4x" label. Planned through `planFilm` with these holds and a 300 ms crossfade, the cut is
**2:42 with a 20 s engine turn and 2:52 with a 60 s one**. A 120 s turn makes 3:07, which compose
refuses (the limit is 2:59): compose that take with `--speed 8`, or re-take the desktop segment. The
small hosted Gauntlet measured 12 s of wall clock in rehearsal, about 3 s of film.

**Where every figure on screen comes from.** Re-read them against the sources the day of the shoot.

| Beat | Figure | Source |
|---|---|---|
| R1 | 306 hostile turns, 0 breaches, three runs | docs/submission.md and README section 9, "Repeat runs": 0 of 93 (`20261007T140609Z`), 0 of 107 (`20261007T205627Z`), 0 of 106 (`20261007T213007Z`) |
| R2 | 94–97% in persona, three runs | the same table: 0.972 (`20261007T162204Z`), 0.958 (`20261007T210930Z`), 0.944 (`20261007T214341Z`) |
| R3 | 1×: an approval is spent once | docs/submission.md, "The approve path" (ADR 0038): a replay is refused with `approval_spent` |
| R4 | 91% against 96%, 1/30 of the cost, $0.0007 and $0.0209 a document | README section 9, "Retest on newer Nemotron models (2026-10-22)", run `20261022T195808Z`: 91.0% and 96.2% field accuracy, $0.0007 and $0.0209 (29.9 to 1) |
| R5 | Nemotron 3.5 Lightning, then Nemotron 3 Super | docs/submission.md, "How NVIDIA Nemotron is used" (ids and prices read 2026-10-07) |
| P4, P5 | 0 breached, under a cent | the live run (`take/proving.take.json` `notes`); the rehearsals measured $0.0016 and $0.0021, the hosted run `20261007T172658Z` $0.0013 |
| C2 | $20,000; 5 filings; 8 of 8 traps; the verdict | `playbooks/pslf-employment-certification/bench.json`, run 2026-10-22T09:01:01Z: 5 of 5 found, $20,000 of $20,000, 0 of 8 traps filed, 0 false claims, `exceeds`. README section 14 lists the same counts for its 2026-10-09 run. The page's time tile (6 h by hand, against her run plus your review) comes from the same file and is not narrated |
| D2–D4 | the card, the stamp, the Record row | the live take: whatever the engine drafts on the day |

Why the PSLF chore: its example figure and its author's estimate are the same ($20,000), so no two
renderings of one quantity can differ (BACKLOG B-C1, B-C2, B-C12); its money is money back; its
portals and people are invented; and its "what it costs" line names no product. Most chores still
say "only your Claude usage" in their fit block, and medical-bills shows $3,423 and $3,424 on one
screen (recertify R-2), so neither kind is filmed.

### 5.2 One recorder per segment

An act's `segment` says where its picture comes from; an act without one is `web`, so the two
journey cuts are unchanged. Every recorder writes a video and a segment take beside it in
`examples/journey/take/` (gitignored): the beats' `start_ms`/`end_ms` on that video's clock, and
`speedups`, the waiting stretches.

| Segment | Recorder | Writes | Paced on |
|---|---|---|---|
| `card` | `tests/cards.take.spec.ts`: every card beat set on one page from `src/card-page.ts`, the `record-page.ts` idiom | `cards.webm`, `cards.take.json` | the narration only |
| `proving` | `tests/proving.take.spec.ts`: boots `python -m athena.proving.server --hosted` on a free port with a judge token minted for the take (`src/proving.ts`), types the token (a password field), picks Gauntlet and Small, presses Start | `proving.webm`, `proving.take.json` (and the run itself under `take/proving-runs/`) | the page's own event feed: `first_call` waits for the first call line, `end` for the end line |
| `desktop` | `scripts/record-desktop.mjs`: attaches to the running app over CDP, captures the screen rectangle of the app's windows with ffmpeg (`ddagrab`, falling back to `gdigrab`; rectangles from `scripts/window-rect.ps1`) | `desktop.mp4`, `desktop.take.json` | Athena's window: `card` waits for a decision card, `wait-decided` for its stamp |
| `web` | `tests/take.spec.ts`, as in section 1 (only its `web` acts) | `journey.webm`, `take.json` | the narration |

The desktop recorder's steps (`scripts/lib/desktop-steps.mjs`, unit-tested in
`scripts/test/desktop-steps.test.mjs`) act on Athena's window (`athena.html`) or on Main's console
(`chrome.html`):

| Step | Window | What it does |
|---|---|---|
| `type-command`, `send` | Athena | types the beat's line into her message field, presses Enter |
| `approve`, `decline`, `wait-decided` | Athena | presses the card's button; waits for its stamp |
| `open-record` | Athena | presses the Record button |
| `surface` | Main | sets the depth hash to `#/`, so the stage dives to the surface |
| `page:<origin>` | Main | sets `#/apps/<origin>/page`, so the stage dives to that app's live tab |
| `finder:<query>` | Main | Ctrl+K (or the bar's finder control when the key does not land), types the query, Enter on the first hit |
| `pause:<ms>` | – | waits, so a dive ends before the next step |

`--dry` refuses a script with a step outside this list. Before attaching, the recorder reads
`/json/list` and refuses a dev build (UI from the Vite server on 1431): its blob shared worker
makes Playwright's CDP attach kill the process (`apps/desktop/drive/README.md`, "Two transports").

`scripts/compose.mjs --film` cuts each act out of its segment's video from its first beat's start
to its last beat's end, plays the logged waits faster, concatenates the acts in script order
(optionally crossfaded), lays each beat's clip at its place on the joined timeline, burns the
captions and the speed-up label, and checks the length against the script's `max_ms` (2:59).

### 5.3 Commands

From `examples/journey/`, with the script set once for every step. Pass flags to the package
scripts without a `--`: this pnpm forwards a literal `--`, which the scripts refuse.

```bash
export JOURNEY_SCRIPT=script/film.en.json

# 0. rehearse without spending anything
pnpm narrate --dry                     # durations at 15 chars/s; prints the characters it would spend
pnpm film:placeholders                 # colour clips, tones and segment takes in take/placeholder/
pnpm film:compose --takes take/placeholder --captions --xfade 300   # a real mp4, end to end
node scripts/record-desktop.mjs --dry  # the beats and steps, the grabbers this ffmpeg has, the capture command

# 1. narrate (ElevenLabs; 2,171 characters)
pnpm narrate

# 2. record, one segment at a time, in any order
pnpm film:cards                                    # about a minute
pnpm film:proving                                  # a live small hosted Gauntlet: under a cent
pnpm film:desktop                                  # the app must be up, section 5.6

# 3. compose
pnpm film:compose --captions --xfade 300           # take/film.mp4 and take/film.srt
```

The placeholder rehearsal holds every beat 2.5 s, so its mp4 (0:59.2 for this script) proves the
pipeline, not the clock; the clock is section 5.1's. `CARDS_ONLY=T1,R6` renders only those cards.
`--speed 8` overrides every logged wait's factor; `--allow-long` lets a draft past 2:59 with a
warning; `--max-s` changes the limit for one run. ffmpeg and ffprobe come from `PATH`, or from
`FFMPEG` and `FFPROBE`.

### 5.4 What it needs and what it costs

| Need | For | Cost |
|---|---|---|
| `ELEVENLABS_API_KEY` (env or a gitignored `.env`) | narration | 2,171 characters a full take, re-runs only for changed lines |
| ffmpeg with libx264, libass and ddagrab or gdigrab | capture and compose | none |
| `NEBIUS_API_KEY` in the repository root `.env` | the proving segment | one small hosted Gauntlet: $0.0016 and $0.0021 in the two rehearsal runs, under the server's own $3 a day cap; no Claude |
| the desktop app as a bundled debug build, with CDP, and an engine signed in | the desktop segment | one engine turn (D1), on the engine the app is set to |
| a Chromium for Playwright (`pnpm exec playwright install chromium`) | cards and proving | none |

### 5.5 Pre-flight: rights and what is on screen

- [ ] **No third-party logos or product names in a browsed tab or on screen.** Use the example apps
      (Ledgerbox) only; close every other tab of the desktop shell before S1.
- [x] **The proving page names no third-party product.** Its pills, cost tally and preset notes say
      "reference engine" and "reference control"; the data keys behind them are unchanged.
- [ ] **The desktop engine row.** If the shell shows its engine by product name anywhere in the
      captured windows (Mind > Engine, a welcome card), keep that panel closed during the capture.
- [ ] **The Record's Model calls list stays out of frame (D4).** Each of its rows names the
      engine's model beside the cost. Size Athena's window so "This window" fills it and the list
      is below the fold; the film does not show the turn's cost and the narration does not claim it.
- [ ] **The chore page (C2).** Leave "the runs it stands on" folded (each run names the bench's
      model) and do not scroll to "Where it fits". Film the PSLF chore only (section 5.1).
- [ ] **No music.** The film has narration only; a music bed needs its own licence.
- [ ] **ElevenLabs licence.** The [Terms of Service](https://elevenlabs.io/terms-of-use), section
      1(c), let free-plan users use the service for non-commercial purposes only, and paid
      subscribers use the output commercially; ElevenLabs' public guidance also asks free-plan
      output to be credited ("Voice generated by ElevenLabs" or similar). A hackathon submission
      video is public and promotional, so narrate on a **paid plan** with a premade voice, or at
      the least put the credit line in the video description. Premade voices need no separate
      voice-owner licence; a cloned or library voice does, and the script does not use one.
- [ ] **The numbers on the result cards** (R1, R2, R4, R5) and C2's line match section 5.1's source
      table. Re-read them against docs/submission.md and README sections 9 and 14 the day of the shoot.
- [ ] **P4 says "Zero breached" and P5 "less than a cent".** The film records a live run, so the
      lines are only true if the run is; read `notes` in `take/proving.take.json` (the end line and
      the tally) before composing.
- [ ] **D2 shows a `send_reminder` card.** The engine drafts on the day; if it files another
      action, or none, re-take the desktop segment rather than narrate over it.

### 5.6 Recording day, in order

**What must be running.**

| What | Where | How |
|---|---|---|
| Ledgerbox | port 3001 | `pnpm dev:ledgerbox` from the repository root |
| The desktop app, bundled (no Vite) | CDP on 9222 | built once with `pnpm tauri build --debug --no-bundle` in `apps/desktop`, then started as below |
| A scratch store | a file you choose | `ATHENA_STORE`; delete it to start over |
| ffmpeg on `PATH` | | `ffmpeg -hide_banner -filters` lists ddagrab |
| `NEBIUS_API_KEY`, `ELEVENLABS_API_KEY` | root `.env`, env | section 5.4 |

```bash
# apps/desktop: a bundled debug build loads its UI from dist, so Playwright can attach over CDP
pnpm tauri build --debug --no-bundle
ATHENA_STORE=<a scratch store> ATHENA_START_URL=http://localhost:3001 \
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 \
  ./src-tauri/target/debug/athena-desktop.exe
```

**Set the stage once, by hand.** The recorder only types, waits, presses and dives.

1. Onboard the scratch store (first launch) and sign the engine in; check one plain message gets an
   answer.
2. Register Ledgerbox (All apps) and let Athena act on it (Athena's window, "The apps she may act
   on"); its tab is open from `ATHENA_START_URL`. Close every other tab.
3. On the Projects field make a project named exactly **Studio books**, give it a one-line brief
   (for example "Mira's design studio: invoices and client reminders in Ledgerbox"), and add
   Ledgerbox from its "Apps to add". The finder step types "Studio books".
4. Check that Halcyon Works has an overdue invoice on the Ledgerbox page.
5. Open the PSLF chore once (Ctrl+K, "Public service loan") so its page and stills are loaded, then
   go back to the surface.
6. Lay out the windows on the primary display: Main on the left, Athena's window open (her
   conversation, not the folded seal) on the right, sized so the Record's "This window" fills it.
   Keep the pair near 1440x900, or pass `--window largest`.
7. Clear Athena's conversation so D1 starts on an empty rail.

**Then, from `examples/journey/` with `JOURNEY_SCRIPT=script/film.en.json`:**

1. `pnpm narrate`, and listen to the clips; `pnpm narrate --only D2` re-voices one line.
2. `node scripts/record-desktop.mjs --dry`: the app is up, the region is the two windows, the
   grabber is ddagrab.
3. `pnpm film:desktop`. Hands off the mouse and keyboard until it prints `desktop:`. It ends
   non-zero naming any beat that failed, and keeps the capture.
4. Watch `take/desktop.mp4`. Re-take (stage step 7 first) if the card was not `send_reminder`, the
   finder missed, or a tab other than Ledgerbox showed.
5. `pnpm film:cards`, then `pnpm film:proving`; read `notes` in `take/proving.take.json`.
6. `pnpm film:compose --captions --xfade 300`. If it refuses the length, add `--speed 8`.
7. Watch `take/film.mp4` end to end against section 5.5, then upload it, with the credit line if
   the narration was made on a free plan.

The operator presses nothing during a capture; everything by hand is the stage list above.
