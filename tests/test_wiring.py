"""The composition root: what ``build_local`` binds, and what it refuses to bind (README §3.1).

Every other package is tested against ports. This one is tested against the *real* objects,
because that is all it is: the claim is that the classes ``athena serve`` runs are wired to each
other the way each of them was written to be. Nothing here goes over HTTP — the daemon's own
tests do that — and nothing spawns a binary.
"""

from __future__ import annotations

from dataclasses import fields
from pathlib import Path
from typing import Any

import pytest

from athena.contracts.registry import Lane, ToolClass, TurnContext
from athena.core.brain.store import ProvenanceError
from athena.core.catalog import CoreServices
from athena.harness.policy import Policy
from athena.harness.transports import ScriptedTransport, SubprocessTransport
from athena.wiring import AthenaLocal, build_local

CONVERSATION = "conv_invoices"


@pytest.fixture
def local(tmp_path: Path) -> Any:
    with build_local(
        brain_root=tmp_path / "brain",
        engine="claude_code",
        model="fake-model",
        transport=lambda dialect: ScriptedTransport([]),
        workspace=tmp_path / "engine",
    ) as built:
        yield built


def ctx(**overrides: Any) -> TurnContext:
    kwargs: dict[str, Any] = {
        "conversation_id": CONVERSATION,
        "turn_id": "turn_000000000001",
        "lane": Lane.BROWSER,
        "surface": "panel",
    }
    kwargs.update(overrides)
    return TurnContext(**kwargs)


# -- what it binds ---------------------------------------------------------------------------


def test_every_part_of_one_athena_shares_the_same_brain_and_the_same_gate(
    local: AthenaLocal,
) -> None:
    """One process, one Athena: a second gate or a second brain would be a second policy."""
    assert local.approvals.brain is local.brain
    assert local.ledger.brain is local.brain
    assert local.lane.gate is local.gate
    assert local.harness.gate is local.gate
    assert local.daemon.gate is local.gate
    assert local.daemon.lane is local.lane
    assert local.daemon.brain is local.brain
    assert local.lane.catalog is local.catalog
    assert local.frames.catalog is local.catalog


def test_the_engine_is_a_name_and_the_transport_is_how_it_is_run(tmp_path: Path) -> None:
    """ADR 0007 from the composition side: the dialect is real, the process is the factory's."""
    scripted = ScriptedTransport([])
    seen: list[str] = []
    with build_local(
        brain_root=tmp_path / "brain",
        engine="codex",
        transport=lambda dialect: seen.append(dialect.executable) or scripted,
        workspace=tmp_path / "engine",
    ) as built:
        assert seen == ["codex"]
        assert built.harness.transport is scripted
        assert built.harness.dialect.name == "codex"
        assert built.harness.name == "codex"
        # The Claude CLI's own flags belong to the Claude dialect and to nothing else.
        assert built.harness.extra_args == ()


def test_without_a_factory_the_engine_is_the_real_binary(tmp_path: Path) -> None:
    with build_local(brain_root=tmp_path / "brain", workspace=tmp_path / "engine") as built:
        assert isinstance(built.harness.transport, SubprocessTransport)
        assert built.harness.transport.executable == "claude"
        assert built.harness.extra_args == ("--restricted", "--permission-mode", "dontAsk")


def test_an_engine_no_dialect_answers_to_is_refused_by_name(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="no_such_engine"):
        build_local(brain_root=tmp_path / "brain", engine="no_such_engine")


def test_the_engine_runs_beside_the_brain_and_never_inside_it(tmp_path: Path) -> None:
    """A CLI engine has no business in the user's memory: the prompts it is handed live next
    door, and the default is a sibling of the brain rather than the brain itself."""
    with build_local(brain_root=tmp_path / "brain") as built:
        assert Path(built.harness.cwd) == tmp_path / "engine"
        assert Path(built.harness.cwd).is_dir()
        assert Path(built.harness.prompt_root) != built.brain.root


def test_the_policy_starts_empty_and_a_pin_is_added_by_a_manifest(local: AthenaLocal) -> None:
    assert local.gate.policy.pinned_origins == {}

    local.daemon.pin("invoices", "https://invoices.example")

    assert local.gate.policy.pinned_origins == {"invoices": "https://invoices.example"}


def test_a_pin_carries_every_other_rule_across(tmp_path: Path) -> None:
    """The bug the original shipped: a policy rebuilt from three of its four fields silently
    unhooked the fourth the first time a page sent a manifest."""
    policy = Policy.build(disabled_origins=["connector:gmail"], lane_tools={Lane.BROWSER: ["x"]})
    with build_local(
        brain_root=tmp_path / "brain",
        transport=lambda dialect: ScriptedTransport([]),
        workspace=tmp_path / "engine",
        policy=policy,
    ) as built:
        built.daemon.pin("invoices", "https://invoices.example")

        after = built.gate.policy
        assert after.disabled_origins == frozenset({"connector:gmail"})
        assert after.lane_tools == {Lane.BROWSER: frozenset({"x"})}
        assert after.pinned_origins == {"invoices": "https://invoices.example"}


# -- the three core tools --------------------------------------------------------------------


def test_the_lane_is_handed_athenas_own_three_names(local: AthenaLocal) -> None:
    assert [entry.name for entry in local.lane.tools()] == [
        "core.checkpoint",
        "core.recall",
        "core.write_fact",
    ]
    assert local.catalog.classify("core.write_fact") is ToolClass.GATED
    assert local.catalog.classify("core.recall") is ToolClass.READ


