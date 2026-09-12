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
   │              (JOURNEY_VIDEO=1 JOURNEY_SCRIPT=journey.en.json)
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
| 1.8 | `open_item`, `draft_reminder(firm)` on the oldest: the draft block appears on the card | Narrator | A draft is a whole message, addressed to the client's billing contact. Writing it is reversible. Sending it is not. | 9 |
| 1.9 | `send_reminder`: the strip shows a decision card, the page's own gate arms with the recipient | Athena | Ready to send to Nils Eriksen at Halcyon Works. Shall I? | 5 |
| 1.10 | Mira approves; the card resolves; "Reminders sent 1" in the aside | Mira | Yes. | 3 |
| 1.11 | Second draft, gentle; second card; approved | Athena | Verdant Supply, forty-nine days, gentle tone. | 5 |
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
