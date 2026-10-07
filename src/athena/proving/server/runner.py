"""One run at a time, in a subprocess, under a daily cap (README §9; ADR 0037).

A judge presses *start*; this module turns that into exactly the command a person would type —
``python -m athena.proving <kind> <preset flags> --nemotron-cap … --claude-cap …`` — and runs it
as a child process. A subprocess, not an in-process call, for three reasons: the run's progress
is already spoken twice on disk and on stdout (the CLI's echo lines and the run's own
``ledger.jsonl``), so tailing both gives a live stream without touching the run modules; a run
that crashes takes its own process down and not the page; and a run can be stopped by killing it.

**Money is decided here, never by the caller.** A preset names *what* runs; the caps are this
module's: the operator's per-run caps (Nemotron $1, Claude $10), each lowered to what is left of
that engine's daily cap. The day's spend is read from the runs' own records — a finished run's
``report.json`` ``cost_usd``, an unfinished one's ``ledger.jsonl`` rows — so a restart of the
server forgets nothing, and nothing here keeps a second set of books. A run may overshoot its cap
by the one call in flight when the purse ran dry (:mod:`athena.proving.budget`); the day may
overshoot by the same.

**Nothing secret leaves.** The child gets the environment minus the judge token; every line it
prints is passed through :meth:`Runner.redact` before it becomes an event, and the ledger rows
are forwarded field by field (sizes, costs, outcomes — never an excerpt of model output).

**Hosted mode** (ADR 0039) is decided once, at start: no ``claude`` CLI on PATH, or
``PROVING_HOSTED`` set, or ``--hosted``. Then only the Gauntlet runs, with ``--no-claude
--no-control``, and its Claude cap is $0, so even a call that slipped past the flags would be
refused by the purse. A Characters request raises :class:`Unavailable`. A judge may cancel the
running run (:meth:`Runner.cancel`): the child is killed and, if it wrote no report, the runner
writes a ``cancelled`` one from the ledger, so the run's spend still counts toward the day.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import IO, Any, Protocol

from athena.proving.budget import CLAUDE, DEFAULT_CAPS, ENGINES, NEMOTRON
from athena.proving.report import announce
from athena.proving.roles import HOSTED_ENV, hosted_flag

__all__ = [
    "CANCELLED",
    "DAILY_CAP_ENV",
    "DEFAULT_DAILY_CAPS",
    "EXIT_MEANING",
    "HOSTED_KINDS",
    "KINDS",
    "MAX_CALL_EVENTS",
    "PRESETS",
    "RUN_ID",
    "TOKEN_ENV",
    "Busy",
    "CapSpent",
    "Job",
    "NotRunning",
    "Runner",
    "StartFailed",
    "Unavailable",
    "cancelled_report",
    "day_spend",
    "purse_of",
    "run_spend",
    "sse_frame",
]

#: Where the judge token comes from. Absent or blank: triggering is off and the page says so.
TOKEN_ENV = "PROVING_JUDGE_TOKEN"

#: The day's caps by engine, overridable by environment (USD).
DAILY_CAP_ENV: dict[str, str] = {
    CLAUDE: "PROVING_DAILY_CAP_CLAUDE",
    NEMOTRON: "PROVING_DAILY_CAP_NEMOTRON",
}
DEFAULT_DAILY_CAPS: dict[str, float] = {CLAUDE: 15.0, NEMOTRON: 3.0}

KINDS: tuple[str, ...] = ("gauntlet", "characters")

#: What a hosted runner (no Claude) may start, and why the rest is refused (ADR 0039).
HOSTED_KINDS: tuple[str, ...] = ("gauntlet",)
HOSTED_REFUSALS: dict[str, str] = {
    "characters": (
        "Characters cannot run on this host: its persona-fidelity and rubric judges are the Haiku "
        "control, and this host runs no Claude. Recorded Characters runs are still listed."
    ),
}

#: The flags a hosted Gauntlet always carries, after its preset's.
HOSTED_FLAGS: tuple[str, ...] = ("--no-claude", "--no-control")

#: A run a judge stopped. Its exit code is whatever the kill produced; this is what it means.
CANCELLED = "cancelled"

#: Preset → the CLI flags it adds. ``default`` is the CLI's own defaults, unchanged. ``small`` is
#: the cheapest run that still exercises every stage: one generator call per surface, one attack
#: per surface per generator against Athena-on-Nemotron; one Character, one journey, two turns.
PRESETS: dict[str, dict[str, tuple[str, ...]]] = {
    "gauntlet": {
        "small": ("--n", "2", "--batch", "2", "--sample", "1", "--workers", "2", "--no-escalate"),
        "default": (),
    },
    "characters": {
        "small": (
            "--characters",
            "mira",
            "--per-character",
            "1",
            "--repeats",
            "1",
            "--nemotron-repeats",
            "1",
            "--turns",
            "2",
            "--workers",
            "2",
            "--no-escalate",
        ),
        "default": (),
    },
}

#: What each prototype's exit code means (``python -m athena.proving``'s docstring).
EXIT_MEANING: dict[str, dict[int, str]] = {
    "gauntlet": {
        0: "no gated action ran without approval",
        1: "a gated action ran without approval (a breach)",
        2: "nothing could be driven",
    },
    "characters": {
        0: "both proofs passed",
        1: "a proof failed",
        2: "no conversation was held",
    },
}

#: A run id is the run directory's name (:func:`athena.proving.report.new_run_dir`).
RUN_ID = re.compile(r"^\d{8}T\d{6}Z(?:-\d{1,4})?$")

#: The CLI's first line names the run directory.
_ANNOUNCE = re.compile(r"^(gauntlet|characters) run -> (.+)$")

#: How many ledger rows one run streams as events; the rest are counted and announced.
MAX_CALL_EVENTS = 3000

#: How long ``start`` waits for the child to name its run directory.
START_TIMEOUT_S = 60.0

#: How often the ledger is polled while a run is live.
TAIL_INTERVAL_S = 0.5

#: The ledger fields an event carries. Never ``excerpt``: that is model output, kept on disk.
_CALL_FIELDS = (
    "at",
    "role",
    "engine",
    "model",
    "input_tokens",
    "output_tokens",
    "cost_usd",
    "ms",
    "is_error",
    "error_reason",
    "schema_ok",
    "attack",
    "verdict",
    "conversation",
)


class Busy(RuntimeError):
    """A run is already going. The page answers 409."""


class CapSpent(RuntimeError):
    """The day's cap for an engine is spent. The page answers 429."""


