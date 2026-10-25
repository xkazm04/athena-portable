"""The annotation mapping table of ADR 0144, row by row (connectors/mcp/annotations.py)."""

from __future__ import annotations

from typing import Any

import pytest

from athena.connectors.mcp.annotations import flags_for, host_tool
from athena.contracts.registry import ToolClass

AUTO_NONE = (True, "none")
AUTO_INTERNAL = (True, "internal")
GATED = (False, "external")


@pytest.mark.parametrize(
    ("annotations", "flags"),
    [
        # readOnlyHint true is a read, whatever else is said
        ({"readOnlyHint": True}, AUTO_NONE),
        ({"readOnlyHint": True, "destructiveHint": False, "openWorldHint": False}, AUTO_NONE),
        ({"readOnlyHint": True, "idempotentHint": True}, AUTO_NONE),
        # a write that says it is neither destructive nor open-world, explicitly
        ({"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False}, AUTO_INTERNAL),
        ({"destructiveHint": False, "openWorldHint": False}, AUTO_INTERNAL),
        # destructive or open-world is gated
        ({"readOnlyHint": False, "destructiveHint": True, "openWorldHint": False}, GATED),
        ({"readOnlyHint": False, "destructiveHint": False, "openWorldHint": True}, GATED),
        # a hint left out takes MCP's default, which is the dangerous one
        ({"readOnlyHint": False, "destructiveHint": False}, GATED),
        ({"readOnlyHint": False, "openWorldHint": False}, GATED),
        ({}, GATED),
        (None, GATED),
        ("readOnly", GATED),
        # only the JSON boolean counts
        ({"readOnlyHint": "true"}, GATED),
        ({"readOnlyHint": 1}, GATED),
        ({"destructiveHint": "false", "openWorldHint": "false"}, GATED),
        ({"destructiveHint": 0, "openWorldHint": 0}, GATED),
        # idempotentHint never loosens
        ({"idempotentHint": True}, GATED),
        ({"readOnlyHint": False, "destructiveHint": True, "idempotentHint": True}, GATED),
    ],
)
def test_the_mapping_table(annotations: Any, flags: tuple[bool, str]) -> None:
    assert flags_for(annotations) == flags


def test_a_listed_tool_becomes_a_host_tool_the_catalog_classes() -> None:
    read = host_tool(
        {
            "name": "gt_read",
            "description": "Read.",
            "inputSchema": {"type": "object", "properties": {"op": {"type": "string"}}},
            "annotations": {"readOnlyHint": True},
        }
    )
    assert read.name == "gt_read" and read.description == "Read."
    assert read.params_schema["properties"] == {"op": {"type": "string"}}
    assert read.default_class() is ToolClass.AUTO
    assert host_tool({"name": "x", "title": "Titled"}).description == "Titled"
    assert host_tool({"name": "x"}).default_class() is ToolClass.GATED


def test_an_input_schema_that_is_not_an_object_is_refused_not_read_as_none() -> None:
    with pytest.raises(ValueError, match="inputSchema must be an object"):
        host_tool({"name": "x", "inputSchema": "anything"})
