"""``POST /manifest`` with the nine generic hands under a derived id (README §3.4 tier 2, ADR 0065).

The body is what ``gate.js``'s ``manifestOf`` makes of ``webmcp_tools()`` for a page that
registered nothing and published no ``athena:app``: the app id is the shell's derived form of the
web origin, and the tools are the hands. The daemon must take it whole and classify each hand from
its flags, not from its name.
"""

from __future__ import annotations

from typing import Any

from .conftest import Live

DERIVED_ID = "web_https_sledger_dtest"
PAGE = "https://ledger.test"

_REF = {"type": "string", "maxLength": 64}

# (name, reversible, side_effects, input_schema): the table in ``hands.rs``, in its order.
_HANDS: list[tuple[str, bool, str, dict[str, Any]]] = [
    ("page_read", True, "none", {"type": "object", "properties": {"ref": _REF}}),
    (
        "page_find",
        True,
        "none",
        {
            "type": "object",
            "properties": {
                "query": {"type": "string", "maxLength": 200},
                "role": {"type": "string", "maxLength": 40},
            },
        },
    ),
    (
        "page_wait",
        True,
        "none",
        {
            "type": "object",
            "properties": {
                "text": {"type": "string", "maxLength": 200},
                "timeout_ms": {"type": "integer", "minimum": 100, "maximum": 15000},
            },
            "required": ["text"],
        },
    ),
    (
        "page_scroll",
        True,
        "internal",
        {
            "type": "object",
            "properties": {"ref": _REF, "direction": {"type": "string", "enum": ["up", "down"]}},
        },
    ),
    (
        "page_click",
        False,
        "internal",
        {"type": "object", "properties": {"ref": _REF}, "required": ["ref"]},
    ),
    (
        "page_fill",
        False,
        "internal",
        {
            "type": "object",
            "properties": {"ref": _REF, "value": {"type": "string", "maxLength": 2000}},
            "required": ["ref", "value"],
        },
    ),
    (
        "page_select",
        False,
        "internal",
        {
            "type": "object",
            "properties": {"ref": _REF, "value": {"type": "string", "maxLength": 2000}},
            "required": ["ref", "value"],
        },
    ),
    (
        "page_submit",
        False,
        "internal",
        {"type": "object", "properties": {"ref": _REF}, "required": ["ref"]},
    ),
    ("page_screenshot", True, "none", {"type": "object", "properties": {}}),
]

_GATED = {"page_click", "page_fill", "page_select", "page_submit"}


def hands_manifest(app_id: str = DERIVED_ID, page_origin: str = PAGE) -> dict[str, Any]:
    return {
        "app_id": app_id,
        "app_version": "0",
        "page_origin": page_origin,
        "generated_at": "2026-10-10T00:00:00.000Z",
        "origin_kind": "host",
        "transport_detected": "",
        "state_readables": [],
        "tools": [
            {
                "name": name,
                "description": f"{name}.",
                "input_schema": schema,
                "reversible": reversible,
                "side_effects": side_effects,
                "transport": "webmcp",
                "inferred_from": "athena",
            }
            for name, reversible, side_effects, schema in _HANDS
        ],
    }


def test_the_nine_hands_under_a_derived_id_are_merged_and_classified_from_their_flags(
    live: Live,
) -> None:
    reply = live.request("/manifest", method="POST", json_body=hands_manifest())

    assert reply.status == 200, reply.body
    body = reply.body
    assert body["app_id"] == DERIVED_ID
    assert body["origin"] == PAGE
    assert body["registry_origin"] == f"host:{DERIVED_ID}"
    classes = {tool["name"]: tool["class"] for tool in body["tools"]}
    assert classes == {
        f"host.{DERIVED_ID}.{name}": "GATED" if name in _GATED else "AUTO" for name, *_ in _HANDS
    }
    assert body["total"] == 9


def test_the_session_is_pinned_to_the_web_origin_the_derived_id_names(live: Live) -> None:
    live.request("/manifest", method="POST", json_body=hands_manifest())

    session = live.daemon.sessions.get(PAGE)
    assert session is not None
    assert (session.app_id, session.tools) == (DERIVED_ID, 9)
    assert live.daemon.gate.policy.pinned_origins == {DERIVED_ID: PAGE}


# -- the tier (ADR 0066) ---------------------------------------------------------------------------


def _with_page_tool(marked: bool, *, hands_marked: bool = True) -> dict[str, Any]:
    body = hands_manifest("ledger")
    if hands_marked:
        for tool in body["tools"]:
            tool["runner"] = "shell"
    page_tool: dict[str, Any] = {
        "name": "pay",
        "description": "Pay.",
        "input_schema": {"type": "object"},
        "reversible": False,
        "side_effects": "external",
        "transport": "webmcp",
    }
    if marked:
        page_tool["runner"] = "shell"
    body["tools"] = [page_tool, *body["tools"]]
    return body


def test_the_hands_the_shell_appended_are_tier_2_and_a_pages_own_tool_stays_tier_1(
    live: Live,
) -> None:
    reply = live.request("/manifest", method="POST", json_body=_with_page_tool(False))

    assert reply.status == 200, reply.body
    tiers = {tool["name"]: tool["tier"] for tool in reply.body["tools"]}
    assert tiers.pop("host.ledger.pay") == 1
    assert set(tiers) == {f"host.ledger.{name}" for name, *_ in _HANDS}
    assert set(tiers.values()) == {2}
    assert live.daemon.catalog.get("host.ledger.page_click").tier == 2


def test_a_manifest_with_no_marker_reports_every_tool_tier_1(live: Live) -> None:
    reply = live.request("/manifest", method="POST", json_body=hands_manifest())

    assert {tool["tier"] for tool in reply.body["tools"]} == {1}


def test_the_marker_changes_the_tier_and_never_the_class(live: Live) -> None:
    reply = live.request("/manifest", method="POST", json_body=_with_page_tool(True))

    by_name = {tool["name"]: tool for tool in reply.body["tools"]}
    assert by_name["host.ledger.pay"]["class"] == "GATED"
    assert by_name["host.ledger.page_click"]["class"] == "GATED"
    assert by_name["host.ledger.page_read"]["class"] == "AUTO"
