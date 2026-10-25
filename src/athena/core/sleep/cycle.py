"""One sleep cycle, phase by phase, and the journal it leaves (ADR 0143).

The cycle is handed the window admission measured and runs four phases:

1. **compress** - one leg over the oldest of this PC's episodes the caps allow
   (:meth:`~athena.core.sleep.window.Window.take`). A failed leg fails the cycle: nothing is
   written and the boundary stays where it was, so the same episodes are the next cycle's. The
   row records the failure's class and the take (ADR 0190): after a ``parse_error`` or
   ``timeout`` the next cycle takes half as many, and a single episode that failed alone twice is
   **skipped** - no leg call, the cycle settles ``partial`` past it and the journal names it. The
   episode is not deleted or hidden: it stays indexed and recallable, it is only not distilled.
2. **merge** - each candidate is shortlisted against the live memories of its kind (FTS, any
   device) and one leg judges them all. Every candidate is then written through the brain's own
   writers - the provenance gate included - as new, as superseding what the leg named, or as new
   with a contradiction proposal; a duplicate is not written and is journalled as confirmed.
   **A failed merge does not lose the compress:** the candidates are judged by the deterministic
   prefilter instead (an exact key match is a duplicate, anything else is new), the journal says
   the merge was degraded, and the cycle is ``partial``.
3. **fade** - memories unused for a month fade a step (``companion_fade``); recall ranks them lower
   and never hides them.
4. **forget proposals** (report-only, in the fade phase) - a fact faded all the way is offered to a
   person; nothing is retired here.

**Progress is committed as it is made.** Each write lands on disk at once and the cycle row's
stats are updated after it, so a cycle killed halfway leaves real memories and an honest
``running`` row. Its boundary has not moved, so the next cycle re-reads the same window; the
memories the first one wrote are then in the merge shortlists, and the judge confirms them as
duplicates rather than minting them again. The boundary moves only when the cycle settles, and only
to the newest episode actually read.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from athena.contracts.channel import iso
from athena.core.brain.store import Brain, MemoryRef, ProvenanceError
from athena.core.brain.text import fts_match
from athena.core.sleep import (
    COMPRESS_CHARS,
    COMPRESS_EPISODES,
    EPISODE_CHARS,
    FACTS_CAP,
    PROCEDURALS_CAP,
    SHORTLIST,
    SUPERSEDES_CAP,
)
from athena.core.sleep.book import (
    CycleRow,
    CycleStatus,
    Existing,
    FailureRun,
    SleepBook,
    empty_stats,
    norm_key,
)
from athena.core.sleep.legs import Candidate, Judged, LegDoor, compress, merge
from athena.core.sleep.window import Take, Window

#: Called with the phase a cycle enters (``compress``, ``merge``, ``fade``) and ``None`` at the end.
PhaseFn = Callable[[str | None], None]


@dataclass
class _Journal:
    """What a person reads afterwards. Keys only - never an episode's body."""

    written: list[str] = field(default_factory=list)
    confirmed: list[str] = field(default_factory=list)
    refused: list[str] = field(default_factory=list)
    proposals: list[str] = field(default_factory=list)
    barred: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