class StartFailed(RuntimeError):
    """The child exited, or never said where it writes, before the run began."""


class Unavailable(RuntimeError):
    """This host cannot run that kind at all (hosted: no Claude). The page answers 422."""


class NotRunning(RuntimeError):
    """A cancel named a run that is not the one going. The page answers 409."""


def purse_of(engine: str) -> str | None:
    """The purse a ledger row's ``engine`` is charged to. Role clients write the purse name;
    Athena-under-test rows carry her engine's name (``nebius``, ``claude_code``)."""
    name = engine.lower()
    if name in (NEMOTRON, "nebius", "tokenfactory"):
        return NEMOTRON
    if name in (CLAUDE, "claude_code", "anthropic"):
        return CLAUDE
    return None


def run_spend(run_dir: Path) -> dict[str, float]:
    """What one run spent per purse: the report's figure when it finished, else its ledger's."""
    spent = dict.fromkeys(ENGINES, 0.0)
    report = run_dir / "report.json"
    if report.is_file():
        try:
            cost = json.loads(report.read_text(encoding="utf-8")).get("cost_usd") or {}
            for engine in ENGINES:
                spent[engine] += float(cost.get(engine) or 0.0)
            return spent
        except (OSError, ValueError, AttributeError, TypeError):
            pass  # an unreadable report falls back to the ledger, which is the raw record
    ledger = run_dir / "ledger.jsonl"
    if not ledger.is_file():
        return spent
    for line in ledger.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if not isinstance(row, dict):
            continue
        purse = purse_of(str(row.get("engine", "")))
        cost = row.get("cost_usd")
        if purse is not None and isinstance(cost, int | float) and cost > 0:
            spent[purse] += float(cost)
    return spent


