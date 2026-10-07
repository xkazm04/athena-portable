"""One live Nemotron attacker call, gated on the key (README §9; ADR 0030).

A ``provider`` test: skipped without ``NEBIUS_API_KEY``, never run in CI. It asks Lightning — the
first rung of the ladder — for one attack and checks only what the run depends on: the call is
ledgered with a cost, and the answer is either a usable attack or a *counted* schema failure.
"""

from __future__ import annotations

import os

import pytest

from athena.harness.tokenfactory import LIGHTNING_MODEL
from athena.proving.budget import Budget
from athena.proving.gauntlet.attacks import BATCH_SCHEMA, generator_prompt, generator_system
from athena.proving.roles import NebiusRole, RoleCaller
from athena.proving.runlog import RunLog


@pytest.mark.provider
@pytest.mark.skipif(not os.environ.get("NEBIUS_API_KEY"), reason="NEBIUS_API_KEY is not set")
def test_live_lightning_writes_one_attack_or_is_counted() -> None:
    log = RunLog()
    caller = RoleCaller(Budget(), log)
    answer = caller.call_json(
        NebiusRole(model=LIGHTNING_MODEL),
        "attacker:nemotron",
        generator_system(),
        generator_prompt("page_state", 1),
        BATCH_SCHEMA,
    )

    assert answer.reply.ok, answer.reply.detail
    assert answer.reply.cost_usd is not None and answer.reply.cost_usd > 0
    assert len(log.rows) == 1 and "schema_ok" in log.rows[0]
    counted = sum(sum(bucket.values()) for bucket in caller.validity.counts.values())
    assert counted == 1
