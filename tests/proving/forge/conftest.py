"""Fakes for the forge: a scripted role, and the repo's real playbook library as the base."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from athena.proving.forge.base import Base, load_base
from athena.proving.roles import RoleReply

LIBRARY = Path(__file__).resolve().parents[3] / "playbooks"


@dataclass
class ScriptedRole:
    """A RoleClient that answers with ``reply(system, prompt)`` and counts its calls."""

    reply: Callable[[str, str], RoleReply]
    engine: str = "nemotron"
    model: str = "scripted"
    prompts: list[str] = field(default_factory=list)

    def complete(self, system: str, prompt: str) -> RoleReply:
        self.prompts.append(prompt)
        return self.reply(system, prompt)


def text_reply(text: str, *, cost: float = 0.001, engine: str = "nemotron") -> RoleReply:
    return RoleReply(text, engine, "scripted", 10, 10, cost, 1)


@pytest.fixture(scope="session")
def library() -> Path:
    return LIBRARY


@pytest.fixture(scope="session")
def base(library: Path) -> Base:
    return load_base(library, "chargeback-representment")
