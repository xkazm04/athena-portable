"""Credential health is a verdict plus an attempt, written by every door of the vault
(connectors/health.py, connectors/vault.py; README §4; ADR 0021, ADR 0062 and the health ADR).

A verdict (healthy, broken) is what the provider said about the credential. An attempt is a check
that reached no verdict: the provider could not be reached, rate limited the check, failed on its
own side, or the grant could not be refreshed this time. Only a verdict writes the verdict fields;
the next verdict clears the attempt.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest

from athena.connectors.seal import FileSeal
from athena.connectors.spec import ConnectorSpec
from athena.connectors.vault import NeedsReauth, RefreshFailed, Vault, VaultError

from .conftest import Answer, FakeProvider

TOKEN = "ntn_test_token_0123456789"
PROFILE = "https://gmail.googleapis.com/gmail/v1/users/me/profile"
ME = "me@example.test"


class Google:
    """A Google that accepts only the tokens in :attr:`good` and answers the token endpoint with
    :attr:`token`. Every token POST is kept in :attr:`posts`."""

    def __init__(self) -> None:
        self.good = {"ya29.old"}
        self.token: Answer = (200, {"access_token": "ya29.new", "expires_in": 3600})
        self.api: Answer | None = None
        self.posts: list[dict[str, str]] = []

    def __call__(
        self, method: str, url: str, headers: Mapping[str, str], body: bytes | None
    ) -> Answer:
        path = urlsplit(url).path
        if path == "/token":
            self.posts.append({k: v[0] for k, v in parse_qs((body or b"").decode()).items()})
            return self.token
        if self.api is not None:
            return self.api
        bearer = headers.get("Authorization", "").removeprefix("Bearer ")
        if bearer in self.good:
            return 200, {"emailAddress": ME}
        return 401, {"error": {"code": 401, "status": "UNAUTHENTICATED"}}


def _vault(tmp_path: Path, specs: dict[str, ConnectorSpec], script: Any) -> Vault:
    return Vault(
        tmp_path / "connectors",
        specs=specs,
        transport=FakeProvider(script=script),
        seal=FileSeal(tmp_path / "connectors" / "sealed"),
        open_browser=lambda url: None,
    )


def _stale_gmail(
    tmp_path: Path, specs: dict[str, ConnectorSpec], google: Google, expires_in: int = 1
) -> Vault:
    vault = _vault(tmp_path, specs, google)
    vault._admit(
        specs["gmail"], "ya29.old", refresh="1//r", expires_in=expires_in, client=("cid", "cs")
    )
    return vault


def _fresh(stamp: str) -> bool:
    return bool(stamp) and (datetime.now(UTC) - datetime.fromisoformat(stamp)).total_seconds() < 60


# -- case 1: the probe refreshes a stale OAuth token before it asks --------------------------------


@pytest.mark.parametrize("status", ["connected", "needs_reauth"])
def test_case1_a_probe_refreshes_a_stale_oauth_token_first_and_reads_healthy(
    status: str, tmp_path: Path, specs: dict[str, ConnectorSpec]
) -> None:
    google = Google()
    vault = _stale_gmail(tmp_path, specs, google)
    vault.record("gmail").status = status
    google.good = {"ya29.new"}  # the stale token is refused from here on; the refreshed one works
    record = vault.probe("gmail")
    assert len(google.posts) == 1, "the probe did not refresh the stale grant"
    assert record.health == "healthy", record.health_detail
    assert record.status == "connected"
    assert vault._get("gmail", "token") == "ya29.new"


# -- case 2: a provider that could not be reached is an attempt, never broken ----------------------


def test_case2_an_unreachable_provider_keeps_the_verdict_and_records_an_attempt(
    tmp_path: Path, specs: dict[str, ConnectorSpec]
) -> None:
    reach = {"up": True}

    def script(method: str, url: str, headers: Mapping[str, str], body: bytes | None) -> Answer:
        if not reach["up"]:
            raise VaultError("the provider could not be reached: TimeoutError")
        return 200, {"name": "Test User", "id": "u-1"}

    vault = _vault(tmp_path, specs, script)
    vault.connect_token("notion", TOKEN)
    before = vault.record("notion").health_at
    reach["up"] = False
    record = vault.probe("notion")
    assert record.health == "healthy" and record.health_at == before
    assert _fresh(record.attempt_at)
    assert "could not reach" in record.attempt_detail
    assert "broken" not in (record.health, record.health_detail)


# -- case 3: a 429 or a 503 on the probe is the same as unreachable --------------------------------


@pytest.mark.parametrize("status", [429, 503])
def test_case3_a_rate_limited_or_failing_provider_is_an_attempt_with_its_status(
    status: int, tmp_path: Path, specs: dict[str, ConnectorSpec]
) -> None:
    answer: dict[str, Answer] = {"now": (200, {"name": "Test User", "id": "u-1"})}
    vault = _vault(tmp_path, specs, lambda *_: answer["now"])
    vault.connect_token("notion", TOKEN)
    before = vault.record("notion")
    verdict = (before.health, before.health_at, before.health_detail)
    answer["now"] = (status, {"object": "error"})
    record = vault.probe("notion")
    assert (record.health, record.health_at, record.health_detail) == verdict
    assert _fresh(record.attempt_at)
    assert str(status) in record.attempt_detail


# -- case 4 (guard): a refusal is a verdict, and a live token on a parked record reads healthy -----


def test_case4_guard_a_notion_401_is_broken_and_clears_the_attempt(
    tmp_path: Path, specs: dict[str, ConnectorSpec]
) -> None:
    answer: dict[str, Answer] = {"now": (200, {"name": "Test User", "id": "u-1"})}
    vault = _vault(tmp_path, specs, lambda *_: answer["now"])
    vault.connect_token("notion", TOKEN)
    answer["now"] = (503, {})
    vault.probe("notion")
    answer["now"] = (401, {"message": "gone"})
    record = vault.probe("notion")
    assert record.health == "broken" and _fresh(record.health_at)
    assert "401" in record.health_detail and TOKEN not in record.health_detail
    assert getattr(record, "attempt_at", "") == "" and getattr(record, "attempt_detail", "") == ""


@pytest.mark.parametrize("parked", ["needs_reauth", "switched_off"])
def test_case4_guard_a_parked_record_whose_token_is_accepted_reads_healthy(
    parked: str, tmp_path: Path, specs: dict[str, ConnectorSpec]
) -> None:
    google = Google()
    vault = _stale_gmail(tmp_path, specs, google, expires_in=3600)
    if parked == "needs_reauth":
        vault.record("gmail").status = "needs_reauth"
    else:
        vault.set_enabled("gmail", False)
    vault.record("gmail").health = "broken"
    record = vault.probe("gmail")
    assert record.health == "healthy"
    assert record.status == "connected"
    assert google.posts == [], "a token with an hour left was refreshed"


# -- case 5: a 401 during a real call is a verdict with its time -----------------------------------


def test_case5_a_request_answered_401_marks_needs_reauth_and_broken_with_its_time(
    tmp_path: Path, specs: dict[str, ConnectorSpec]
) -> None:
    google = Google()
    vault = _stale_gmail(tmp_path, specs, google, expires_in=3600)
    before = vault.record("gmail").health_at
    google.good = set()
    with pytest.raises(NeedsReauth, match="401"):
        vault.request("gmail", "GET", PROFILE)
    record = vault.record("gmail")
    assert record.status == "needs_reauth"
    assert record.health == "broken" and _fresh(record.health_at) and record.health_at != before
    assert "401" in record.health_detail


# -- case 6: a refresh that failed this time is an attempt, and the grant stays connected ----------


def test_case6_a_refresh_answered_503_is_an_attempt_and_leaves_the_verdict(
    tmp_path: Path, specs: dict[str, ConnectorSpec]
) -> None:
    google = Google()
    vault = _stale_gmail(tmp_path, specs, google)
    before = vault.record("gmail")
    verdict = (before.health, before.health_at, before.health_detail)
    google.token = (503, {})
    with pytest.raises(RefreshFailed, match="503"):
        vault.request("gmail", "GET", PROFILE)
    record = vault.record("gmail")
    assert record.status == "connected"
    assert (record.health, record.health_at, record.health_detail) == verdict
    detail = getattr(record, "attempt_detail", "")
    assert "refresh" in detail and "503" in detail
    assert _fresh(getattr(record, "attempt_at", ""))


# -- case 7: the switch-reset sentence is a notice, and a probe leaves it --------------------------


def test_case7_the_switch_reset_sentence_is_a_notice_a_later_probe_keeps(
    tmp_path: Path, specs: dict[str, ConnectorSpec]
) -> None:
    names = iter(["A", "B"])
    who = {"now": "A"}

    def script(method: str, url: str, headers: Mapping[str, str], body: bytes | None) -> Answer:
        return 200, {"name": who["now"], "id": f"id-{who['now']}"}

    vault = _vault(tmp_path, specs, script)
    who["now"] = next(names)
    vault.connect_token("notion", TOKEN)
    vault.set_writes("notion", True)
    vault.disconnect("notion")
    who["now"] = next(names)
    record = vault.connect_token("notion", TOKEN)
    notice = getattr(record, "notice", "")
    assert "Connected as B" in notice and "writes are off" in notice
    probed = vault.probe("notion")
    assert probed.health == "healthy"
    assert getattr(probed, "notice", "") == notice, "the probe erased the reset sentence"