def test_checkpoint_writes_a_system_episode_of_this_conversation(local: AthenaLocal) -> None:
    entry = local.catalog.get("core.checkpoint")
    assert entry.executor is not None

    result = entry.executor({"text": "the tax pack is blocked on the bank export"}, ctx())

    assert result.ok
    node_id = result.output.removeprefix("noted as ")
    row = local.brain.node(node_id)
    assert row is not None
    assert row.session_id == CONVERSATION
    assert local.brain.read_body(node_id) == "the tax pack is blocked on the bank export"


def test_recall_answers_with_the_blocks_and_each_ones_own_footer(local: AthenaLocal) -> None:
    local.brain.append_episode("the late-paying client is Northwind", session_id=CONVERSATION)
    entry = local.catalog.get("core.recall")
    assert entry.executor is not None

    result = entry.executor({"query": "Northwind"}, ctx())

    assert result.ok
    assert "Northwind" in result.output
    # Three populations, three footers, and deliberately no global M over their union.
    assert result.output.count("(showing ") == 3


def test_write_fact_refuses_a_source_that_is_not_a_live_episode(local: AthenaLocal) -> None:
    """Provenance at write, through the wiring: no bypass, not even for the composition root."""
    entry = local.catalog.get("core.write_fact")
    assert entry.executor is not None

    result = entry.executor(
        {"key": "client/northwind", "value": "pays late", "sources": ["ep_00000000"]}, ctx()
    )

    assert not result.ok
    assert result.error == "validator_failed"
    assert "not live episodes" in result.output
    assert local.brain.counts().get("fact") is None


def test_write_fact_writes_the_claim_when_it_cites_a_live_episode(local: AthenaLocal) -> None:
    episode = local.brain.append_episode("Northwind paid 40 days late", session_id=CONVERSATION)
    entry = local.catalog.get("core.write_fact")
    assert entry.executor is not None

    result = entry.executor(
        {
            "key": "client/northwind",
            "value": "Northwind pays about forty days late.",
            "scope": "world",
            "sources": [episode.id],
        },
        ctx(),
    )

    assert result.ok
    node_id = result.output.split()[1]
    assert local.brain.sources_of(node_id) == [episode.id]
    assert local.brain.counts()["fact"] == 1


def test_the_brains_own_provenance_rule_is_the_one_the_catalog_asks(local: AthenaLocal) -> None:
    """``CoreServices.sources_alive`` is bound to this brain, so the validator refuses *before*
    a card is filed rather than after the user approves one."""
    verdict = local.catalog.validate(
        "core.write_fact",
        {"key": "k", "value": "v", "sources": ["ep_deadbeef"]},
        ctx(),
    )

    assert not verdict.ok
    assert verdict.reason == "validator_failed"
    with pytest.raises(ProvenanceError):
        local.brain.write_fact("k", "v", sources=["ep_deadbeef"])


def test_no_core_name_can_answer_a_card_and_none_is_offered_to_the_model(
    local: AthenaLocal,
) -> None:
    """README §2 invariant 3, structurally (ADR 0004, amendment).

    ``core.answer_decision`` was an ``AUTO`` core tool, so a model could resolve a card by
    emitting one op. The name is gone from the catalog and from the generated capability block,
    which is the same statement said twice: the block *is* the registry.
    """
    assert "core.answer_decision" not in local.catalog
    assert [entry.name for entry in local.lane.tools()] == [
        "core.checkpoint",
        "core.recall",
        "core.write_fact",
    ]
    assert "answer_decision" not in local.catalog.render_capabilities(Lane.BROWSER).text
    # And no port is left for a later commit to re-attach an executor to.
    assert "answer_decision" not in {field.name for field in fields(CoreServices)}


def test_a_card_is_still_pending_after_a_turn_that_tried_to_answer_it(
    local: AthenaLocal,
) -> None:
    """The defect, from the gate's side: the name the model would have called is unaddressable."""
    card = local.approvals.create(
        "host.invoices.pay",
        {"invoice": "7"},
        origin="host:invoices",
        conversation=CONVERSATION,
        surface="panel",
    )
    with pytest.raises(ValueError):
        local.catalog.get("core.answer_decision")

    verdict = local.catalog.validate(
        "core.answer_decision", {"id": card.id, "choice": "approve"}, ctx()
    )

    assert not verdict.ok
    assert verdict.reason == "unknown_ref"
    assert local.approvals.describe(card.id).status == "pending"


def test_the_surface_is_the_only_door_and_it_still_opens(local: AthenaLocal) -> None:
    """The other half: what the model may not do, the surface's own path still does.

    ``POST /decisions/<id>`` calls exactly this, and the replay runs the *granted* action — here a
    gated core tool, whose executor exists for this moment and for no other (ADR 0010).
    """
    episode = local.brain.append_episode("Acme paid on day 31", "user", session_id=CONVERSATION)
    card = local.approvals.create(
        "core.write_fact",
        {"key": "acme pays late", "value": "31 days", "sources": [episode.id]},
        origin="core",
        conversation=CONVERSATION,
        surface="panel",
    )

    resolution = local.lane.answer_decision(card.id, "approve", ctx())

    assert resolution.approved
    assert resolution.result is not None
    assert resolution.result.ok
    assert local.approvals.describe(card.id).status == "approved"
