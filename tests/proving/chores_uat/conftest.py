"""A scripted Claude for the chores UAT harness. Nothing here spawns ``claude``.

Legs are told apart by the system prompt file each ran with — the studio's interviewer, auditor,
brief writer and shaper, and the harness's case writer, voiced person and judge — and each kind
answers from its own queue (the last answer repeats). A queued value may be a callable of the
prompt, so the person can answer whatever card ids the loop minted.
"""

from __future__ import annotations

import json
import re
import threading
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from athena.adopt.prompts import AUDIT_SYSTEM, BRIEF_SYSTEM, INTERVIEW_SYSTEM
from athena.adopt.session import reset_hooks
from athena.adopt.showcase import SHAPE_SYSTEM
from athena.adopt.slots import playbooks_root
from athena.harness.transports import CliRequest
from athena.proving.chores_uat.cases import CASE_SYSTEM
from athena.proving.chores_uat.judge import JUDGE_SYSTEM
from athena.proving.chores_uat.rig import Rig
from athena.proving.chores_uat.run import PERSONA_SYSTEM
from athena.proving.runlog import RunLog

from ..adopt_tiers.conftest import FakeWarm, stream_lines

HERE = Path(__file__).parent
UAT = HERE / "fixtures" / "uat"
LIBRARY = playbooks_root()

SYSTEMS = {
    INTERVIEW_SYSTEM: "interview",
    AUDIT_SYSTEM: "audit",
    BRIEF_SYSTEM: "brief",
    SHAPE_SYSTEM: "shape",
    CASE_SYSTEM: "case",
    PERSONA_SYSTEM: "persona",
    JUDGE_SYSTEM: "judge",
}


@dataclass
class Call:
    kind: str
    prompt: str
    argv: list[str]


@dataclass
class FakeModel:
    script: dict[str, list[Any]] = field(default_factory=dict)
    calls: list[Call] = field(default_factory=list)

    def __post_init__(self) -> None:
        self._lock = threading.Lock()

    def answer(self, argv: Sequence[str], prompt: str) -> str:
        path = argv[list(argv).index("--system-prompt-file") + 1]
        kind = SYSTEMS.get(Path(path).read_text(encoding="utf-8"), "other")
        with self._lock:
            self.calls.append(Call(kind, prompt, list(argv)))
            pending = self.script.get(kind) or ["{}"]
            value = pending.pop(0) if len(pending) > 1 else pending[0]
        if callable(value):
            value = value(prompt)
        return value if isinstance(value, str) else json.dumps(value)

    def prompts(self, kind: str) -> list[str]:
        with self._lock:
            return [c.prompt for c in self.calls if c.kind == kind]

    def argvs(self, kind: str) -> list[list[str]]:
        with self._lock:
            return [c.argv for c in self.calls if c.kind == kind]


@dataclass
class FakeTransport:
    model: FakeModel

    async def run(self, request: CliRequest) -> Any:
        for line in stream_lines(self.model.answer(request.argv, request.stdin)):
            yield line


def make_rig(run_dir: Path, model: FakeModel, **kw: Any) -> Rig:
    kw.setdefault("library", LIBRARY)
    return Rig(
        run_dir=run_dir,
        transport=lambda: FakeTransport(model),
        spawn_warm=lambda argv, cwd: FakeWarm(model, argv),  # type: ignore[arg-type]
        runlog=RunLog(run_dir / "ledger.jsonl"),
        **kw,
    )


# --- a lease-end conversation that clears after one card ------------------------------------------

CARD = {
    "say": "A few things first.",
    "questions": [
        {
            "slot_ids": ["p1"],
            "text": "Do Torvane's letters come to Postwren, or somewhere else?",
            "options": [{"id": "a", "label": "Postwren"}, {"id": "b", "label": "Gmail"}],
        },
        {"slot_ids": ["p2"], "text": "Is the return inspection in Linestone Inspect?"},
    ],
}

DERIVE = {
    "new_slots": [
        {"kind": "fact", "label": "When the car was returned", "value": ""},
        {"kind": "fact", "label": "Photos of the car before it was returned", "value": ""},
        {"kind": "trap", "label": "Whether the mileage charge is right", "value": ""},
    ],
    "updates": [],
    "open_slot_ids": ["p1", "p2", "f1"],
}

CLEAR = {
    "updates": [
        {"slot_id": "p1", "value": "Gmail", "status": "confirmed"},
        {"slot_id": "p2", "value": "Linestone Inspect", "status": "confirmed"},
        {"slot_id": "p3", "value": "Google Photos", "status": "confirmed"},
        {"slot_id": "p4", "value": "Torvane Finance", "status": "confirmed"},
        {"slot_id": "f1", "value": "3 September 2026", "status": "confirmed"},
        {"slot_id": "f2", "value": "Yes, twelve photos", "status": "confirmed"},
        {"slot_id": "t1", "value": "About 900 over", "status": "confirmed"},
    ],
    "open_slot_ids": [],
}

STILL_OPEN = {"updates": [], "open_slot_ids": ["p1", "f1"]}


def persona_answer(prompt: str) -> dict[str, Any]:
    """Answers every question id on the card in the prompt, with an aside."""
    ids = list(dict.fromkeys(re.findall(r"^(r\d+q\d+):", prompt, flags=re.MULTILINE)))
    return {
        "answers": [{"question_id": i, "choice_ids": [], "text": "I don't know."} for i in ids],
        "aside": "I was not sure what Postwren is.",
    }


def judge_answer(criteria: int = 5, turn: int = 1) -> dict[str, Any]:
    return {
        "criteria": [
            {"n": n, "text": "x", "pass": [True, False, None][n % 3], "why": "seen"}
            for n in range(1, criteria + 1)
        ],
        "voice": " ".join(["word"] * 100),
        "adopt": "maybe",
        "understood": "She will dispute the parts of the bill the lease does not support.",
        "findings": [
            {
                "type": "confusion",
                "dimension": "clarity",
                "title": "Postwren was never explained",
                "expected": "A word on what Postwren is",
                "got": "The name alone",
                "evidence": [f"turn:{turn}"],
                "severity_hint": "minor",
            }
        ],
        "time_saved_min_est": 60,
        "confidence": "med",
    }


def clearing_script() -> dict[str, list[Any]]:
    return {
        "interview": [CARD, {"questions": []}],
        "audit": [DERIVE, CLEAR],
        "brief": [{"lead": "I'll dispute what the lease does not support.", "claim": ["x"]}],
        "persona": [persona_answer],
        "judge": [judge_answer()],
        "shape": [{"today": "", "rows": [], "note": "renames only"}],
    }


def stub_rehearsal(found: float | None = 100.0) -> Callable[..., Any]:
    """A rehearsal door that emits a done event and answers a bench-shaped report."""
    from athena.contracts.adopt import Showcase as ShowcaseEvent

    def rehearse(rig: Rig, session: Any, rev: int) -> dict[str, Any]:
        session.emit(ShowcaseEvent(status="done", turn=4, total=4, found_usd=found))
        return {"turns": 4, "wall_s": 61.5, "cost_usd": 1.25, "cards": [{}, {}, {}]}

    return rehearse


@pytest.fixture(autouse=True)
def _clean_hooks() -> Any:
    reset_hooks()
    yield
    reset_hooks()
