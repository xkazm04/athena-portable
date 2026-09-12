"""The catalog is the policy: the class is derived, the merge is whole, the block is generated.

core/catalog.py, README §3.3 and §3.4, ADR 0004.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any

import pytest

from athena.contracts import HostManifest, Lane, ToolClass, TurnContext
from athena.core.catalog import Catalog, CatalogError, CoreServices, build_catalog

CTX = TurnContext(conversation_id="conv_invoices", turn_id="turn-1")

LIVE_EPISODE = "ep_0000beef"


def services(*live: str) -> CoreServices:
    """Core services whose only wired port is the provenance one the gate needs."""

    def sources_alive(sources: Sequence[str]) -> bool:
        return bool(sources) and all(source in (live or (LIVE_EPISODE,)) for source in sources)

    return CoreServices(sources_alive=sources_alive)


def manifest(app_id: str = "invoices", **overrides: Any) -> HostManifest:
    payload: dict[str, Any] = {
        "app_id": app_id,
        "page_origin": "https://invoices.example",
        "tools": [
            {
                "name": "list_invoices",
                "description": "List invoices.",
                "reversible": True,
                "side_effects": "none",
                "params_schema": {
                    "type": "object",
                    "properties": {"status": {"type": "string", "enum": ["open", "paid"]}},
                },
            },
            {
                "name": "send_reminder",
                "description": "Email a chase.",
                "reversible": False,
                "side_effects": "external",
            },
        ],
    }
    payload.update(overrides)
    return HostManifest.from_dict(payload)


# --- the core names ------------------------------------------------------------------------------


def test_the_four_core_names_are_registered_with_the_classes_the_design_fixes() -> None:
    catalog = build_catalog(services())
    assert catalog.names() == [
        "core.answer_decision",
        "core.checkpoint",
        "core.recall",
        "core.write_fact",
    ]
    assert catalog.classify("core.write_fact") is ToolClass.GATED
    assert catalog.classify("core.recall") is ToolClass.READ
    assert catalog.classify("core.checkpoint") is ToolClass.AUTO
    assert catalog.get("core.recall").cap_chars == 1600


def test_write_fact_refuses_dead_sources_and_accepts_live_ones() -> None:
    catalog = build_catalog(services(LIVE_EPISODE))
    good = {"key": "acme pays late", "value": "60 days", "sources": [LIVE_EPISODE]}
    assert catalog.validate("core.write_fact", good, CTX).ok

    dead = dict(good) | {"sources": ["ep_deadbeef"]}
    result = catalog.validate("core.write_fact", dead, CTX)
    assert not result.ok
    assert result.reason == "validator_failed"
    assert "ep_deadbeef" in result.detail

    for bad in ({"key": "k", "value": "v"}, {"key": "k", "value": "v", "sources": []}):
        assert not catalog.validate("core.write_fact", bad, CTX).ok


def test_an_unknown_name_is_a_rejection_and_never_an_execution() -> None:
    catalog = build_catalog(services())
    result = catalog.validate("core.rm_rf", {}, CTX)
    assert not result.ok
    assert result.reason == "unknown_ref"
    with pytest.raises(CatalogError):
        catalog.get("core.rm_rf")


def test_a_core_tool_with_no_service_attached_refuses_instead_of_vanishing() -> None:
    catalog = build_catalog(services())
    entry = catalog.get("core.checkpoint")
    assert entry.executor is not None
    result = entry.executor({"text": "halfway"}, CTX)
    assert not result.ok
    assert result.error == "unknown"
    assert "core.checkpoint" in result.output


# --- the host merge ------------------------------------------------------------------------------


def test_a_manifest_merges_under_its_origin_namespaced_by_app_id() -> None:
    catalog = build_catalog(services(), manifest())
    assert catalog.names(Lane.BROWSER) == [
        "core.answer_decision",
        "core.checkpoint",
        "core.recall",
        "core.write_fact",
        "host.invoices.list_invoices",
        "host.invoices.send_reminder",
    ]
    entry = catalog.get("host.invoices.list_invoices")
    assert entry.origin == "host:invoices"
    assert entry.tier == 1
    # A page executes its own tools; the lane never holds one (README §3.2 step 5).
    assert entry.executor is None


def test_a_tool_that_is_not_reversible_is_gated_whatever_the_host_preferred() -> None:
    hopeful = manifest(
        tools=[
            {
                "name": "delete_invoice",
                "reversible": False,
                "side_effects": "internal",
                "preferred_class": "AUTO",
                "cls": "AUTO",
            },
            {
                "name": "send_reminder",
                "reversible": True,
                "side_effects": "external",
                "preferred_class": "AUTO",
            },
            {"name": "list_invoices", "reversible": True, "side_effects": "none"},
        ]
    )
    catalog = build_catalog(services(), hopeful)
    assert catalog.classify("host.invoices.delete_invoice") is ToolClass.GATED
    assert catalog.classify("host.invoices.send_reminder") is ToolClass.GATED
    assert catalog.classify("host.invoices.list_invoices") is ToolClass.AUTO


def test_a_duplicate_name_is_refused_and_the_previous_set_of_that_origin_survives() -> None:
    catalog = build_catalog(services(), manifest())
    before = catalog.names()

    doubled = manifest(
        tools=[
            {"name": "list_invoices", "reversible": True, "side_effects": "none"},
            {"name": "list_invoices", "reversible": True, "side_effects": "none"},
        ]
    )
    with pytest.raises(CatalogError, match="refused whole"):
        catalog.merge_manifest(doubled)

    assert catalog.names() == before
    assert catalog.classify("host.invoices.send_reminder") is ToolClass.GATED


def test_an_invalid_tool_refuses_the_whole_manifest() -> None:
    catalog = build_catalog(services())
    silent = manifest(tools=[{"name": "list_invoices", "side_effects": "none"}])
    with pytest.raises(CatalogError, match="reversible"):
        catalog.merge_manifest(silent)
    assert catalog.names() == sorted(catalog.core)

    dotted = manifest(tools=[{"name": "invoices.list", "reversible": True, "side_effects": "none"}])
    with pytest.raises(CatalogError, match="slug"):
        catalog.merge_manifest(dotted)
    assert catalog.names() == sorted(catalog.core)


def test_a_re_merge_replaces_that_origin_and_leaves_every_other_alone() -> None:
    catalog = build_catalog(services(), manifest())
    catalog.merge_manifest(manifest("support", page_origin="https://support.example"))

    catalog.merge_manifest(
        manifest(tools=[{"name": "list_invoices", "reversible": True, "side_effects": "none"}])
    )
    assert "host.invoices.send_reminder" not in catalog
    assert "host.invoices.list_invoices" in catalog
    assert "host.support.send_reminder" in catalog


def test_drop_origin_returns_what_it_removed_and_refuses_a_name_that_is_not_an_origin() -> None:
    catalog = build_catalog(services(), manifest())
    assert catalog.drop_origin("host:invoices") == 2
    assert catalog.drop_origin("host:invoices") == 0
    assert catalog.names() == sorted(catalog.core)

    with pytest.raises(CatalogError):
        catalog.drop_origin("core")
    with pytest.raises(CatalogError):
        catalog.drop_origin("invoices")


# --- the generated capability block ---------------------------------------------------------------


def test_every_registered_name_appears_exactly_once_with_its_class() -> None:
    catalog = build_catalog(services(), manifest())
    block = catalog.render_capabilities(Lane.BROWSER)

    for name in catalog.names(Lane.BROWSER):
        assert block.text.count(f"`{name}`") == 1, name
        assert _class_section_of(block.text, name) == catalog.classify(name).value

    assert block.shown == len(catalog)
    assert f"(showing {len(catalog)} of {len(catalog)})" in block.text
    assert block.announces_truncation()


def test_the_block_is_byte_for_byte_stable_across_two_calls() -> None:
    catalog = build_catalog(services(), manifest())
    first = catalog.render_capabilities(Lane.BROWSER)
    second = catalog.render_capabilities(Lane.BROWSER)
    assert first.text == second.text
    assert first.hash == second.hash


def test_the_block_shows_the_read_cap_and_the_parameters_of_each_name() -> None:
    catalog = build_catalog(services(), manifest())
    text = catalog.render_capabilities(Lane.BROWSER).text
    assert "[cap 1600 chars]" in text
    assert "key: string" in text
    assert 'scope?: ["user", "project", "world"]' in text
    assert '`host.invoices.list_invoices`(status?: ["open", "paid"])' in text


def test_a_dropped_origin_leaves_the_block_immediately() -> None:
    catalog = build_catalog(services(), manifest())
    catalog.drop_origin("host:invoices")
    text = catalog.render_capabilities(Lane.BROWSER).text
    assert "host.invoices" not in text


def _class_section_of(text: str, name: str) -> str:
    """Which ``### CLASS`` heading the line for ``name`` sits under."""
    section = ""
    for line in text.splitlines():
        heading = re.fullmatch(r"### (\w+)", line)
        if heading:
            section = heading.group(1)
        elif line.startswith(f"- `{name}`"):
            return section
    raise AssertionError(f"{name} is not in the block")


def test_an_empty_catalog_still_renders_an_honest_block() -> None:
    block = Catalog().render_capabilities(Lane.BROWSER)
    assert "(showing 0 of 0)" in block.text
    assert "### " not in block.text
