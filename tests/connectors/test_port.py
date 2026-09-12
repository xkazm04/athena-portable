"""The connector seam this build reserves: one Protocol, the contracts' own shapes.

connectors/port.py, README §4, ADR 0004.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from athena.connectors import ConnectorPort
from athena.connectors.port import ConnectorPort as PortFromModule
from athena.contracts import ExecResult, HostTool, ToolClass


class Notion:
    def list_tools(self) -> Sequence[HostTool]:
        return [
            HostTool(
                name="search_pages",
                description="Search the workspace.",
                params_schema={
                    "type": "object",
                    "properties": {"query": {"type": "string", "maxLength": 200}},
                    "required": ["query"],
                },
                reversible=True,
                side_effects="none",
                transport="http",
            ),
            HostTool(name="append_block", reversible=False, side_effects="internal"),
        ]

    def call(self, name: str, params: dict[str, Any]) -> ExecResult:
        return ExecResult.bounded([f"{name}: {params}"], 1, tier=3)


class NotAPort:
    def list_tools(self) -> Sequence[HostTool]:
        return []


def test_the_package_exports_the_port_from_one_module() -> None:
    assert ConnectorPort is PortFromModule


def test_a_connector_satisfies_the_port_by_structure() -> None:
    assert isinstance(Notion(), ConnectorPort)
    assert not isinstance(NotAPort(), ConnectorPort)


def test_a_port_yields_the_contracts_own_host_tool_shape() -> None:
    tools = Notion().list_tools()
    assert all(isinstance(tool, HostTool) for tool in tools)
    # The class is derived from the flags a page declares, by the same method a page's is.
    assert tools[0].default_class() is ToolClass.AUTO
    assert tools[1].default_class() is ToolClass.GATED


def test_a_ports_answer_is_a_bounded_exec_result() -> None:
    result = Notion().call("search_pages", {"query": "invoice"})
    assert result.ok
    assert result.tier == 3
    assert result.announces_truncation()
