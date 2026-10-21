"""A world is closed when a later app's manifest is refused, at the bench and the showcase."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from athena.adopt.showcase import _claude_world
from athena.proving.playbooks import bench
from athena.proving.playbooks.bench import BenchConfig
from athena.proving.world import WorldError


class _RefusingWorld:
    instances: list[_RefusingWorld] = []

    def __init__(self, **_: Any) -> None:
        self.closed = 0
        self.registered = 0
        _RefusingWorld.instances.append(self)

    def register(self, manifest: Any) -> None:
        self.registered += 1
        raise WorldError("manifest refused")

    def close(self) -> None:
        self.closed += 1


def _playbook() -> Any:
    app = SimpleNamespace(manifest=lambda: {})
    return SimpleNamespace(apps=[app, app])


@pytest.fixture(autouse=True)
def _reset() -> None:
    _RefusingWorld.instances.clear()


def test_bench_closes_the_world_when_a_later_manifest_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(bench, "World", _RefusingWorld)
    with pytest.raises(WorldError):
        bench._default_world(_playbook(), BenchConfig())
    assert [w.closed for w in _RefusingWorld.instances] == [1]
    assert _RefusingWorld.instances[0].registered == 1


def test_showcase_closes_the_world_when_a_later_manifest_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("athena.proving.world.World", _RefusingWorld)
    with pytest.raises(WorldError):
        _claude_world(BenchConfig())(_playbook())
    assert [w.closed for w in _RefusingWorld.instances] == [1]
    assert _RefusingWorld.instances[0].registered == 1
