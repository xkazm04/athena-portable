"""The Claude CLI as a Reader (stub: spike 01's package replaces the body, keeping the names)."""

from __future__ import annotations

from athena.senses.backends import FixtureReader
from athena.senses.contract import Reading, ReadRequest, SenseCall


class ClaudeReader:
    def __init__(self, *, fallback: FixtureReader) -> None:
        self.fallback = fallback

    def read(self, request: ReadRequest) -> tuple[Reading, SenseCall]:
        raise NotImplementedError
