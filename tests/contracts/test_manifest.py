"""The class is derived from the manifest's flags, and a bad manifest is refused whole.

contracts/manifest.py, README §3.3.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from athena.contracts import HostManifest, HostTool, StateReadable, ToolClass
from athena.contracts.manifest import (
    HAND_RUNNER,
    LOOPBACK_PAGE_HOSTS,
    MAX_PROPERTIES_PER_TOOL,
    MAX_TOOLS_PER_MANIFEST,
    SIDE_EFFECTS,
    page_origin_admitted,
    params_schema_problems,
)


def a_manifest(**kw: object) -> HostManifest:
    base: dict[str, object] = {
        "app_id": "invoicing",
        "app_version": "1.0",
        "page_origin": "https://invoicing.example.com",
        "tools": [HostTool(name="list_invoices", reversible=True, side_effects="none")],
    }
    base.update(kw)
    return HostManifest(**base)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("reversible", "side_effects", "expected"),
    [
        (True, "none", ToolClass.AUTO),
        (True, "internal", ToolClass.AUTO),
        (True, "external", ToolClass.GATED),
        (False, "none", ToolClass.GATED),
        (False, "internal", ToolClass.GATED),
        (False, "external", ToolClass.GATED),
    ],
)
def test_default_class_is_auto_only_when_reversible_and_not_external(
    reversible: bool, side_effects: str, expected: ToolClass
) -> None:
    tool = HostTool(name="t", reversible=reversible, side_effects=side_effects)
    assert tool.default_class() is expected


def test_a_tool_that_never_said_reversible_is_gated_meanwhile() -> None:
    assert HostTool(name="t", side_effects="none").default_class() is ToolClass.GATED


def test_the_host_cannot_argue_a_tool_out_of_gated() -> None:
    # There is no field a host could set that turns an external write into AUTO.
    for side_effects in ("none", "internal", "external"):
        tool = HostTool(name="pay", reversible=False, side_effects=side_effects)
        assert tool.default_class() is ToolClass.GATED


def test_validation_refuses_a_tool_with_no_reversible() -> None:
    manifest = a_manifest(tools=[HostTool(name="send", side_effects="external")])
    problems = manifest.validate()
    assert any("must declare reversible" in p for p in problems)
    assert not manifest.is_valid()


def test_validation_refuses_a_duplicate_tool_name() -> None:
    manifest = a_manifest(
        tools=[
            HostTool(name="send", reversible=False, side_effects="external"),
            HostTool(name="send", reversible=True, side_effects="none"),
        ]
    )
    assert any("duplicate tool" in p for p in manifest.validate())


def test_validation_refuses_an_empty_app_id() -> None:
    assert any("app_id must not be empty" in p for p in a_manifest(app_id="").validate())
    assert any("app_id must not be empty" in p for p in a_manifest(app_id="   ").validate())


def test_validation_refuses_an_unbounded_array_parameter_and_an_unbounded_readable() -> None:
    manifest = a_manifest(
        tools=[
            HostTool(
                name="tag",
                reversible=True,
                side_effects="internal",
                params_schema={"properties": {"ids": {"type": "array"}}},
            )
        ],
        state_readables=[StateReadable(name="rows")],
    )
    problems = manifest.validate()
    assert any("needs maxItems" in p for p in problems)
    assert any("needs max_chars or max_items" in p for p in problems)


def test_a_good_manifest_has_no_problems_and_namespaces_its_tools() -> None:
    manifest = a_manifest()
    assert manifest.validate() == []
    assert manifest.registry_origin == "host:invoicing"
    assert manifest.tools[0].registry_name(manifest.app_id) == "host.invoicing.list_invoices"


def test_from_dict_keeps_a_missing_reversible_missing() -> None:
    # The omission has to survive parsing, or validate() has nothing left to refuse.
    manifest = HostManifest.from_dict(
        {
            "app_id": "inbox",
            "page_origin": "https://inbox.example.com",
            "tools": [{"name": "send", "side_effects": "external"}],
        }
    )
    assert manifest.tools[0].reversible is None
    assert any("must declare reversible" in p for p in manifest.validate())


def test_a_connector_manifest_is_the_same_shape_with_a_connector_origin() -> None:
    manifest = a_manifest(app_id="gmail", origin_kind="connector", page_origin="")
    assert manifest.validate() == []
    assert manifest.registry_origin == "connector:gmail"


# --- the shape of a params_schema (council injection-resistance r1, robustness-2 and -3) -------

#: Each shape a page could post that used to merge and then break the render or the validator,
#: with the field the refusal must name.
MALFORMED_SCHEMAS: list[tuple[object, str]] = [
    ([1, 2], "params_schema"),
    ("object", "params_schema"),
    ({"properties": [1, 2]}, "properties"),
    ({"properties": {"a": 5}}, "properties"),
    ({"properties": {5: {"type": "string"}}}, "properties"),
    ({"required": 5}, "required"),
    ({"required": [["a"]]}, "required"),
    ({"required": "a"}, "required"),
    ({"properties": {"a": {"enum": "abc"}}}, "enum"),
    ({"properties": {"a": {"type": 5}}}, "type"),
    ({"properties": {"a": {"type": ["string", 5]}}}, "type"),
]


@pytest.mark.parametrize(("schema", "field"), MALFORMED_SCHEMAS)
def test_a_malformed_params_schema_refuses_the_manifest_naming_the_tool_and_field(
    schema: object, field: str
) -> None:
    tool = HostTool(name="tag", reversible=True, side_effects="none")
    tool.params_schema = schema  # type: ignore[assignment]
    problems = a_manifest(tools=[tool]).validate()
    assert any("'tag'" in p and field in p for p in problems), problems


def test_a_well_formed_params_schema_has_no_shape_problem() -> None:
    schema = {
        "type": "object",
        "properties": {
            "status": {"type": "string", "enum": ["open", "paid"]},
            "amount": {"type": ["number", "null"]},
            "ids": {"type": "array", "items": {"type": "string"}, "maxItems": 5},
        },
        "required": ["status"],
        "additionalProperties": False,
    }
    tool = HostTool(name="tag", reversible=True, side_effects="none", params_schema=schema)
    assert a_manifest(tools=[tool]).validate() == []
    assert params_schema_problems({}) == []


# --- how many tools and parameters one manifest may carry (economics-1, ADR 0070) -------------


def _tool(name: str, properties: int = 0) -> HostTool:
    schema = {
        "type": "object",
        "properties": {f"p{n}": {"type": "string"} for n in range(properties)},
    }
    return HostTool(name=name, reversible=True, side_effects="none", params_schema=schema)


def test_a_tool_with_a_thousand_parameters_refuses_the_manifest() -> None:
    problems = a_manifest(tools=[_tool("wide", 1000)]).validate()
    assert any("'wide'" in p and "1000 parameters" in p for p in problems), problems


def test_a_manifest_with_too_many_tools_is_refused() -> None:
    tools = [_tool(f"t{n}") for n in range(MAX_TOOLS_PER_MANIFEST + 1)]
    problems = a_manifest(tools=tools).validate()
    assert any(f"{MAX_TOOLS_PER_MANIFEST + 1} tools" in p for p in problems), problems


def test_a_manifest_at_both_caps_is_accepted() -> None:
    tools = [_tool(f"t{n}", MAX_PROPERTIES_PER_TOOL) for n in range(MAX_TOOLS_PER_MANIFEST)]
    assert a_manifest(tools=tools).validate() == []


def test_the_caps_stand_above_the_largest_manifests_the_repo_ships() -> None:
    """ADR 0070's measured maxima: Ledgerbox's 32 page tools plus the 9 hands, and Hirelane's
    search_candidates with 8 parameters. A cap at or under them would refuse a real page."""
    assert MAX_TOOLS_PER_MANIFEST >= 2 * 41
    assert MAX_PROPERTIES_PER_TOOL >= 2 * 8


# --- the two words the TypeScript spells by hand (README §3.3, §3.4 tier 2) --------------------

_ROOT = Path(__file__).resolve().parents[2]
_COMMENTS = re.compile(r"/\*.*?\*/|//[^\n]*", re.DOTALL)


def _exported(relative: str, name: str) -> str:
    """The source of ``export const <name> = ...;`` in a TypeScript or JavaScript file, comments
    removed, so a sentence that mentions the word cannot stand in for the declaration."""
    source = _COMMENTS.sub("", (_ROOT / relative).read_text(encoding="utf-8"))
    match = re.search(rf"export const {name}\s*=(.*?);", source, re.DOTALL)
    assert match is not None, f"{relative} does not export {name}"
    return match.group(1)


def test_the_hand_marker_is_the_word_the_desktop_writes() -> None:
    """``lib/hands.ts`` puts ``runner: HAND_RUNNER`` on every hand it appends, and the catalog
    reports a host tool at tier 2 only when its ``runner`` is this word. A drift on either side
    files every hand at tier 1 and nothing fails."""
    declared = re.findall(r'"([^"]*)"', _exported("apps/desktop/src/lib/hands.ts", "HAND_RUNNER"))
    assert declared == [HAND_RUNNER]


def test_the_side_effects_vocabulary_is_the_one_the_bridge_reads() -> None:
    """``gate.js`` decides a page's flags against ``SIDE_EFFECTS`` before a manifest is built;
    a member on one side only is a flag one half accepts and the other refuses."""
    body = _exported("packages/athena-bridge/gate.js", "SIDE_EFFECTS")
    assert tuple(re.findall(r'"([^"]*)"', body)) == SIDE_EFFECTS
    assert "Object.freeze([" in body


# --- where a page may register from (README §3.3, ADR 0119) ------------------------------------

#: One accept/refuse table for the page origin rule. ``apps/desktop/src/lib/manifest.test.ts``
#: reads these two tuples out of this file and holds ``registrable`` to every row, so a row added
#: here is a row both sides answer.
PAGE_ORIGINS_ADMITTED = (
    "http://localhost:3001",
    "https://ledger.test",
)
PAGE_ORIGINS_REFUSED = (
    "http://localhost.evil.example",
    "http://localhostile.net",
    "https://",
    "http://example.com",
    "http://localhost:99999",
    # Refused before ADR 0119 as well; admitting it widens who may register (an owner call).
    "http://127.0.0.1:3001",
)


@pytest.mark.parametrize("origin", PAGE_ORIGINS_ADMITTED)
def test_a_page_on_tls_or_this_machine_may_register(origin: str) -> None:
    assert page_origin_admitted(origin)
    assert a_manifest(page_origin=origin).validate() == []


@pytest.mark.parametrize("origin", PAGE_ORIGINS_REFUSED)
def test_a_plain_http_host_that_only_starts_with_localhost_is_refused(origin: str) -> None:
    """The rule is read off the parsed host, never off a prefix of the string: a prefix admits
    ``http://localhost.evil.example``, a page a network attacker can rewrite in transit."""
    assert not page_origin_admitted(origin)
    assert any("page_origin" in problem for problem in a_manifest(page_origin=origin).validate())


def test_the_loopback_hosts_are_the_ones_the_desktop_offers() -> None:
    """``lib/manifest.ts`` decides which tabs are offered with its own copy of the host list; a
    host on one side only is a manifest the shell offers and the daemon refuses, or the reverse."""
    declared = re.findall(
        r'"([^"]*)"', _exported("apps/desktop/src/lib/manifest.ts", "LOOPBACK_PAGE_HOSTS")
    )
    assert tuple(declared) == LOOPBACK_PAGE_HOSTS
