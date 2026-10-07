"""A CLI engine calls tools by printing lines, so the parser is the calling convention.

Every repair rule gets its own test, because a repair is a place where the parser decides what the
model *meant*. Three rules are three decisions; a fourth would be a guess, and the last test here
is the one that says so.
"""

from __future__ import annotations

from athena.harness.op_grammar import MAX_BRACE_REPAIR, Op, OpError, parse_op, parse_turn


def test_a_clean_envelope_parses_and_leaves_the_prose_behind() -> None:
    text = (
        "Looking at the invoices now.\n"
        'OP: {"op":"propose_action","action":"host.invoices.chase","params":{"id":7},'
        '"rationale":"thirty-one days late"}\n'
        "I will report back."
    )
    parsed = parse_turn(text)
    assert parsed.text == "Looking at the invoices now.\nI will report back."
    assert len(parsed.ops) == 1
    op = parsed.ops[0]
    assert op.action == "host.invoices.chase"
    assert op.params == {"id": 7}
    assert op.rationale == "thirty-one days late"
    assert op.repairs == ()
    assert parsed.errors == ()


def test_the_first_tts_line_wins_and_is_stripped() -> None:
    parsed = parse_turn('TTS: "Two are overdue."\nHere they are.\nTTS: "ignore me"')
    assert parsed.tts == "Two are overdue."
    assert parsed.text == "Here they are."


def test_repair_a_trailing_comma() -> None:
    parsed = parse_op('{"op":"propose_action","action":"core.checkpoint","params":{"text":"x",},}')
    assert isinstance(parsed, Op)
    assert parsed.params == {"text": "x"}
    assert parsed.repairs == ("trailing_comma",)
    assert parsed.repaired


def test_repair_an_unquoted_key() -> None:
    parsed = parse_op('{op:"propose_action", action:"core.checkpoint", params:{text:"x"}}')
    assert isinstance(parsed, Op)
    assert parsed.action == "core.checkpoint"
    assert parsed.params == {"text": "x"}
    assert parsed.repairs == ("unquoted_key",)


def test_repair_a_missing_closing_brace_at_the_end_of_the_output() -> None:
    parsed = parse_op('{"op":"propose_action","action":"core.checkpoint","params":{"text":"x"}')
    assert isinstance(parsed, Op)
    assert parsed.params == {"text": "x"}
    assert parsed.repairs == ("closing_brace",)


def test_repairs_combine_and_are_all_named() -> None:
    parsed = parse_op('{op:"propose_action", action:"core.checkpoint", params:{text:"x",}')
    assert isinstance(parsed, Op)
    assert parsed.params == {"text": "x"}
    assert parsed.repairs == ("unquoted_key", "trailing_comma", "closing_brace")


def test_a_repair_never_edits_inside_a_string() -> None:
    """The rationale is prose. ``a: b,`` inside it is not a key and not a trailing comma."""
    parsed = parse_op(
        '{op:"propose_action", action:"core.checkpoint", '
        '"rationale":"weighed a: b, then c: d,", params:{text:"x"}}'
    )
    assert isinstance(parsed, Op)
    assert parsed.rationale == "weighed a: b, then c: d,"


def test_a_deeper_truncation_is_a_reject_carrying_the_line() -> None:
    raw = '{"op":"propose_action","action":"core.checkpoint","params":{"a":{"b":{"c":{"d":1'
    parsed = parse_op(raw)
    assert isinstance(parsed, OpError)
    assert parsed.line == raw
    assert parsed.reason == "parse_error"
    assert MAX_BRACE_REPAIR == 3


def test_a_rejected_envelope_keeps_the_offending_line_and_the_prose() -> None:
    parsed = parse_turn('On it.\nOP: {"op":"propose_action","action":\nStill here.')
    assert parsed.ops == ()
    assert len(parsed.errors) == 1
    assert parsed.errors[0].line == '{"op":"propose_action","action":'
    assert parsed.errors[0].detail
    assert parsed.text == "On it.\nStill here."


def test_an_envelope_with_no_op_field_is_rejected() -> None:
    parsed = parse_op('{"action":"core.checkpoint"}')
    assert isinstance(parsed, OpError)
    assert "no 'op'" in parsed.detail


def test_propose_action_without_an_action_name_is_rejected() -> None:
    parsed = parse_op('{"op":"propose_action","params":{}}')
    assert isinstance(parsed, OpError)
    assert "needs an 'action' naming the tool" in parsed.detail


def test_any_verb_without_an_action_is_rejected_with_the_shape_that_works() -> None:
    """A model that wrote {"op":"call","tool":...} used to reach the catalog as the name ''."""
    parsed = parse_op('{"op":"call","tool":"host.cedar.list_statements"}')
    assert isinstance(parsed, OpError)
    assert '{"op":"propose_action","action":' in parsed.detail


def test_a_bare_envelope_with_no_marker_is_still_read() -> None:
    parsed = parse_turn('{"op":"propose_action","action":"core.checkpoint","params":{"text":"x"}}')
    assert len(parsed.ops) == 1
    assert parsed.text == ""


def test_an_envelope_after_prose_on_the_same_line_keeps_the_prose() -> None:
    parsed = parse_turn('Marking it. OP: {"op":"checkpoint","action":"core.checkpoint"}')
    assert parsed.text == "Marking it."
    assert len(parsed.ops) == 1


def test_a_tool_named_in_op_is_read_as_propose_action_on_it() -> None:
    """ADR 0046: the lien-desk run wrote {"op":"host.gcpay.list_pay_apps"} for whole turns."""
    parsed = parse_op('{"op":"host.gcpay.list_pay_apps","params":{"page":2}}')
    assert isinstance(parsed, Op)
    assert (parsed.op, parsed.action, parsed.params) == (
        "propose_action",
        "host.gcpay.list_pay_apps",
        {"page": 2},
    )
    assert parsed.repairs == ("op_names_tool",)


def test_a_verb_that_is_not_a_tool_name_is_still_refused() -> None:
    for verb in ("call", "read", "host", "hostile.thing", "host.gcpay.list.pay.apps"):
        parsed = parse_op(f'{{"op":"{verb}","params":{{}}}}')
        assert isinstance(parsed, OpError), verb
