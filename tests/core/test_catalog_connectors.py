"""A connector merges like a page, and cannot argue itself out of GATED.

core/catalog.py, connectors/port.py, README §4, ADR 0004.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import pytest

from athena.connectors import ConnectorPort
from athena.contracts import ExecResult, HostTool, Lane, ToolClass, TurnContext
from athena.core.catalog import Catalog, CatalogError, CoreServices, build_catalog

CTX = TurnContext(conversation_id="conv_mail", turn_id="turn-1")


def services() -> CoreServices:
    return CoreServices(sources_alive=lambda sources: True)


class FakeMail:
    """A connector the way the connector team will write one: tools in, one ``call`` out."""

    def __init__(self, tools: Sequence[HostTool] | None = None) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self._tools = list(
            tools
            if tools is not None
            else [
                HostTool(
                    name="search_mail",
                    description="Search the mailbox.",
                    params_schema={
                        "type": "object",
                        "properties": {"query": {"type": "string", "maxLength": 200}},
                        "required": ["query"],
                    },
                    reversible=True,
                    side_effects="none",
                ),
                HostTool(
                    name="send_mail",
                    description="Send a message.",
                    # The connector would rather this fired on its own. It does not.
                    reversible=True,
                    side_effects="external",
                ),
            ]
        )

    def list_tools(self) -> Sequence[HostTool]:
        return self._tools

    def call(self, name: str, params: dict[str, Any]) -> ExecResult:
        self.calls.append((name, params))
        return ExecResult(ok=True, output=f"{name} ran", tier=3)


def test_a_connector_port_is_one_by_structure_and_not_by_inheritance() -> None:
    assert isinstance(FakeMail(), ConnectorPort)


def test_a_connectors_tools_merge_under_connector_id_with_the_same_class_rule() -> None:
    catalog = build_catalog(services())
    names = catalog.merge_connector("gmail", FakeMail())

    assert names == ["connector.gmail.search_mail", "connector.gmail.send_mail"]
    read = catalog.get("connector.gmail.search_mail")
    assert read.origin == "connector:gmail"
    assert read.tier == 3

    # reversible, no side effects outside the app → AUTO; anything external → GATED, always.
    assert catalog.classify("connector.gmail.search_mail") is ToolClass.AUTO
    assert catalog.classify("connector.gmail.send_mail") is ToolClass.GATED


def test_every_connector_entry_is_bound_to_the_port_by_its_bare_name() -> None:
    catalog = build_catalog(services())
    port = FakeMail()
    catalog.merge_connector("gmail", port)

    entry = catalog.get("connector.gmail.search_mail")
    assert entry.executor is not None
    result = entry.executor({"query": "invoice"}, CTX)

    assert result.ok
    assert result.tier == 3
    # The namespace is the catalog's; the port sees the name it declared.
    assert port.calls == [("search_mail", {"query": "invoice"})]


def test_a_connectors_parameters_are_validated_by_the_gate_before_the_port_is_reached() -> None:
    catalog = build_catalog(services())
    port = FakeMail()
    catalog.merge_connector("gmail", port)

    assert catalog.validate("connector.gmail.search_mail", {"query": "invoice"}, CTX).ok
    refused = catalog.validate("connector.gmail.search_mail", {}, CTX)
    assert not refused.ok
    assert refused.reason == "validator_failed"
    assert port.calls == []


def test_a_connector_that_omits_reversible_is_refused_whole() -> None:
    catalog = build_catalog(services())
    silent = FakeMail([HostTool(name="send_mail", side_effects="external")])
    with pytest.raises(CatalogError, match="reversible"):
        catalog.merge_connector("gmail", silent)
    assert catalog.names() == sorted(catalog.core)


def test_a_connector_re_merge_replaces_its_own_set_and_a_drop_removes_it() -> None:
    catalog = build_catalog(services())
    catalog.merge_connector("gmail", FakeMail())
    catalog.merge_connector(
        "gmail",
        FakeMail([HostTool(name="search_mail", reversible=True, side_effects="none")]),
    )
    assert "connector.gmail.send_mail" not in catalog
    assert catalog.drop_origin("connector:gmail") == 1
    assert "connector.gmail.search_mail" not in catalog


def test_a_connector_and_a_page_of_the_same_name_are_two_different_origins() -> None:
    catalog = Catalog()
    catalog.merge_connector("gmail", FakeMail())
    text = catalog.render_capabilities(Lane.BROWSER).text
    assert text.count("`connector.gmail.send_mail`") == 1
    assert "host.gmail" not in text
