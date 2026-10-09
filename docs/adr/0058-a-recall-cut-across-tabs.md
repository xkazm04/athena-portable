# 0058. A recall she asks for returns the episodes it matched whole, best match first

Date: 2026-10-09

Amends `core/recall.py` and the `core.recall` executor in `wiring.py` (README §2 invariant 4,
§3.3). Follows [0042](0042-recall-matches-any-word-and-shows-where-it-matched.md) and
[0049](0049-recall-carries-three-reads.md). Found by the playbook bench (ADR 0040).

## Context

Work across tabs runs on memory. The bench gives each portal its own origin, so each tab has its
own session and its own CLI conversation: no project id is sent, so `conversation_for` returns
the session's (`daemon/sessions.py`). What she wrote in one tab reaches another only as an
episode, through the frame's "Recalled conversation" window or through `core.recall` (ADRs 0040
and 0045).

**What property-tax-appeal lost.** Benched at 8c404dc, it shipped short: 5 of 8 items, $1,470 of
$2,310, no false claim. Turns are counted from 1, as the bench's log counts them.

- Turn 8, Compsmith. She ends with a 2,686-character summary. Its first line names R-10422 and
  R-20977. Then come R-10422's three comparables (S-1 to S-3, adjusted $463,000 to $468,000),
  and then the duplex's. The trace keeps the first 501 characters, which end inside R-10422's
  section.
- Turn 9, Countyline: "The recalled Compsmith summary was cut off. I'm pulling the full
  version so the opinions of value come from what I wrote down, not from my own sums."
- Turn 11. She files R-10422 with S-1, S-2 and S-3 and the repair estimate, all correct. She holds
  the duplex "until I've confirmed which of its sales qualify".
- Turn 12, follow-up 1, Compsmith. A recall confirms D-1 at $596,000 and D-2 at $604,000.
- Turn 13, follow-up 2, Countyline. She calls Compsmith tools from the pinned tab and is refused:
  "I won't guess a median from D-1 (adjusted $596,000) alone."
- Turns 14 and 15, follow-up 3, Compsmith. She re-reads the three sales "so the duplex opinion of
  value rests on figures in front of me and not on a cut-off recall". The bound of three
  follow-ups (`BenchConfig.follow_ups`, ADR 0040) runs out before she is back in Countyline. The
  three missed items are R-20977's protest ($840) and its two comparables.