def cancelled_report(
    job_kind: str, run_dir: Path, cancelled_at: str, mode: str = "full"
) -> dict[str, Any]:
    """The report a cancelled run gets when it wrote none: what it spent (from its ledger, the
    raw record), how many calls it made, and that a judge stopped it. No proof: none was read."""
    spent = run_spend(run_dir)
    calls = 0
    ledger = run_dir / "ledger.jsonl"
    if ledger.is_file():
        calls = sum(1 for line in ledger.read_text(encoding="utf-8").splitlines() if line.strip())
    return {
        "run_id": run_dir.name,
        "prototype": job_kind,
        "mode": mode,
        "status": CANCELLED,
        "cancelled": True,
        "cancelled_at": cancelled_at,
        "calls": calls,
        "cost_usd": {engine: round(spent[engine], 6) for engine in ENGINES},
        "notes": [
            "A judge cancelled this run from the trigger page; the runner killed it. No proof "
            "was evaluated, so none is reported. Its spend is read from its ledger.",
        ],
    }


def day_spend(runs_root: Path, day: str) -> dict[str, float]:
    """The day's spend per purse over every run whose id starts with ``day`` (``YYYYMMDD``,
    UTC — the run id is a UTC stamp)."""
    total = dict.fromkeys(ENGINES, 0.0)
    if not runs_root.is_dir():
        return total
    for run_dir in runs_root.iterdir():
        if run_dir.is_dir() and RUN_ID.match(run_dir.name) and run_dir.name.startswith(day):
            for engine, cost in run_spend(run_dir).items():
                total[engine] += cost
    return total


def sse_frame(seq: int, kind: str, data: Mapping[str, Any]) -> str:
    """One Server-Sent Event. ``json.dumps`` escapes every newline, so nothing a run printed can
    split a frame (ADR 0012's rule, reused)."""
    return f"id: {seq}\nevent: {kind}\ndata: {json.dumps(dict(data), sort_keys=True)}\n\n"


class Process(Protocol):
    """The slice of :class:`subprocess.Popen` the runner uses (a seam for tests)."""

    @property
    def stdout(self) -> IO[str] | None: ...

    def poll(self) -> int | None: ...

    def wait(self, timeout: float | None = None) -> int: ...

    def kill(self) -> None: ...


Spawn = Callable[[Sequence[str], Mapping[str, str], Path], Process]


def popen(argv: Sequence[str], env: Mapping[str, str], cwd: Path) -> Process:
    """Start the child with stdout and stderr merged into one UTF-8 line stream."""
    return subprocess.Popen(
        list(argv),
        cwd=str(cwd),
        env=dict(env),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )


@dataclass
class Job:
    """One run as the page sees it: its events, in order, and how it ended."""

    kind: str
    preset: str
    claude_row: bool
    caps: dict[str, float]
    started_at: str
    run_id: str = ""
    run_dir: Path | None = None
    events: list[dict[str, Any]] = field(default_factory=list)
    calls_seen: int = 0
    calls_streamed: int = 0
    exit_code: int | None = None
    exited: bool = False
    done: bool = False
    cancelled: bool = False
    hosted: bool = False
    process: Process | None = None

    def __post_init__(self) -> None:
        self.cond = threading.Condition()

    def emit(self, kind: str, data: Mapping[str, Any]) -> None:
        with self.cond:
            self.events.append({"seq": len(self.events) + 1, "kind": kind, "data": dict(data)})
            self.cond.notify_all()

    def frames(self, after: int = 0, keepalive_s: float = 15.0) -> Iterator[str]:
        """Every event after ``after``, then each new one as it lands, until the run ends."""
        index = max(after, 0)
        while True:
            with self.cond:
                while index >= len(self.events) and not self.done:
                    if not self.cond.wait(timeout=keepalive_s):
                        break
                pending = self.events[index:]
                finished = self.done
            if not pending and not finished:
                yield ": keepalive\n\n"
                continue
            for event in pending:
                yield sse_frame(event["seq"], event["kind"], event["data"])
            index += len(pending)
            if finished and index >= len(self.events):
                return

    def public(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id or None,
            "kind": self.kind,
            "preset": self.preset,
            "claude_row": self.claude_row,
            "caps_usd": self.caps,
            "started_at": self.started_at,
            "done": self.done,
            "exit_code": self.exit_code,
            "cancelled": self.cancelled,
            "mode": "hosted" if self.hosted else "full",
        }


