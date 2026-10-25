# 0131. A chore comes due as a staged review

Date: 2026-10-22

Follows [0123](0123-an-approved-brief-is-a-case-file-in-the-brain.md) (a case is `goals/<proj>.md`),
[0124](0124-your-runs-come-back-to-the-chore.md) and
[0127](0127-a-cases-turns-keep-their-conversations-and-are-stamped-under-it.md) (a case's runs come
back to it as receipts, its turns stamped under it, each tab keeping its own conversation) and
[0130](0130-a-chores-last-run-stays-out-of-the-next-runs-prompt.md) (nothing of the last run goes
into the next run's prompt). Standards: `scheduling` (all six techniques) and `proactive-nudges`
(`attention-budgets`, `quiet-windows`, `nudge-identity-dedup`, `efficacy-feedback`).
`docs/features/playbooks.md`, "When it comes due".

## Context

A case is a chore a person runs again, monthly or quarterly. Nothing reminded her: the case waited
on a topic page until she remembered it. The brain has reserved `rituals/cadence/` since the tree
was laid out, and the rebuild indexes it as kind `ritual`, but nothing wrote or read it. Whatever
reminds her must keep README §2 and the rule of README §3.4 standing: nothing reads a portal or
sends a turn without the person there, and no authority or gate changes.

## Decision

1. **The cadence is durable data** (`scheduling` golden path; `next-run-computation`).
   `rituals/cadence/<proj>.md` (`adopt/cadence.py`) holds the rule she confirmed, her zone, the
   computed `next_run_at` (a cache of the rule, recomputed on every change of rule, zone or
   `enabled`), `last_run_at` (the latest occurrence the loop acted on), the one review that may be
   open, a counter of unanswered occurrences and a log. The header is the goal's five keys with
   `type: ritual` (`Brain.write_ritual`, which writes only into the three reserved ritual folders,
   by a slug name); the body is markdown for a person, then `<!-- athena:cadence -->` and one JSON
   block, the `Cadence` contract (`contracts/adopt.py`, schema 1). Its id is a minted **`rit_`**
   id, a new kind in `contracts/ids.py`: the case's `proj_` id is already the goal's, and one id in
   two files is a collision `reconcile_from_disk` refuses. The loop reads the files, not the index,
   so a deleted `index.sqlite` loses nothing and a rebuild indexes the cadence again.
2. **The rule is one of three shapes**: a weekday, a day of the month (1 to 31; a shorter month
   falls on its last day), or every N days (1 to 366) from a first local date, each at a local
   `HH:MM`. Validated at the route (`rule_from`); `next_after` is the one calendar function: it
   computes on the rule's local calendar and answers a UTC instant, so a Monday 09:00 stays 09:00
   across a DST change. A time inside a spring-forward gap falls an hour later that day, once; a
   repeated fall-back time is its first occurrence (`fold=0`).
3. **The zone.** The desktop sends `Intl`'s IANA name. This install may carry no zone database
   (Windows without `tzdata`, and the core stays stdlib-only, ADR 0002), so a name it does not know
   is read as this computer's local time through the C library, DST included (`_SystemLocal`),
   and the cadence says so. `UTC` needs no database.
4. **Only the person sets it.** `POST /adopt/cases/<proj>/cadence {rule?, timezone?, enabled?}`
   sets, changes, pauses (`enabled: false`) or resumes; `GET` answers the cadence, its log (latest
   first, `(showing N of M)`), the next three occurrences and a **suggestion** from the playbook's
   `economics.times_per_year` (n = 365 / count: seven days or fewer is weekly on Monday, 28 to 31
   is monthly on the 1st, else every n days, first n days from today, all at 09:00). The
   suggestion is written nowhere until she presses "Use the suggestion". Resuming recomputes from
   now; pausing closes an open review as `paused`.
5. **A reconciliation loop, advance before notify** (`missed-run-semantics`,
   `overlap-and-reentrancy`). `ChoreClock.tick` (`adopt/chores.py`, a 30 s daemon thread, started
   by `athena serve` only, so the showcase's second in-process Athena never ticks; a generation
   counter retires a loop left by a restart; the clock is injectable) compares now with each
   persisted `next_run_at`. When due it enumerates every occurrence up to now (at most 1,000 listed;
   the rest skipped to the next one after now) and **coalesces**: with no review open, one opens for
   the first and names the rest as missed; with one open, they are folded into it and no second
   review opens (single-flight: the open review is the claim; one process dispatches, so the claim
   is the book's lock and no compare-and-set). The advanced `next_run_at`, the review and the log
   line are **one file write**, and a notice can only be read off that file afterwards, so a crash
   after the write delivers the notice once and a crash before it changes nothing. A paused cadence
   opens nothing; an occurrence that passes while paused moves the pointer and is logged `skipped`.
   The policy for the past is coalesce for every chore: a chore is reconciliation work, one run
   repairs the backlog, and replaying four missed Mondays as four reviews would be four notices for
   one job.
6. **Every decision leaves a line** (`schedule-observability`). The log is a section of the cadence
   file itself, beside the state it explains, on disk and in the brain a person copies: `set`,
   `paused`, `resumed`, `fired`, `coalesced`, `skipped`, `held`, `delivered`, `answered`, `run`,
   `recomputed`, each with the due date it is about and a sentence. It keeps the latest 40 lines
   and counts them all (`log_total`), so its size is bounded from the day it exists. No model is
   called, so no ledger row. The loop's last tick is its heartbeat, answered on the due route as
   `ticked_at`.
7. **The review is assembled with no model call** (`GET /adopt/cases/<proj>/review`, `DueReview`)
   from the case file, its cadence and its last receipt (`CaseBook.receipts`): first the cards
   that expired, then the calls that may have completed, then cards still waiting, then what was
   approved and when, then what was declined, at most 16 with `(showing N of M)`; the last run's
   close date; the next due date; the case's stored command; and the apps "Open and prepare" opens.
   An app's address is the playbook's `apps[].url` while she uses the playbook's own app; else the
   http(s) address she gave in that app's portal slot; else none, and the page says to open it
   herself. `Brief.portals` holds names, and a name is never opened as an address. A card's
   parameters and a note's text are page text, shown fenced as text.
8. **One notice per (case, due date), delivered once** (`nudge-identity-dedup`). The identity is
   the case and the occurrence the review stands for, never the text or the time it was noticed.
   `GET /adopt/chores/due` offers every open review whose notice has not been shown;
   `POST /adopt/cases/<proj>/review {due_at, answer: "seen"}` stamps `delivered_at` and it is never
   offered again. The desktop polls it from Main (`stores/due-poll.ts`, every 60 s, a lazy chunk
   off the first frame) and draws one line in **Main's dock**, beside the presence pill that
   already says "2 waiting": the existing place Main asks for attention. Rust's arrival path
   (`athena_show(focus: false)`, the tray dot) is for cards that block a turn and is not reused: a
   due chore must not raise her window or arm the card chords. The seen stamp is sent when the dock
   has **drawn** the line, so a notice delivered into a hidden window costs nothing. No Rust
   changed.
9. **Quiet hours hold the notice, never the advance** (`quiet-windows`). The window is a ritual
   too, `rituals/quiet_hours/chores.md`, written by `POST /adopt/chores/quiet {start, end,
   timezone}`; nothing read that folder before, so this is its first reader. With no file it is
   21:00 to 08:00 on this computer's clock. It is checked when the due route is asked, the moment
   of delivery, never when the review opened; it wraps midnight, its start is inside and its end is
   not, and a window whose start equals its end is never quiet, each pinned by a test. The loop
   logs the hold once per review. There is no bypass class: no chore wakes anyone. A desktop
   control for the window is not built; the route is the setting.
10. **The budget is the cadence** (`attention-budgets`). A chore comes due at most once per its own
    period and a backlog is one notice, so a person's contact per day is bounded by the chores she
    scheduled. No global daily cap is added: a person with eight weekly chores on a Monday gets
    eight dock lines, shown one at a time. A cap is the next lever if that is measured to be too
    many; it is recorded here as a known gap against the technique's two-layer structure.
11. **Ignored lowers, and only she moves it** (`efficacy-feedback`). An occurrence that comes due
    while a review she was **shown** sits unanswered adds to `unanswered`; one never shown adds
    nothing. Any answer resets it. At three (`ASK_SLOW_AFTER`) the review and its dock line ask
    "pause or slow this chore?" with "Pause it" and "Slow it" (the rule form); the cadence is never
    changed for her.
12. **"Open and prepare" stages; she sends** (README §2, §3.4 unchanged). It answers the review
    `prepare`, opens a Browser tab for each known address through the Playbooks module's own
    `actions.open` (`tabsCreate`, until now wired and undrawn), and hands the case's stored command
    to Athena's composer with the case id and a `scheduled` mark, the same hand-off as "Start for
    real" (ADR 0124). The command only: nothing of the last run goes with it (ADR 0130). No `/run`
    is made until she presses send.
13. **Her first send is `trigger_kind='schedule'`.** The active playbook carries the mark; the
    first request after it sends `trigger: "schedule"` on `POST /run` and spends the mark. The
    daemon asks the chores clock (`AthenaDaemon.schedule_claim`, bound by wiring so the daemon and
    the core never read a cadence) with the turn lock held; it agrees once per review, within 12
    hours of "prepare", and records the turn id on the review. Only then is `TurnContext.trigger`
    `schedule` (`core/ledger.TRIGGERS` gains it); a marked request it does not claim, and every
    later turn, is `cli`. Only the ledger reads the trigger: the gate and the prompt are unchanged.

## Consequences

- A case comes due on its own, at the time she chose in her own zone, and a week the daemon was off
  is one review that says how many occurrences it missed, not a pile of them.
- Nothing runs unattended: the loop writes one file and a notice; the review is read off disk with
  no model; the tabs open and the command waits in the composer for her press.
- The chore's cadence, its log and the quiet window are in the brain a person copies, and survive
  a deleted index. The receipts the review reads are the case file's (ADR 0124).
- Precision is the tick: a chore fires up to 30 s late and its notice up to 60 s after that.
- A notice is shown in Main's dock only while Main is at a depth; at the surface (depth 0) it waits
  undelivered until she dives, and is not stamped seen until it is drawn.
- `unanswered` counts occurrences, not distinct reviews, because a review stays open (and open
  reviews do not stack) until she answers it.
- A zone name this install does not know is this computer's clock. A person who sets a cadence for
  another zone on a machine without a zone database gets her own machine's local time, and the
  cadence says so in its first line.
- Tests: `tests/adopt/test_chores.py` (fake clock: three missed periods are one review naming 2
  missed; a restart after the advance notifies once; a paused cadence never fires and logs each
  skip; quiet hours hold the notice and not the advance; a weekly Monday 09:00 stays 09:00 across
  the October DST change, through the loop and through `next_after`, against a zone written in the
  test and, where installed, `Europe/Prague`; no second review while one is open; three
  unanswered asks; the first-turn claim once and within its horizon; a deleted index reconciled
  restores the cadence with no id collision; the review's order; the portal addresses never a
  name; the rule's door; the suggestion; the quiet window's pinned edges; `write_ritual`'s
  refusals), `tests/daemon/test_chores_due.py` (the routes over HTTP: the review route adds no
  ledger row and calls no model; a stale answer is 409; pause closes the review; of four turns only
  the first marked send after "prepare" is `schedule`), `tests/contracts/test_adopt_parity.py` and
  `test_ids.py` (the new shapes and the `rit_` kind), `tests/core/test_ledger.py` (`schedule` in
  `TRIGGERS`); Vitest: `scenes/chores/due.test.tsx` ("Open and prepare" calls `tabsCreate` with the
  playbook's and the case's addresses and never a name, hands the command with the case and the
  mark, and makes no `/run` request; the review lists expired and may-have-completed first; the
  pause-or-slow prompt at three and not at two; one dock notice per case and due date),
  `stores/run.test.ts` (the first send carries `trigger: "schedule"`, the next does not).

## Amended 2026-10-25

Decision 4's suggestion, for a chore that comes round once or twice a year (n of 182 days or
more), is anchored to the approved case (backlog B-C8, UAT 2026-10-23 finding 10). A yearly
chore suggested "every 365 days, first a year from today" came due wherever the year happened to
fall: a property-tax protest adopted in October came due the next October, months after the May
window closed. `cadence.suggest_for_case` reads the calendar dates in the brief's "Dates that
matter" lines (the "when" before ". If missed:"; "May 15", "15 May", "May 15, 2026", ISO) and in
her confirmed date facts; a date that names only a rule ("30 days after the notice") is not an
anchor. The first month and day that comes round after today sets the start, 14 days before it,
or tomorrow when it is closer than that; the interval stays n. The basis says which line or fact
it came from. Every other count, and a yearly chore whose case names no calendar date, gets the
times-per-year rule unchanged, and the yearly one's basis says no date was named. Still a
suggestion, written nowhere until she presses "Use the suggestion". An every-365-days rule drifts
a day per leap year; the 14-day lead absorbs that for over a decade, and a true yearly rule kind
would change the contract, so it is left out. Tests: `tests/adopt/test_chores.py` case_1 to
case_8.