class SleepCycle:
    """Runs one admitted cycle over its window. The cycle row must already be ``running``."""

    def __init__(
        self,
        *,
        brain: Brain,
        book: SleepBook,
        door: LegDoor,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        on_phase: PhaseFn | None = None,
    ) -> None:
        self.brain = brain
        self.book = book
        self.door = door
        self.clock = clock
        self.on_phase = on_phase

    def run(self, cycle_id: str, window: Window, reason: str) -> CycleRow:
        """Run every phase and settle the row. Never raises for a leg or a write that failed: the
        row says ``failed`` with a sentence for a person."""
        stats = empty_stats()
        failures = self.book.failures_since_settled()
        take = window.take(failures.take_limit)
        stats.update(
            episodes_in=len(take.reads),
            episodes_available=window.episodes_available,
            chars_in=take.chars_in,
            truncated=take.truncated,
        )
        try:
            return self._run(cycle_id, window, take, reason, stats, failures)
        except Exception as exc:
            stats.update(failure="error", take=len(take.reads))
            self._finish(
                cycle_id,
                "failed",
                stats,
                reason=f"The cycle stopped: {type(exc).__name__}: {exc}"[:300],
            )
        finally:
            self._phase(None)
        row = self.book.get(cycle_id)
        assert row is not None
        return row

    # -- the phases -----------------------------------------------------------------------------

    def _run(
        self,
        cycle_id: str,
        window: Window,
        take: Take,
        reason: str,
        stats: dict[str, Any],
        failures: FailureRun,
    ) -> CycleRow:
        journal = _Journal()
        self.book.progress(cycle_id, stats)

        self._phase("compress")
        candidates: list[Candidate] = []
        skipped = failures.quarantine and len(take.reads) == 1
        if skipped:
            # The one episode the halving isolated failed alone twice: walk past it, no leg call.
            # It is parked, not removed - still indexed and recallable, only not distilled.
            (read,) = take.reads
            stats.update(skipped=1, episodes_in=0, chars_in=0)
            journal.skipped.append(
                f"episode {read.row.id} ({read.row.created_at}): the compress step failed on it "
                f"alone {failures.count} time(s) in a row; it was not distilled. It is still in "
                "memory and recall still finds it."
            )
            self.book.progress(cycle_id, stats)
        elif take.reads:
            compressed = compress(self.door, take.reads)
            if compressed.error is not None:
                # Nothing written, the boundary where it was: these episodes are the next cycle's.
                # The class and the take say whether the next cycle halves it (ADR 0190).
                stats.update(failure=compressed.error_reason or "failed", take=len(take.reads))
                self._finish(cycle_id, "failed", stats, reason=compressed.error)
                row = self.book.get(cycle_id)
                assert row is not None
                return row
            candidates = self._unbarred(compressed.candidates, stats, journal)
            stats.update(
                facts_dropped=compressed.facts_dropped,
                procedurals_dropped=compressed.procedurals_dropped,
                unknown_ids=compressed.unknown_ids,
                rejected=compressed.rejected,
            )
            self.book.progress(cycle_id, stats)

        self._phase("merge")
        degraded = False
        verdicts: dict[int, Judged] = {}
        if candidates:
            shortlists = {
                index: self.book.shortlist(
                    candidate.kind, fts_match(f"{candidate.key} {candidate.value}"), SHORTLIST
                )
                for index, candidate in enumerate(candidates)
            }
            merged = merge(self.door, candidates, shortlists)
            if merged.error is not None:
                degraded = True
                journal.notes.append(
                    f"{merged.error} Each candidate was judged by its key alone: an exact match "
                    "is a duplicate, anything else was written as new."
                )
                verdicts = self._by_key(candidates)
            else:
                verdicts = merged.verdicts
                stats["unknown_ids"] = int(stats.get("unknown_ids", 0)) + merged.unknown_ids
            self._apply(cycle_id, candidates, verdicts, shortlists, stats, journal)

        self._phase("fade")
        stats["faded"] = self.book.fade(self.clock())
        self._propose_forgetting(cycle_id, stats, journal)
        self.book.progress(cycle_id, stats)

        status: CycleStatus = "partial" if take.truncated or degraded or skipped else "completed"
        stats["merge_degraded"] = degraded
        finished = iso(self.clock())
        try:
            self.brain.write_cycle_report(
                cycle_id,
                _render(cycle_id, reason, status, window, take, stats, journal, finished),
                created=finished,
            )
        except (OSError, ValueError) as exc:
            # The journal is a record of the cycle, not the cycle: its loss is said on the row.
            stats["journal_error"] = f"{type(exc).__name__}: {exc}"[:200]
        self._finish(
            cycle_id,
            status,
            stats,
            consumed_through=take.consumed_through.encode(),
            finished_at=finished,
        )
        row = self.book.get(cycle_id)
        assert row is not None
        return row

    def _apply(
        self,
        cycle_id: str,
        candidates: list[Candidate],
        verdicts: dict[int, Judged],
        shortlists: dict[int, list[Existing]],
        stats: dict[str, Any],
        journal: _Journal,
    ) -> None:
        """Write what the merge decided, one memory at a time, committing progress after each."""
        links = 0
        for index, candidate in enumerate(candidates):
            judged = verdicts.get(index, Judged("new"))
            known = {existing.id: existing for existing in shortlists.get(index, [])}
            label = f"{candidate.kind} `{_tick(candidate.key)}`"
            if judged.decision == "duplicate":
                stats["duplicates"] += 1
                journal.confirmed.append(f"{label} confirmed {judged.ids[0]} (not written again)")
                continue
            closes: list[str] = []
            if judged.decision == "supersedes":
                room = SUPERSEDES_CAP - links
                closes = list(judged.ids[: max(0, room)])
                dropped = len(judged.ids) - len(closes)
                if dropped:
                    stats["supersedes_dropped"] = int(stats.get("supersedes_dropped", 0)) + dropped
            ref = self._write(candidate, closes, stats, journal, label)
            if ref is None:
                continue
            line = f"{label} ({ref.id}) from {len(candidate.sources)} episode(s)"
            if closes:
                links += len(closes)
                stats["supersedes"] += len(closes)
                line += f", supersedes {', '.join(closes)}"
            elif judged.decision == "supersedes":
                line += f" - written as new: the cap of {SUPERSEDES_CAP} supersede links was spent"
            if judged.decision == "contradicts":
                old = known.get(judged.ids[0])
                stats["contradictions"] += 1
                summary = (
                    f'"{_tick(candidate.key)}" ({ref.id}) and '
                    f'"{_tick(old.key if old else judged.ids[0])}" ({judged.ids[0]}) cannot both '
                    "be true. Keep both, or forget one."
                )
                proposal = self.book.open_proposal(
                    cycle_id,
                    "contradiction",
                    [ref.id, judged.ids[0]],
                    summary,
                    now=iso(self.clock()),
                )
                if proposal is None:
                    stats["proposals_dropped"] = int(stats.get("proposals_dropped", 0)) + 1
                    line += f", contradicts {judged.ids[0]} (no proposal: the queue is full)"
                else:
                    line += f", contradicts {judged.ids[0]}: proposal {proposal.id}"
            journal.written.append(line)
            self.book.progress(cycle_id, stats)

    def _write(
        self,
        candidate: Candidate,
        closes: list[str],
        stats: dict[str, Any],
        journal: _Journal,
        label: str,
    ) -> MemoryRef | None:
        """One write through the brain's own door. A refusal is counted and journalled."""
        try:
            if candidate.kind == "fact":
                ref = self.brain.write_fact(
                    candidate.key,
                    candidate.value,
                    scope=candidate.scope,
                    sources=list(candidate.sources),
                    confidence=candidate.confidence,
                    supersedes=closes,
                )
                stats["facts_written"] += 1
            else:
                ref = self.brain.write_procedural(
                    candidate.key,
                    candidate.value,
                    scope=candidate.scope,
                    sources=list(candidate.sources),
                    confidence=candidate.confidence,
                    supersedes=closes,
                )
                stats["procedurals_written"] += 1
        except (ProvenanceError, ValueError) as exc:
            stats["refused"] = int(stats.get("refused", 0)) + 1
            journal.refused.append(f"{label}: {str(exc)[:200]}")
            return None
        return ref

    def _unbarred(
        self, candidates: list[Candidate], stats: dict[str, Any], journal: _Journal
    ) -> list[Candidate]:
        """The candidates a person's forget does not bar (``SleepBook.bars``), before the merge
        sees any: a barred one is skipped, counted and journalled, never written or judged, so
        the person can see how often she wanted it back."""
        bars = self.book.bars()
        if not bars:
            return candidates
        kept: list[Candidate] = []
        for candidate in candidates:
            marker = bars.get((candidate.kind, candidate.scope, norm_key(candidate.key)))
            if marker is None:
                kept.append(candidate)
                continue
            stats["barred"] = int(stats.get("barred", 0)) + 1
            journal.barred.append(
                f"{candidate.kind} `{_tick(candidate.key)}`: forgotten at a person's decision "
                f"({marker}), so not learned again"
            )
        return kept

    def _by_key(self, candidates: list[Candidate]) -> dict[int, Judged]:
        """The deterministic prefilter a failed merge degrades to: an exact key is a duplicate."""
        verdicts: dict[int, Judged] = {}
        for index, candidate in enumerate(candidates):
            same = self.book.same_key(candidate.kind, candidate.key)
            verdicts[index] = Judged("duplicate", (same.id,)) if same else Judged("new")
        return verdicts

    def _propose_forgetting(self, cycle_id: str, stats: dict[str, Any], journal: _Journal) -> None:
        """Offer each fully faded fact for forgetting, once, while the queue has room."""
        offered = self.book.proposed("forget")
        for existing in self.book.forget_candidates():
            if existing.id in offered:
                continue
            proposal = self.book.open_proposal(
                cycle_id,
                "forget",
                [existing.id],
                f'"{_tick(existing.key)}" has not been recalled for months. Forget it?',
                now=iso(self.clock()),
            )
            if proposal is None:
                stats["proposals_dropped"] = int(stats.get("proposals_dropped", 0)) + 1
                continue
            stats["forget_proposed"] += 1
            journal.proposals.append(
                f"forget `{_tick(existing.key)}` ({existing.id}): {proposal.id}"
            )

    # -- plumbing -------------------------------------------------------------------------------

    def _finish(
        self,
        cycle_id: str,
        status: CycleStatus,
        stats: dict[str, Any],
        *,
        reason: str | None = None,
        consumed_through: str | None = None,
        finished_at: str | None = None,
    ) -> None:
        self.book.finish(
            cycle_id,
            status=status,
            finished_at=finished_at or iso(self.clock()),
            stats=stats,
            consumed_through=consumed_through,
            reason=reason,
        )

    def _phase(self, phase: str | None) -> None:
        if self.on_phase is not None:
            self.on_phase(phase)


