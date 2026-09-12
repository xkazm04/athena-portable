"""The class is derived from the manifest's flags, and a bad manifest is refused whole.

contracts/manifest.py, README §3.3.
"""

from __future__ import annotations

import pytest

from athena.contracts import HostManifest, HostTool, StateReadable, ToolClass


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