@dataclass
class Runner:
    """Starts runs, streams them, and keeps the day's money."""

    runs_root: Path
    claude_allowed: bool = True
    env_file: str = ".env"
    uat_dir: str = "uat"
    cwd: Path = field(default_factory=Path.cwd)
    run_caps: dict[str, float] = field(default_factory=lambda: dict(DEFAULT_CAPS))
    daily_caps: dict[str, float] = field(default_factory=lambda: dict(DEFAULT_DAILY_CAPS))
    spawn: Spawn = popen
    python: str = sys.executable
    environ: Mapping[str, str] = field(default_factory=lambda: os.environ)
    clock: Callable[[], datetime] = field(default=lambda: datetime.now(UTC))
    #: Is a ``claude`` CLI on PATH? The Haiku control (generator and judge) runs through it even
    #: when the Athena-on-Claude row is off. Without it, the runner is hosted (ADR 0039).
    claude_cli: bool = field(default_factory=lambda: shutil.which("claude") is not None)
    #: ``--hosted``: run as the container does even where a ``claude`` CLI exists.
    force_hosted: bool = False

    def __post_init__(self) -> None:
        self._lock = threading.Lock()
        self.current: Job | None = None

    # -- capability ---------------------------------------------------------------------------

    @property
    def hosted(self) -> bool:
        """No Claude here: no ``claude`` CLI, or ``PROVING_HOSTED``, or ``--hosted``."""
        return self.force_hosted or hosted_flag(self.environ) or not self.claude_cli

    def kinds(self) -> tuple[str, ...]:
        return HOSTED_KINDS if self.hosted else KINDS

    def capabilities(self) -> dict[str, Any]:
        """What this host can do, decided from what it found at start. Never a value."""
        refused = {k: v for k, v in HOSTED_REFUSALS.items() if k not in self.kinds()}
        return {
            "mode": "hosted" if self.hosted else "full",
            "claude_cli": self.claude_cli,
            "hosted_flag": self.force_hosted or hosted_flag(self.environ),
            "kinds": list(self.kinds()),
            "refused": refused,
            "roles": (
                ["attacker:nemotron", "athena:athena-nemotron", "approve-probe"]
                if self.hosted
                else [
                    "attacker:nemotron",
                    "attacker:control",
                    "judge:control",
                    "athena:athena-nemotron",
                    *(["athena:athena-claude"] if self.claude_allowed else []),
                    "approve-probe",
                    "user:nemotron",
                    "judge:nemotron",
                ]
            ),
            "proof2": "n/a — hosted, no control" if self.hosted else "valid rate vs the control",
        }

    # -- money --------------------------------------------------------------------------------

    def per_run_caps(self) -> dict[str, float]:
        """The operator's per-run caps as this host applies them: Claude's is $0 when hosted."""
        return {
            engine: 0.0 if self.hosted and engine == CLAUDE else self.run_caps.get(engine, 0.0)
            for engine in ENGINES
        }

    def today(self) -> str:
        return self.clock().strftime("%Y%m%d")

    def daily(self) -> dict[str, dict[str, float]]:
        spent = day_spend(self.runs_root, self.today())
        return {
            engine: {
                "cap_usd": self.daily_caps.get(engine, 0.0),
                "spent_usd": round(spent[engine], 6),
                "remaining_usd": round(max(self.daily_caps.get(engine, 0.0) - spent[engine], 0), 6),
            }
            for engine in ENGINES
        }

    def caps_for_run(self) -> dict[str, float]:
        """This run's caps: the per-run cap, lowered to the day's remainder. Raises
        :class:`CapSpent` when any purse has nothing left today — the Claude purse too, because
        the Haiku control is on Claude even when Athena-on-Claude is off."""
        daily = self.daily()
        # Hosted, nothing runs on Claude, so its purse neither blocks a run nor funds one.
        live = (NEMOTRON,) if self.hosted else ENGINES
        spent = [engine for engine in live if daily[engine]["remaining_usd"] <= 0]
        if spent:
            names = ", ".join(
                f"{engine} ${daily[engine]['spent_usd']:.2f} of ${daily[engine]['cap_usd']:.2f}"
                for engine in spent
            )
            raise CapSpent(f"today's cap is spent ({names}); it resets at 00:00 UTC")
        return {
            engine: round(min(self.run_caps.get(engine, 0.0), daily[engine]["remaining_usd"]), 4)
            if engine in live
            else 0.0
            for engine in ENGINES
        }

    # -- secrets ------------------------------------------------------------------------------

    def secrets(self) -> list[str]:
        """Values that must never appear in a response: the provider key and the judge token."""
        values = [self.environ.get(name, "").strip() for name in ("NEBIUS_API_KEY", TOKEN_ENV)]
        return [value for value in values if len(value) >= 8]

    def redact(self, text: str) -> str:
        for value in self.secrets():
            text = text.replace(value, "[redacted]")
        return text

    def scrub(self, text: str) -> str:
        """A child's line made public: secrets redacted, and the runs directory's absolute path
        shortened to its name, so the page never shows where on the host it lives."""
        root = self.runs_root.resolve()
        for form in {str(root), root.as_posix()}:
            text = text.replace(form, root.name)
        return self.redact(text)

    # -- runs ---------------------------------------------------------------------------------

    def argv(
        self, kind: str, preset: str, claude_row: bool, caps: Mapping[str, float]
    ) -> list[str]:
        if kind not in PRESETS or preset not in PRESETS[kind]:
            raise ValueError(f"unknown run {kind}/{preset}")
        argv = [self.python, "-m", "athena.proving", kind, *PRESETS[kind][preset]]
        if self.hosted:
            argv += list(HOSTED_FLAGS)
        else:
            argv += ["--claude" if claude_row else "--no-claude"]
        argv += ["--nemotron-cap", f"{caps[NEMOTRON]:.4f}", "--claude-cap", f"{caps[CLAUDE]:.4f}"]
        argv += ["--out", str(self.runs_root), "--env-file", self.env_file]
        if kind == "characters":
            argv += ["--uat-dir", self.uat_dir]
        return argv

    def busy(self) -> bool:
        job = self.current
        return job is not None and not job.done

    def start(self, kind: str, preset: str, claude_row: bool | None = None) -> Job:
        """Start one run and return once it has named its directory. Raises :class:`Busy`,
        :class:`CapSpent`, :class:`StartFailed` or ``ValueError``."""
        if kind not in PRESETS or preset not in PRESETS[kind]:
            raise ValueError(f"unknown run {kind}/{preset}")
        if kind not in self.kinds():
            raise Unavailable(HOSTED_REFUSALS.get(kind, f"{kind} cannot run on this host"))
        row = self.claude_allowed if claude_row is None else (claude_row and self.claude_allowed)
        row = row and not self.hosted
        with self._lock:
            if self.busy():
                raise Busy("a run is already in progress; one run at a time")
            caps = self.caps_for_run()
            job = Job(kind, preset, row, caps, self.clock().isoformat(), hosted=self.hosted)
            env = {k: v for k, v in self.environ.items() if k != TOKEN_ENV}
            if self.hosted:
                env[HOSTED_ENV] = "1"  # the child decides the same way, whatever is on PATH
            env["PYTHONUNBUFFERED"] = "1"
            env["PYTHONIOENCODING"] = "utf-8"
            self.runs_root.mkdir(parents=True, exist_ok=True)
            job.process = self.spawn(self.argv(kind, preset, row, caps), env, self.cwd)
            self.current = job
        threading.Thread(target=self._read, args=(job,), daemon=True).start()
        deadline = time.monotonic() + START_TIMEOUT_S
        with job.cond:
            while not job.run_id and not job.done and time.monotonic() < deadline:
                job.cond.wait(timeout=0.25)
        if not job.run_id:
            lines = [e["data"].get("text", "") for e in job.events if e["kind"] == "line"]
            if not job.done:
                self.stop()
            raise StartFailed(" / ".join(lines[-3:]) or "the run did not start")
        return job

    def stop(self) -> None:
        job = self.current
        if job is not None and job.process is not None and job.process.poll() is None:
            job.process.kill()

    def cancel(self, run_id: str, wait_s: float = 15.0) -> Job:
        """Kill the running run ``run_id`` and wait for its ``end``. Raises :class:`NotRunning`
        when ``run_id`` is not the run going. The reader thread writes the cancelled report."""
        with self._lock:
            job = self.current
            if job is None or job.done or not job.run_id or job.run_id != run_id:
                raise NotRunning(f"{run_id} is not running; only the current run can be cancelled")
            job.cancelled = True
            if job.process is not None and job.process.poll() is None:
                job.process.kill()
        with job.cond:
            job.cond.wait_for(lambda: job.done, timeout=wait_s)
        return job

    def _read(self, job: Job) -> None:
        """The stdout reader: one ``line`` event per line, then the ledger's tail, then ``end``."""
        process = job.process
        assert process is not None
        tail = threading.Thread(target=self._tail, args=(job,), daemon=True)
        if process.stdout is not None:
            for raw in process.stdout:
                text = self.scrub(raw.rstrip("\r\n"))
                match = _ANNOUNCE.match(text)
                if match and not job.run_id:
                    candidate = Path(match.group(2).strip())
                    if RUN_ID.match(candidate.name):
                        with job.cond:
                            job.run_dir = self.runs_root / candidate.name
                            job.run_id = candidate.name
                        job.emit("start", {**job.public(), "text": text})
                        tail.start()
                        continue
                job.emit("line", {"text": text[:2000]})
        code = process.wait()
        job.exit_code = code
        job.exited = True
        if tail.ident is not None:
            tail.join(timeout=10)
        meaning = EXIT_MEANING.get(job.kind, {}).get(code, "the run failed before its report")
        if job.cancelled:
            meaning = "cancelled by a judge"
            if job.run_dir is not None and not (job.run_dir / "report.json").is_file():
                stamp = self.clock().isoformat()
                record = cancelled_report(
                    job.kind, job.run_dir, stamp, "hosted" if job.hosted else "full"
                )
                (job.run_dir / "report.json").write_text(
                    json.dumps(record, indent=2) + "\n", encoding="utf-8"
                )
        report = job.run_dir is not None and (job.run_dir / "report.json").is_file()
        dropped = job.calls_seen - job.calls_streamed
        job.emit(
            "end",
            {
                "run_id": job.run_id or None,
                "exit_code": code,
                "meaning": meaning,
                "report": report,
                "cancelled": job.cancelled or None,
                "calls": job.calls_seen,
                "footer": announce(job.calls_streamed, job.calls_seen) if dropped else None,
            },
        )
        with job.cond:
            job.done = True
            job.cond.notify_all()

    def _tail(self, job: Job) -> None:
        """Forward ledger rows as ``call`` events until the run has exited, then drain once."""
        assert job.run_dir is not None
        ledger = job.run_dir / "ledger.jsonl"
        offset = 0
        buffer = ""
        while True:
            finishing = job.exited
            if ledger.is_file():
                with ledger.open("r", encoding="utf-8", errors="replace") as handle:
                    handle.seek(offset)
                    chunk = handle.read()
                    offset = handle.tell()
                buffer += chunk
                *complete, buffer = buffer.split("\n")
                for line in complete:
                    self._call(job, line)
            if finishing:
                return
            time.sleep(TAIL_INTERVAL_S)

    def _call(self, job: Job, line: str) -> None:
        try:
            row = json.loads(line)
        except ValueError:
            return
        if not isinstance(row, dict):
            return
        job.calls_seen += 1
        if job.calls_streamed >= MAX_CALL_EVENTS:
            return
        job.calls_streamed += 1
        event = {key: row[key] for key in _CALL_FIELDS if key in row}
        purse = purse_of(str(row.get("engine", "")))
        if purse is not None:
            event["purse"] = purse
        job.emit("call", json.loads(self.redact(json.dumps(event))))

    def replay(self, run_dir: Path) -> Iterator[str]:
        """A finished run's stream, rebuilt from its ledger: its ``call`` rows, then ``end``."""
        seq = 0
        rows: list[dict[str, Any]] = []
        ledger = run_dir / "ledger.jsonl"
        if ledger.is_file():
            for line in ledger.read_text(encoding="utf-8", errors="replace").splitlines():
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if isinstance(row, dict):
                    rows.append(row)
        for row in rows[:MAX_CALL_EVENTS]:
            seq += 1
            event = {key: row[key] for key in _CALL_FIELDS if key in row}
            purse = purse_of(str(row.get("engine", "")))
            if purse is not None:
                event["purse"] = purse
            yield self.redact(sse_frame(seq, "call", event))
        seq += 1
        yield sse_frame(
            seq,
            "end",
            {
                "run_id": run_dir.name,
                "replay": True,
                "report": (run_dir / "report.json").is_file(),
                "calls": len(rows),
                "footer": announce(min(len(rows), MAX_CALL_EVENTS), len(rows)) or None,
            },
        )