def _tick(text: str) -> str:
    """A key fit to sit inside backticks or quotes on one line of the journal."""
    return " ".join(text.replace("`", "'").replace('"', "'").split())[:120]


def _render(
    cycle_id: str,
    reason: str,
    status: str,
    window: Window,
    take: Take,
    stats: dict[str, Any],
    journal: _Journal,
    finished: str,
) -> str:
    """The journal: what was read, written, confirmed, closed, faded, offered and dropped."""
    available = window.episodes_available
    of = f"{available}" if window.counted_all else f"at least {available}"
    lines = [
        f"# Sleep cycle {cycle_id}",
        "",
        f"Finished {finished}: **{status}**. Admitted on `{reason}`.",
        "",
        "## What was read",
        "",
        f"- {stats['episodes_in']} of {of} episodes this PC wrote since {window.boundary.at} "
        f"({stats['chars_in']:,} characters).",
    ]
    cut = sum(1 for read in take.reads if read.cut)
    if cut:
        lines.append(f"- {cut} episode(s) were cut to {EPISODE_CHARS:,} characters.")
    if take.truncated:
        lines.append(
            f"- The rest waits for the next cycle, which starts after {take.consumed_through.at} "
            f"(caps: {COMPRESS_EPISODES} episodes, {COMPRESS_CHARS:,} characters)."
        )
    else:
        lines.append("- Nothing was left for the next cycle.")
    lines += ["", "## What was written", ""]
    lines += [f"- {line}" for line in journal.written] or ["- Nothing new."]
    if journal.confirmed:
        lines += ["", "## Already known", ""]
        lines += [f"- {line}" for line in journal.confirmed]
    if journal.barred:
        lines += ["", "## Not learned again", ""]
        lines += [f"- {line}" for line in journal.barred]
    if journal.skipped:
        lines += ["", "## Skipped", ""]
        lines += [f"- {line}" for line in journal.skipped]
    lines += [
        "",
        "## Fading",
        "",
        f"- {stats['faded']} memory(ies) faded a step for a month unused.",
        f"- {stats['forget_proposed']} forget proposal(s) opened.",
    ]
    lines += [f"- {line}" for line in journal.proposals]
    dropped = _dropped(stats)
    if dropped or journal.refused:
        lines += ["", "## Dropped", ""]
        lines += [f"- {line}" for line in dropped]
        lines += [f"- refused by the brain: {line}" for line in journal.refused]
    if journal.notes:
        lines += ["", "## Notes", ""]
        lines += [f"- {line}" for line in journal.notes]
    return "\n".join(lines) + "\n"


def _dropped(stats: dict[str, Any]) -> list[str]:
    out: list[str] = []
    if stats.get("facts_dropped"):
        out.append(f"{stats['facts_dropped']} fact(s) over the cap of {FACTS_CAP}.")
    if stats.get("procedurals_dropped"):
        out.append(
            f"{stats['procedurals_dropped']} procedural(s) over the cap of {PROCEDURALS_CAP}."
        )
    if stats.get("supersedes_dropped"):
        out.append(
            f"{stats['supersedes_dropped']} supersede link(s) over the cap of {SUPERSEDES_CAP}."
        )
    if stats.get("proposals_dropped"):
        out.append(f"{stats['proposals_dropped']} proposal(s): the queue was full.")
    if stats.get("unknown_ids"):
        out.append(f"{stats['unknown_ids']} id(s) the model named that it was not shown.")
    if stats.get("rejected"):
        out.append(
            f"{stats['rejected']} candidate(s) without a valid source, key or text, or repeated."
        )
    return out