**What cut it was the episode excerpt, not the cap.** A recall returns at most 500 bytes of any
episode (`EXCERPT_BYTES`). A matched episode shows the window around the first query word it
contains (ADR 0042). An episode in the recency tail shows its stored head (`body_excerpt`). The
turn-8 summary is stored as `[host:compsmith] ` followed by her 2,686 characters. Any recall of it
therefore shows its first 500 bytes: 483 characters of her text, which end before the duplex
(R-20977's section starts after character 501).

Centring the window does not help. The first line names both properties, so a query that names
the subject hits there first, and the window starts at byte 0. This is the cut she saw, and it
happens before `RECALL_CAP` is applied. With no cap at all, the summary would still come back as
the same 500 bytes.

`RECALL_CAP` then cuts again. `core.recall` renders the always tier, the keyword lane and up to
20 episode excerpts, oldest first. A full window is about 10,000 characters, and the gate keeps
the first 4,800 (`GateHook.enforce_cap`). So the cut falls on the newest episodes, and in
cross-tab work those come from the tab she just left.

The frame budgets play no part. `frame.tools` (12,000, ADR 0043) drops whole results and never
cuts one, and the ambient window's 40,000 is a tripwire, not a cap.

The committed record does not say what the turn-9 recall returned or how long it was. The trace
keeps host calls only (`_host_calls` leaves out `core.*`) and 520 characters of her words. The
full report is in the gitignored `proving-runs/`. The code settles the part that mattered:
whichever path brought the summary back, it brought back 500 bytes of it.

ADR 0049 sized `RECALL_CAP` at "three page reads' worth", assuming a recall returns each episode
as the capped read it was. It does not. Each episode comes back as a slice of at most 500 bytes.
4,800 characters therefore hold up to nine slices, and no page read longer than 500 bytes comes
back whole. Page reads run to 1,600 characters, and 132 of the 229 turns in the committed traces
said more than 500.

**Why turn 12's recall was not enough in turn 13.**

1. She said the turn-12 reply in the Compsmith conversation. The Countyline session that resumed
   at turn 13 holds turns 9 to 11 and not turn 12, so the reply could reach her only as an
   episode.
2. The frame's window is queried with the person's message (`lane/turn_frame.py`). Turn 13's
   message is "I've switched to Countyline Appraisal as you asked. Go ahead." Its query words are
   switched, Countyline, Appraisal, asked and ahead. None of them names the duplex. The relevance
   slots go to episodes that name Countyline or an appraisal, and the recency tail gets only the
   slots they leave. Her words show she had D-1 without D-2. The head of the turn-12 reply would
   have held both, since D-2's figure ends at character 333. So the reply reached the turn cut
   short, or did not reach it at all.
3. Turn 9 had taught her that a recall can come back cut, and ADR 0045 tells her a proposal rests
   on what a page says. The turn-13 refusal offered her `core.recall` or a switch
   (`harness/policy.py`). She chose the switch and said why in turn 14: "not on a cut-off
   recall". The product had taught her that a recall is not the page, and here that was true.

**It is a pattern.** Every committed `bench.json` was searched, trace and history. The search
looked for a recall announced as cut, or "cut off", "cut short" or "showing N of M" in what she
said. Page answers that announce paging ("showing 6 of 11 stops") were left out, and so was
lien-desk's run-4 note, which is about a page read. That leaves six of the 15 playbooks, one run
each:

| Playbook | Run | Turn | What she said | Cost |
|---|---|---|---|---|
| cpg-deductions | 2026-10-07T23:28:15Z | 14 | "The recall came back cut off (showing 1600 of 2425)" | re-read in the same tab; exceeds |
| lien-desk | 2026-10-07T23:43:59Z | 11 | "The recall I have is cut short." | re-read in the same tab; exceeds |
| freelancer-receivables | run 3, 2026-10-08T00:13:09Z (history note) | — | "showing 1600 of 3074" (ADR 0049) | the demand held; short, 2 of 5 |
| eu261-flight-compensation | 2026-10-09T17:18:02Z | 11 | "the recall cut off the rest of the list, including SR 92" | none measured; exceeds |
| recoverable-depreciation | 2026-10-09T17:45:33Z | 11, 12 | "The recall cut off the contents lines and the L3, L5, L6 and L10 figures"; "the recalled Buildmark table was cut off before it" | all three follow-ups spent; exceeds |
| property-tax-appeal | 2026-10-09T17:45:12Z | 9 | "The recalled Compsmith summary was cut off." | $840 and two items; short |

The first three ran under the 1,600 cap. The last three ran under 4,800. They are three of the
six playbooks benched on 2026-10-09.

The count is a floor. The trace keeps 520 characters of each turn, history keeps one headline per
run, and traces of earlier runs are not kept. The cap was raised after the first case, and the
defect came back three times in one batch.

## Decision

`core.recall`, the recall she asks for, no longer reuses the frame's window. It answers with
whole episodes.

1. **Matched episodes, whole.** It returns the episodes its query matches, ranked by BM25, newer
   first on a tie. Each comes back with its full body as stored in the index, never a 500-byte
   window. Her own summaries and the page answers she read come back as she wrote or read them.
   A recalled page answer is what the page said, which is what ADR 0045 asks a proposal to rest
   on.
2. **Whole episodes up to the cap, never one cut mid-body.** Episodes are packed best first. The
   answer stops before the first episode that would pass `RECALL_CAP`, as the tool-results block
   does (ADR 0043). It announces `(showing N of M)` in episodes, where M counts every episode that
   matched. A narrower query reaches the rest, and the tool's description says so. The only
   episode ever cut is one that is longer than the cap on its own. The gate cuts it at the cap and
   announces it, as now. Page answers stop at 1,600 characters. Her longest replies in the
   committed traces reach the transcript's own 4,000-character limit (three turns).
3. **No recency tail and no always tier.** Recency is the frame window's job. The always tier is
   already in every system prompt (`memory.always`). Both would spend the cap on what she already
   has. The keyword lane of distilled memory stays, ahead of the episodes, under the same packing.
4. **`RECALL_CAP` stays at 4,800.** The evidence shows the cut was not a cap problem, so there is
   no third raise. At 4,800, a whole-episode answer holds three page reads, which is what ADR
   0049 meant, or one long summary of hers and a read. The 12,000 budget that holds tool results
   (ADR 0043) sees no larger answer than it does today.
5. **The frame's ambient window is unchanged.** It keeps its 20 slots of 500-byte excerpts and its
   query, so a turn costs what it costs today. `EXCERPT_BYTES` remains the parity contract of the
   index column (ADR 0042).

## Consequences

- In property-tax-appeal's turn 9, a recall that names the Compsmith summary or the duplex returns
  the 2,700-character summary whole, inside the cap, with D-1 and D-2 in it. Under ADR 0045 she can
  file R-20977 from Countyline without spending a follow-up on it.
- A broad recall shows fewer episodes than today: three to nine whole ones instead of up to nine
  slices. It says how many matched. The cut now falls between episodes, not inside one, so she can
  act on it.
- The refusal that sends her from a pinned tab to `core.recall` (`harness/policy.py`) now points
  at something that gives a full answer.
- **The delivery that follows**, in this order:
  1. The code change, with its tests and a README §3.3 line, in one commit. A whole-episode lane
     in `core/recall.py` (for example `recall_whole`), used by `wiring.recall_executor`. The
     catalog's description of `core.recall` says that matches come back whole, best first, and
     that a narrower query reaches the rest.
     - `tests/core/test_recall.py`: an episode longer than 500 bytes, matched by a word in its
       head, comes back with its tail. Packing stops before an episode that would pass the cap
       and announces N of M in episodes. The best match comes first. The frame window still shows
       500-byte excerpts.
     - `tests/e2e/test_reads.py`: a summary written in one origin, with its figures past byte
       500, is recalled whole from another origin. The existing test that drives a recall past
       4,800 characters is rewritten for whole-episode packing.
     - `tests/core/test_catalog.py` still pins both caps, unchanged.
  2. A regression re-bench of property-tax-appeal with
     `--note "after ADR 0058 (a recall returns whole episodes; run 3's duplex summary came back as
     its first 500 bytes)"`. `truth.json`, `world.json`, the scorer and the follow-up bound stay
     unchanged. The precedent is f4ed37d, which re-benched clinic-denials after ADRs 0046 to 0048.
     The second re-bench worth running is recoverable-depreciation, which spent all its
     follow-ups on a cut table.
- **What batch briefs stop working around** once this is on main. They stop telling authors to
  keep pages, tables and summaries short so a recall fits. A page may run to `READ_CAP` (1,600),
  which is the page read's own bound, and `check` still requires anything longer to be paged. A
  world no longer has to put the figure a later tab needs near the top of a page. The workaround
  could not have saved property-tax-appeal anyway: the long episode was her own summary, which no
  author writes.

## Alternatives that lost

- **Raise `RECALL_CAP` a third time.** This is not a cap problem. The 500-byte excerpt cuts
  first, so a larger cap returns more slices, not the summary. To return 20 whole episodes, the
  cap would need to be at least 34,000 characters (20 page reads of about 1,700). That is nearly
  three times the 12,000 that holds tool results (ADR 0043), and it would crowd out the page
  answers of the same turn.
- **Raise `EXCERPT_BYTES`.** It is the index column's parity contract (ADR 0042). It would also
  widen all 20 slots of the ambient window on every turn, so every turn pays for what one
  deliberate recall needs. A summary longer than the new size would be cut again.
- **Store one compact findings episode per subject before she leaves a tab**, through
  `core.checkpoint` or `core.write_fact`. This moves the defect onto a step she can forget.
  `write_fact` is `GATED`, so each finding becomes a card the person must answer. A checkpoint
  note is an episode, and the recall it was written for would cut it the same way.
- **Make a cut recall tell her how to fetch the rest**, by episode id and offset. Turn 9's
  2,700-character summary would take six round trips in 500-byte steps, each one a round of
  tokens and a ledger row. Whole-episode packing leaves one remedy, a narrower query, and the
  footer already tells her more episodes exist.
- **Have her file on a figure a recall confirmed instead of asking to go back** (a law
  paragraph). In turn 13 she had D-1 without D-2. A rule to file on recalled figures, while a
  recall can return part of an episode, invites filing on part of the evidence. That is the
  opposite of ADR 0045. Once a recall returns the page's answer whole, ADR 0045 is met as it
  stands.
- **Hold one conversation across the bench's tabs**, by sending a minted project id on every turn
  so `conversation_for` keeps her words in context. This changes the bench, not the product, and
  it goes around recall instead of fixing it. A person with no project selected still works tab
  by tab, and what carries between portals is memory (ADR 0040).
- **Raise the bench's follow-up bound.** ADR 0040 counts the person's patience as part of the
  measure. Asking the person to switch tabs three times for one protest is the cost being
  measured, and more follow-ups would hide it.
- **Keep pages short in the worlds**, the batch briefs' current workaround. The bench stops
  showing the defect while the product keeps it. Worlds become less like real portals. And it
  cannot shorten her own summaries.
