"""A vault over a fake provider, and the two builtin specs (connectors/; README §4; ADR 0021).

Nothing here reaches a network. ``FakeProvider`` is the transport: it records every request the
vault makes and answers from a script keyed by method and path, so a test can assert what left
the process — and, above all, what did not.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import pytest

from athena.connectors.seal import FileSeal
from athena.connectors.spec import ConnectorSpec, load_builtin
from athena.connectors.vault import Vault

Answer = tuple[int, Any]
Script = Callable[[str, str, Mapping[str, str], bytes | None], Answer]


@dataclass
class Seen:
    method: str
    url: str
    headers: dict[str, str]
    body: bytes | None

    @property
    def path(self) -> str:
        return urlsplit(self.url).path

    @property
    def json(self) -> Any:
        return json.loads(self.body) if self.body else None


@dataclass
class FakeProvider:
    """The transport. ``script`` answers a request; the default accepts every probe."""

    script: Script | None = None
    seen: list[Seen] = field(default_factory=list)

    def __call__(
        self, method: str, url: str, headers: Mapping[str, str], body: bytes | None, timeout: float
    ) -> tuple[int, bytes]:
        self.seen.append(Seen(method, url, dict(headers), body))
        if self.script is None:
            status, answer = 200, {"name": "Test User", "emailAddress": "me@example.test"}
        else:
            status, answer = self.script(method, url, headers, body)
        raw = answer if isinstance(answer, bytes) else json.dumps(answer).encode("utf-8")
        return status, raw

    def auth_headers(self) -> list[str]:
        return [s.headers.get("Authorization", "") for s in self.seen]


@pytest.fixture
def specs() -> dict[str, ConnectorSpec]:
    return load_builtin()


@pytest.fixture
def provider() -> FakeProvider:
    return FakeProvider()


@pytest.fixture
def vault(
    tmp_path: Path, specs: dict[str, ConnectorSpec], provider: FakeProvider
) -> Iterator[Vault]:
    built = Vault(
        tmp_path / "connectors",
        specs=specs,
        transport=provider,
        seal=FileSeal(tmp_path / "connectors" / "sealed"),
        open_browser=lambda url: None,
    )
    try:
        yield built
    finally:
        built.close()


@pytest.fixture
def notion(vault: Vault) -> Vault:
    """The vault with Notion connected through a pasted token."""
    vault.connect_token("notion", "ntn_test_token_0123456789")
    return vault
