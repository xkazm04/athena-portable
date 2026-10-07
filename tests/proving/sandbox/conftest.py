"""Fixtures for the WP4 spike tests: a fake service, a fake clock, a client (ADR 0033)."""

from __future__ import annotations

import pytest

from athena.proving.sandbox.client import SandboxClient

from .fakes import FakeClock, FakeSandboxes

#: A key shaped like a Token Factory static key; it must never appear in any output.
FAKE_KEY = "v1.FAKEKEYFAKEKEYFAKEKEY.signature"


@pytest.fixture
def fake() -> FakeSandboxes:
    return FakeSandboxes()


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def client(fake: FakeSandboxes, clock: FakeClock) -> SandboxClient:
    return SandboxClient(
        api_key=FAKE_KEY, project="aiproject-test", http=fake, clock=clock, sleep=clock.sleep
    )


@pytest.fixture
def fake_key() -> str:
    return FAKE_KEY
