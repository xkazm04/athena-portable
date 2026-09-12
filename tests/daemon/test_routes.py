"""curl runs a turn and answers a decision — the P3 checkpoint, over real HTTP (README §5).

The assembly is the real one from ``wiring`` with one substitution: the engine is a recorded
transcript instead of a spawned CLI. Everything else — the brain, the catalog, the gate, the
approval table, the ledger, the router, the socket — is what ships.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from athena.contracts.channel import ChannelEvent
from athena.harness.cli_harness import CLAUDE, CliHarness
from athena.harness.hooks import LedgerHook, TruncationHook
from athena.harness.transports import ScriptedTransport
from athena.wiring import Assembly, Config, assemble

APP = "invoices"
ORIGIN = "https://invoices.example"

MANIFEST: dict[str, Any] = {
    "app_id": APP,
    "app_version": "1.4.0",
    "page_origin": ORIGIN,
    "tools": [
        {
            "name": "list_overdue",
            "description": "Invoices past their due date.",
            "reversible": True,
            "side_effects": "none",
        },
        {
            "name": "chase",
            "description": "Send a chase for one invoice.",
            "reversible": False,
            "side_effects": "external",
        },
    ],
}

OP_GATED = (
    'OP: {"op":"propose_action","action":"host.invoices.chase",'
    '"params":{"invoice":"INV-118"},"rationale":"it is 41 days late"}'
)


def _line(**payload: Any) -> str:
    return json.dumps(payload)


def _round(text: str) -> list[str]:
    return [
        _line(type="system", subtype="init", session_id="sess-1"),
        _line(type="assistant", message={"content": [{"type": "text", "text": text}]}),
        _line(type="result", is_error=False, usage={"input_tokens": 10, "output_tokens": 5}),
    ]


@pytest.fixture
def app(tmp_path: Path) -> Iterator[Assembly]:
    built = assemble(
        Config(brain_root=tmp_path / "brain", work_root=tmp_path / "work", token="t0ken")
    )
    # The one substitution: a recorded engine. The gate it runs behind is still the lane's.
    built.lane.harness = CliHarness(
        gate=built.lane.gate,
        ledger=LedgerHook(built.ledger),
        truncation=TruncationHook(),
        transport=ScriptedTransport([_round(f"One is very late.\n{OP_GATED}"), _round("Sent.")]),
        dialect=CLAUDE,
        prompt_root=str(tmp_path / "work"),
        cwd=str(tmp_path / "work"),
        model="claude-opus-5",
    )
    built.daemon.start()
    try:
        yield built
    finally:
        built.close()


def call(app: Assembly, path: str, *, method: str = "GET", payload: Any = None) -> tuple[int, Any]:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        f"{app.daemon.url}{path}",
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {app.daemon.token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as answer:
            return answer.status, json.loads(answer.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def stream(app: Assembly, path: str, payload: Any) -> list[ChannelEvent]:
    """Drive an SSE route and rebuild every frame through the contract's own decoder."""
    request = urllib.request.Request(
        f"{app.daemon.url}{path}",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {app.daemon.token}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as answer:
        raw = answer.read().decode("utf-8")
    return [
        ChannelEvent.from_json(line[6:]) for line in raw.splitlines() if line.startswith("data: ")
    ]


# --- setup -------------------------------------------------------------------------------------


def test_health_and_readiness_answer_before_any_page_is_open(app: Assembly) -> None:
    status, health = call(app, "/health")
    assert status == 200 and health["ok"] is True

    status, ready = call(app, "/ready")
    assert status == 200
    names = {check["name"] for check in ready["checks"]}
    assert names == {"brain", "constitution", "engine"}
    assert next(c for c in ready["checks"] if c["name"] == "brain")["state"] == "healthy"


def test_a_page_registers_its_tools_and_the_catalog_grows(app: Assembly) -> None:
    status, opened = call(app, "/sessions", method="POST", payload={"manifest": MANIFEST})
    assert status == 200
    assert opened["session"]["app_id"] == APP
    assert set(opened["registered"]) == {"host.invoices.list_overdue", "host.invoices.chase"}

    _, listed = call(app, f"/capabilities?app_id={APP}")
    by_name = {tool["name"]: tool for tool in listed["tools"]}
    assert by_name["host.invoices.chase"]["class"] == "GATED"
    assert by_name["host.invoices.list_overdue"]["class"] == "AUTO"
    assert by_name["host.invoices.chase"]["tier"] == 1


def test_a_second_origin_may_not_claim_an_app_id_already_bound(app: Assembly) -> None:
    call(app, "/sessions", method="POST", payload={"manifest": MANIFEST})
    impostor = {**MANIFEST, "page_origin": "https://not-invoices.example"}

    status, refusal = call(app, "/sessions", method="POST", payload={"manifest": impostor})

    assert status == 409
    assert refusal["error"] == "foreign_origin"


def test_a_manifest_that_fails_validation_is_refused_whole(app: Assembly) -> None:
    broken = {**MANIFEST, "tools": [{"name": "chase"}]}  # no reversible flag
    status, refusal = call(app, "/sessions", method="POST", payload={"manifest": broken})

    assert status == 409
    assert refusal["error"] == "manifest_invalid"
    _, listed = call(app, f"/capabilities?app_id={APP}")
    assert not [t for t in listed["tools"] if t["name"].startswith("host.")]


def test_closing_a_tab_drops_its_tools(app: Assembly) -> None:
    _, opened = call(app, "/sessions", method="POST", payload={"manifest": MANIFEST})
    session_id = opened["session"]["id"]

    status, closed = call(app, f"/sessions/{session_id}/close", method="POST", payload={})

    assert status == 200 and closed["dropped"] == 2
    _, listed = call(app, f"/capabilities?app_id={APP}")
    assert not [t for t in listed["tools"] if t["name"].startswith("host.")]


# --- the turn ----------------------------------------------------------------------------------


def test_curl_runs_a_turn_and_the_card_arrives_in_the_stream(app: Assembly) -> None:
    call(app, "/sessions", method="POST", payload={"manifest": MANIFEST})

    events = stream(
        app,
        "/run",
        {"message": "Chase the late one", "app_id": APP, "page_origin": ORIGIN},
    )
    kinds = [event.kind for event in events]

    assert kinds[0] == "text.delta"
    assert "decision.requested" in kinds
    assert kinds[-1] == "turn.finished"


def test_and_then_answers_the_decision(app: Assembly) -> None:
    """The other half of the P3 checkpoint: `curl` answers a card and the page is told to act."""
    call(app, "/sessions", method="POST", payload={"manifest": MANIFEST})
    stream(app, "/run", {"message": "Chase the late one", "app_id": APP, "page_origin": ORIGIN})

    status, inbox = call(app, "/decisions")
    assert status == 200 and inbox["total"] == 1
    card = inbox["decisions"][0]
    assert card["action"] == "host.invoices.chase"

    status, answered = call(
        app, f"/decisions/{card['id']}", method="POST", payload={"choice": "approve"}
    )

    assert status == 200 and answered["approved"] is True
    kinds = [event["kind"] for event in answered["events"]]
    assert kinds == ["decision.resolved", "tool.call"]
    assert answered["events"][1]["params"] == {"invoice": "INV-118"}


def test_a_decline_is_answered_and_shows_up_in_the_record(app: Assembly) -> None:
    call(app, "/sessions", method="POST", payload={"manifest": MANIFEST})
    stream(app, "/run", {"message": "Chase the late one", "app_id": APP, "page_origin": ORIGIN})
    card = call(app, "/decisions")[1]["decisions"][0]

    _, answered = call(
        app, f"/decisions/{card['id']}", method="POST", payload={"choice": "decline"}
    )
    assert answered["approved"] is False

    _, activity = call(app, "/activity")
    denied = [row for row in activity["rows"] if row["error_reason"] == "user_denied"]
    assert len(denied) == 1 and denied[0]["trigger"] == "decision"


def test_a_resolve_takes_a_choice_and_nothing_else(app: Assembly) -> None:
    """Parameters come from the row. A caller cannot spend a grant on something else."""
    call(app, "/sessions", method="POST", payload={"manifest": MANIFEST})
    stream(app, "/run", {"message": "Chase the late one", "app_id": APP, "page_origin": ORIGIN})
    card = call(app, "/decisions")[1]["decisions"][0]

    _, answered = call(
        app,
        f"/decisions/{card['id']}",
        method="POST",
        payload={"choice": "approve", "params": {"invoice": "INV-999"}},
    )

    assert answered["events"][1]["params"] == {"invoice": "INV-118"}


def test_answering_the_same_card_twice_is_a_conflict(app: Assembly) -> None:
    call(app, "/sessions", method="POST", payload={"manifest": MANIFEST})
    stream(app, "/run", {"message": "Chase the late one", "app_id": APP, "page_origin": ORIGIN})
    card = call(app, "/decisions")[1]["decisions"][0]
    call(app, f"/decisions/{card['id']}", method="POST", payload={"choice": "approve"})

    status, _ = call(app, f"/decisions/{card['id']}", method="POST", payload={"choice": "decline"})
    assert status == 409


def test_a_turn_for_an_unbound_origin_is_refused(app: Assembly) -> None:
    call(app, "/sessions", method="POST", payload={"manifest": MANIFEST})

    status, refusal = call(
        app,
        "/run",
        method="POST",
        payload={"message": "hi", "app_id": APP, "page_origin": "https://elsewhere.example"},
    )

    assert status == 409 and refusal["error"] == "foreign_origin"


def test_a_turn_with_no_message_is_a_400(app: Assembly) -> None:
    status, refusal = call(app, "/run", method="POST", payload={"app_id": APP})
    assert status == 400 and refusal["error"] == "parse_error"
