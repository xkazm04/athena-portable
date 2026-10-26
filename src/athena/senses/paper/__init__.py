"""The paper sense (stub: the owning spike replaces this body, keeping the two signatures)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from athena.senses.contract import ProofResult, SenseContext, SenseOutput


def build(ctx: SenseContext) -> SenseOutput:
    raise NotImplementedError("paper sense not built yet")


def prove(ctx: SenseContext, output: SenseOutput, key: Mapping[str, Any]) -> list[ProofResult]:
    raise NotImplementedError("paper sense not built yet")
