"""One table, one mint, one is_id — and no id that carries its prefix twice.

contracts/ids.py, README §3.5 (the `conv_proj_proj_<id>` lesson).
"""

from __future__ import annotations

import pytest

from athena.contracts import (
    ID_KINDS,
    ID_PREFIXES,
    ID_SUFFIX_HEX,
    conversation_for_app,
    conversation_for_project,
    is_id,
    kind_of,
    mint,
    prefix_of,
)

EXPECTED_PREFIXES = {
    "episode": "ep_",
    "fact": "fact_",
    "procedural": "proc_",
    "approval": "apr_",
    "turn": "turn_",
    "conversation": "conv_",
    "project": "proj_",
    "capture": "cap_",
    "session": "sess_",
    "job": "job_",
}


def test_the_table_is_the_one_the_design_names() -> None:
    assert ID_PREFIXES == EXPECTED_PREFIXES
    assert set(ID_KINDS) == set(ID_PREFIXES)


def test_the_table_is_plain_data_a_typescript_test_can_read() -> None:
    assert all(isinstance(k, str) and isinstance(v, str) for k, v in ID_PREFIXES.items())


@pytest.mark.parametrize("kind", ID_KINDS)
def test_mint_and_is_id_agree_for_every_prefix(kind: str) -> None:
    value = mint(kind)
    assert value.startswith(prefix_of(kind))
    assert is_id(kind, value)
    assert kind_of(value) == kind
    assert len(value) == len(ID_PREFIXES[kind]) + ID_SUFFIX_HEX[kind]


@pytest.mark.parametrize("kind", ID_KINDS)
def test_mint_is_not_a_counter(kind: str) -> None:
    assert len({mint(kind) for _ in range(64)}) == 64


@pytest.mark.parametrize("kind", ID_KINDS)
def test_an_id_of_one_kind_is_not_an_id_of_another(kind: str) -> None:
    value = mint(kind)
    assert not any(is_id(other, value) for other in ID_KINDS if other != kind)


def test_no_prefix_is_a_prefix_of_another() -> None:
    # This is what lets kind_of answer for exactly one kind.
    prefixes = list(ID_PREFIXES.values())
    for a in prefixes:
        assert not any(b != a and a.startswith(b) for b in prefixes)


def test_an_episode_id_keeps_the_rust_writers_shape() -> None:
    # Brain format parity: the Personas writer mints ep_ plus eight hex digits.
    assert ID_SUFFIX_HEX["episode"] == 8
    assert len(mint("episode")) == len("ep_") + 8


def test_a_turn_is_a_kind_because_three_tables_join_on_it() -> None:
    # The ledger's turn_id column, the events a surface rendered and the tripwires a harness
    # flagged all name the same turn. A harness minting its own would be the second place ids
    # are made, which is the finding this module answers.
    assert is_id("turn", mint("turn"))
    assert kind_of(mint("turn")) == "turn"


def test_an_unknown_kind_names_the_kinds_that_exist() -> None:
    with pytest.raises(KeyError, match="unknown id kind"):
        mint("hunch")


def test_a_project_conversation_carries_the_project_prefix_exactly_once() -> None:
    project = mint("project")
    conversation = conversation_for_project(project)
    assert conversation == f"conv_{project}"
    assert conversation.count("proj_") == 1
    assert not conversation.startswith("conv_proj_proj_")
    assert is_id("conversation", conversation)


def test_a_conversation_cannot_be_derived_from_a_bare_slug() -> None:
    # The only way to double a prefix is to hand this a slug; it refuses.
    with pytest.raises(ValueError, match="not a project id"):
        conversation_for_project("0123abcd")
    with pytest.raises(ValueError, match="not a project id"):
        conversation_for_project(mint("episode"))


def test_an_app_conversation_is_the_app_slug_once() -> None:
    assert conversation_for_app("invoicing") == "conv_invoicing"
    assert is_id("conversation", conversation_for_app("invoicing"))
    with pytest.raises(ValueError, match="lowercase slug"):
        conversation_for_app("")


def test_kind_of_says_nothing_about_a_string_that_is_not_an_id() -> None:
    assert kind_of("hello") is None
    assert kind_of("ep_notthehex") is None
