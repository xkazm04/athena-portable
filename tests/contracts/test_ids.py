"""One table, one mint, one is_id — and no id that carries its prefix twice.

contracts/ids.py, README §3.5 (the `conv_proj_proj_<id>` lesson).
"""

from __future__ import annotations

import re
from pathlib import Path

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


STORE_RS = (
    Path(__file__).resolve().parents[2] / "apps" / "desktop" / "src-tauri" / "src" / "store.rs"
)


def _rust_code(source: str) -> str:
    """``source`` with its ``//`` and ``/* */`` comments blanked, string literals kept.

    store.rs explains its mint in prose right above the mint, so a match over raw text would be
    satisfied by a comment that names the right width while the code formats another. Strings are
    walked rather than regexed because ``"https://a.test"`` holds a ``//`` that is not a comment.
    """
    out: list[str] = []
    i, n = 0, len(source)
    while i < n:
        ch = source[i]
        if source.startswith("//", i):
            end = source.find("\n", i)
            i = n if end == -1 else end
        elif source.startswith("/*", i):
            end = source.find("*/", i + 2)
            i = n if end == -1 else end + 2
            out.append(" ")
        elif raw := re.match(r'r(#*)"', source[i:]):
            close = '"' + raw.group(1)
            end = source.find(close, i + raw.end())
            stop = n if end == -1 else end + len(close)
            out.append(source[i:stop])
            i = stop
        elif ch == '"':
            j = i + 1
            while j < n and source[j] != '"':
                j += 2 if source[j] == "\\" else 1
            out.append(source[i : j + 1])
            i = j + 1
        elif char := re.match(r"'(?:\\.|[^\\'])'", source[i:]):
            out.append(char.group(0))
            i += char.end()
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def test_comment_stripping_keeps_strings_and_drops_comments() -> None:
    code = _rust_code(
        'let a = "https://a.test"; // format!("{:016x}")\n/* {:016x} */ let b = \'"\';'
    )
    assert '"https://a.test"' in code
    assert "016x" not in code
    assert "'\"'" in code


def test_the_shells_capture_id_is_the_shape_this_table_accepts() -> None:
    # The desktop shell mints the one id that crosses this seam from Rust: a capture, filed by
    # store.rs and handed to POST /run as capture_id. The daemon keeps it only when is_id says so,
    # so a width that differs here is a card that never shows its screenshot.
    code = _rust_code(STORE_RS.read_text(encoding="utf-8"))
    table = re.search(
        r'name:\s*"captures".*?key_mode:\s*KeyMode::Minted\("([a-z]+)"\)', code, re.DOTALL
    )
    assert table, "store.rs files captures under a minted key"
    assert table.group(1) + "_" == ID_PREFIXES["capture"]

    body = re.search(r"fn mint_id\(.*?\n\}", code, re.DOTALL)
    assert body, "store.rs mints its ids in mint_id"
    widths = re.findall(r'format!\(\s*"\{prefix\}_\{:0(\d+)x\}"', body.group(0))
    assert widths == [str(ID_SUFFIX_HEX["capture"])], widths
