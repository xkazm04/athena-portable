"""A ``name`` / ``tool`` value beside an explicit action is a parameter (ADR 0050 amendment)."""

from __future__ import annotations

import json

from athena.harness.op_grammar import Op, parse_op


def _op(**fields: object) -> Op:
    parsed = parse_op(json.dumps(fields))
    assert isinstance(parsed, Op)
    return parsed


def test_name_beside_action_is_kept_as_a_param() -> None:
    op = _op(op="propose_action", action="host.crm.add_contact", name="Bob", email="b@x.io")
    assert op.action == "host.crm.add_contact"
    assert op.params == {"name": "Bob", "email": "b@x.io"}
    assert op.repairs == ("params_at_top",)


def test_name_alone_beside_action_is_a_param() -> None:
    op = _op(op="propose_action", action="host.crm.add_contact", name="Bob")
    assert op.params == {"name": "Bob"}


def test_tool_value_not_tool_shaped_is_a_param() -> None:
    op = _op(op="propose_action", action="host.crm.log_call", tool="chase")
    assert op.params == {"tool": "chase"}


def test_tool_shaped_name_beside_action_is_not_a_param() -> None:
    op = _op(op="propose_action", action="host.crm.add_contact", name="host.bank.scheduled")
    assert op.params == {}
    assert op.repairs == ()


def test_explicit_params_keep_name_out() -> None:
    op = _op(op="propose_action", action="host.crm.add_contact", name="Bob", params={"a": 1})
    assert op.params == {"a": 1}


def test_name_repair_without_action_is_unchanged() -> None:
    op = _op(op="call", name="host.bank.scheduled")
    assert op.action == "host.bank.scheduled"
    assert op.params == {}
    assert op.repairs == ("name_field_names_tool",)
