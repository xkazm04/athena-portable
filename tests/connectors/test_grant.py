"""The OAuth grant: refresh classified, rotated, done off the lock; 401, 403 and 429 told apart;
the client pair sealed only by a flow that succeeded (connectors/vault.py; README §4; ADR 0021)."""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Iterator, Mapping
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest

from athena.connectors.seal import FileSeal
from athena.connectors.service import Service
from athena.connectors.spec import ConnectorSpec
from athena.connectors.vault import (
    NeedsReauth,
    NotConnected,
    RateLimited,
    RefreshFailed,
    Vault,
    VaultError,
)

from .conftest import Answer, FakeProvider

PROFILE = "https://gmail.googleapis.com/gmail/v1/users/me/profile"
ME = "me@example.test"


class Google:
    """A scripted Google. The token endpoint answers :attr:`token`; every API call :attr:`api`.
    ``block`` holds a token POST until ``release`` is set, so a test can act during a refresh."""

    def __init__(self) -> None:
        self.token: Answer = (200, {"access_token": "ya29.new", "expires_in": 3600})
        self.api: Answer = (200, {"emailAddress": ME})
        self.posts: list[dict[str, str]] = []
        self.block = False
        self.entered = threading.Event()
        self.release = threading.Event()

    def __call__(
        self, method: str, url: str, headers: Mapping[str, str], body: bytes | None
    ) -> Answer:
        path = urlsplit(url).path
        if path == "/revoke":
            return 200, {}
        if path == "/token":
            form = {k: v[0] for k, v in parse_qs((body or b"").decode("ascii")).items()}
            self.posts.append(form)
            if self.block:
                self.entered.set()
                assert self.release.wait(5), "the test never released the refresh"
            return self.token
        return self.api


def _vault(tmp_path: Path, specs: dict[str, ConnectorSpec], google: Google) -> Vault:
    return Vault(
        tmp_path / "connectors",
        specs=specs,
        transport=FakeProvider(script=google),
        seal=FileSeal(tmp_path / "connectors" / "sealed"),
        open_browser=lambda url: None,
    )


@pytest.fixture
def google() -> Google:
    return Google()


@pytest.fixture
def stale(tmp_path: Path, specs: dict[str, ConnectorSpec], google: Google) -> Vault:
    """Gmail admitted as the exchange would, with a refresh token, a client pair, and an access
    token already under the refresh floor, so the next call refreshes."""
    vault = _vault(tmp_path, specs, google)
    vault._admit(
        specs["gmail"], "ya29.old", refresh="1//old", expires_in=1, client=("cid", "csecret")
    )
    return vault


def _auth_of_last_call(vault: Vault) -> str:
    provider = vault.transport
    assert isinstance(provider, FakeProvider)
    return provider.seen[-1].headers.get("Authorization", "")


# -- item 1: only a terminal answer marks needs_reauth ---------------------------------------------

TERMINAL: dict[str, Answer] = {
    "400 invalid_grant": (400, {"error": "invalid_grant", "error_description": "revoked"}),
    "401 invalid_client": (401, {"error": "invalid_client"}),
    "403 unauthorized_client": (403, {"error": "unauthorized_client"}),
    "400 unreadable": (400, b"<html>bad request</html>"),
    "401 no error": (401, {}),
}


@pytest.mark.parametrize("name", sorted(TERMINAL))
def test_a_terminal_refresh_answer_marks_needs_reauth_and_names_the_status(
    name: str, stale: Vault, google: Google
) -> None:
    google.token = TERMINAL[name]
    status = str(TERMINAL[name][0])
    with pytest.raises(NeedsReauth, match=status) as caught:
        stale.request("gmail", "GET", PROFILE)
    assert "reconnected in Connectors" in str(caught.value)
    assert stale.record("gmail").status == "needs_reauth"
    assert not stale.is_live("gmail")


TRANSIENT: dict[str, Answer] = {
    "429": (429, {"error": "rate_limited"}),
    "500": (500, {}),
    "503 even naming invalid_grant": (503, {"error": "invalid_grant"}),
    "302": (302, b""),
    "200 without access_token": (200, {"token_type": "Bearer"}),
    "400 invalid_request": (400, {"error": "invalid_request"}),
    "403 access_denied": (403, {"error": "access_denied"}),
}


@pytest.mark.parametrize("name", sorted(TRANSIENT))
def test_a_transient_refresh_answer_keeps_the_grant_connected(
    name: str, stale: Vault, google: Google
) -> None:
    google.token = TRANSIENT[name]
    status = str(TRANSIENT[name][0])
    with pytest.raises((RefreshFailed, RateLimited), match=status) as caught:
        stale.request("gmail", "GET", PROFILE)
    assert "connection is kept" in str(caught.value)
    assert stale.record("gmail").status == "connected"
    assert stale.is_live("gmail")
    # The next refresh that works is used: nothing was lost by the failure.
    google.token = (200, {"access_token": "ya29.after", "expires_in": 3600})
    status_code, _ = stale.request("gmail", "GET", PROFILE)
    assert status_code == 200 and _auth_of_last_call(stale) == "Bearer ya29.after"


def test_a_refresh_that_cannot_reach_the_endpoint_keeps_the_grant(
    stale: Vault, google: Google
) -> None:
    provider = stale.transport
    assert isinstance(provider, FakeProvider)

    def unreachable(
        method: str, url: str, headers: Mapping[str, str], body: bytes | None
    ) -> Answer:
        if urlsplit(url).path == "/token":
            raise VaultError("the provider could not be reached: TimeoutError")
        return google(method, url, headers, body)

    provider.script = unreachable
    with pytest.raises(RefreshFailed, match="TimeoutError"):
        stale.request("gmail", "GET", PROFILE)
    assert stale.record("gmail").status == "connected"


@pytest.mark.parametrize("expiry", ["soon", [], {"s": 1}, True])
def test_an_expiry_that_is_not_a_number_is_a_vault_error_and_commits_nothing(
    expiry: Any, stale: Vault, google: Google
) -> None:
    google.token = (200, {"access_token": "ya29.new", "expires_in": expiry})
    with pytest.raises(VaultError, match="not a number"):
        stale.request("gmail", "GET", PROFILE)
    assert stale.record("gmail").status == "connected"
    assert stale._get("gmail", "token") == "ya29.old", "the old access token is kept"


def test_a_rate_limited_refresh_carries_the_retry_after(stale: Vault, google: Google) -> None:
    google.token = (429, {}, {"Retry-After": "12"})
    with pytest.raises(RateLimited, match="12 s") as caught:
        stale.request("gmail", "GET", PROFILE)
    assert caught.value.retry_after == 12 and caught.value.status == 429


# -- item 3: a refresh that works seals what it was given ------------------------------------------


def test_a_refresh_seals_the_new_token_and_sets_the_expiry(stale: Vault, google: Google) -> None:
    before = datetime.fromisoformat(stale.record("gmail").expires_at)
    status, _ = stale.request("gmail", "GET", PROFILE)
    assert status == 200
    assert _auth_of_last_call(stale) == "Bearer ya29.new"
    assert stale._get("gmail", "token") == "ya29.new"
    after = datetime.fromisoformat(stale.record("gmail").expires_at)
    assert (after - before).total_seconds() > 3000
    assert google.posts[0] == {
        "grant_type": "refresh_token",
        "refresh_token": "1//old",
        "client_id": "cid",
        "client_secret": "csecret",
    }
    stale.request("gmail", "GET", PROFILE)
    assert len(google.posts) == 1, "a fresh grant is not refreshed again"


def test_a_rotated_refresh_token_is_sealed_and_used_next_time(stale: Vault, google: Google) -> None:
    google.token = (200, {"access_token": "ya29.1", "expires_in": 1, "refresh_token": "1//new"})
    stale.request("gmail", "GET", PROFILE)
    assert stale._get("gmail", "refresh") == "1//new"
    stale.request("gmail", "GET", PROFILE)  # expires_in 1: refreshes again
    assert [p["refresh_token"] for p in google.posts] == ["1//old", "1//new"]


@pytest.mark.parametrize("absent", [{}, {"refresh_token": ""}, {"refresh_token": None}])
def test_an_absent_refresh_token_keeps_the_old_one(
    absent: dict[str, Any], stale: Vault, google: Google
) -> None:
    google.token = (200, {"access_token": "ya29.1", "expires_in": 1, **absent})
    stale.request("gmail", "GET", PROFILE)
    assert stale._get("gmail", "refresh") == "1//old"


# -- item 4: the refresh runs off the lock, once, and never undoes a disconnect --------------------


def _in_thread(target: Any) -> tuple[threading.Thread, list[Any]]:
    out: list[Any] = []

    def run() -> None:
        try:
            out.append(target())
        except Exception as exc:  # the test reads what the call raised
            out.append(exc)

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return thread, out


def test_the_vault_answers_while_a_refresh_is_blocked(stale: Vault, google: Google) -> None:
    google.block = True
    caller, result = _in_thread(lambda: stale.request("gmail", "GET", PROFILE))
    assert google.entered.wait(5)
    asker, live = _in_thread(lambda: stale.is_live("gmail"))
    asker.join(2)
    viewer, views = _in_thread(stale.views)
    viewer.join(2)
    try:
        assert not asker.is_alive() and live == [True], "is_live waited on the token POST"
        assert not viewer.is_alive() and views, "the views waited on the token POST"
    finally:
        google.release.set()
        caller.join(5)
    assert result and result[0][0] == 200


def test_two_callers_with_a_stale_token_send_one_refresh(stale: Vault, google: Google) -> None:
    google.block = True
    first, one = _in_thread(lambda: stale.request("gmail", "GET", PROFILE))
    assert google.entered.wait(5)
    second, two = _in_thread(lambda: stale.request("gmail", "GET", PROFILE))
    time.sleep(0.2)  # let the second caller reach the guard; the count holds either way
    google.release.set()
    first.join(5)
    second.join(5)
    assert one and two and one[0][0] == 200 and two[0][0] == 200
    assert len(google.posts) == 1, "each stale caller sent its own token POST"
    provider = stale.transport
    assert isinstance(provider, FakeProvider)
    used = [s.headers["Authorization"] for s in provider.seen if s.url == PROFILE][-2:]
    assert used == ["Bearer ya29.new", "Bearer ya29.new"]


def test_a_disconnect_during_a_refresh_is_not_undone(
    stale: Vault, google: Google, tmp_path: Path
) -> None:
    google.block = True
    caller, result = _in_thread(lambda: stale.request("gmail", "GET", PROFILE))
    assert google.entered.wait(5)
    disconnecting, _ = _in_thread(lambda: stale.disconnect("gmail"))
    disconnecting.join(2)
    assert not disconnecting.is_alive(), "the disconnect waited on the token POST"
    google.release.set()
    caller.join(5)
    assert result and isinstance(result[0], NotConnected)
    assert "while its grant was refreshed" in str(result[0])
    record = stale.record("gmail")
    assert record.status == "disconnected" and record.expires_at == ""
    assert list((tmp_path / "connectors" / "sealed").glob("*")) == [], "the refresh sealed again"


def test_a_terminal_refresh_after_a_reconnect_does_not_mark_the_new_grant(
    stale: Vault, google: Google, specs: dict[str, ConnectorSpec]
) -> None:
    google.block = True
    google.token = (400, {"error": "invalid_grant"})
    caller, result = _in_thread(lambda: stale.request("gmail", "GET", PROFILE))
    assert google.entered.wait(5)
    reconnect, _ = _in_thread(
        lambda: stale._admit(specs["gmail"], "ya29.second", refresh="1//second", expires_in=3600)
    )
    reconnect.join(2)
    google.release.set()
    caller.join(5)
    assert result and isinstance(result[0], NotConnected)
    assert stale.record("gmail").status == "connected"


# -- item 2: a brokered 401, 403 and 429 -----------------------------------------------------------


@pytest.fixture
def gmail(tmp_path: Path, specs: dict[str, ConnectorSpec], google: Google) -> Vault:
    vault = _vault(tmp_path, specs, google)
    vault._admit(specs["gmail"], "ya29.live", refresh="1//r", expires_in=3600)
    return vault


def _quota(reason: str) -> dict[str, Any]:
    return {
        "error": {
            "code": 403,
            "message": "Quota exceeded",
            "errors": [{"domain": "usageLimits", "reason": reason, "message": "x"}],
            "status": "PERMISSION_DENIED",
        }
    }


@pytest.mark.parametrize(
    "reason", ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded"]
)
def test_a_403_naming_a_rate_or_quota_reason_keeps_the_grant(
    reason: str, gmail: Vault, google: Google
) -> None:
    google.api = (403, _quota(reason))
    with pytest.raises(RateLimited, match="rate limited") as caught:
        gmail.request("gmail", "GET", PROFILE)
    assert "403" in str(caught.value) and caught.value.retry_after is None
    assert gmail.record("gmail").status == "connected" and gmail.is_live("gmail")


def test_a_403_resource_exhausted_keeps_the_grant(gmail: Vault, google: Google) -> None:
    google.api = (403, {"error": {"code": 403, "status": "RESOURCE_EXHAUSTED"}})
    with pytest.raises(RateLimited):
        gmail.request("gmail", "GET", PROFILE)
    assert gmail.is_live("gmail")


@pytest.mark.parametrize(
    "answer",
    [
        (401, {"error": {"code": 401, "status": "UNAUTHENTICATED"}}),
        (403, _quota("insufficientPermissions")),
        (403, {"error": {"code": 403, "status": "PERMISSION_DENIED"}}),
        (403, b"Forbidden"),
    ],
)
def test_a_401_or_an_unrecognised_403_fails_closed_to_needs_reauth(
    answer: Answer, gmail: Vault, google: Google
) -> None:
    google.api = answer
    with pytest.raises(NeedsReauth, match=str(answer[0])):
        gmail.request("gmail", "GET", PROFILE)
    assert gmail.record("gmail").status == "needs_reauth"


@pytest.mark.parametrize(
    "header, said, seconds",
    [
        ({"Retry-After": "30"}, "30 s", 30),
        ({"retry-after": "9999999"}, "86400 s", 86400),
        ({"Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT"}, "try later", None),
        ({"Retry-After": "-5"}, "try later", None),
        ({}, "try later", None),
    ],
)
def test_a_429_keeps_the_grant_and_bounds_the_retry_after(
    header: dict[str, str], said: str, seconds: int | None, gmail: Vault, google: Google
) -> None:
    google.api = (429, {"error": {"code": 429}}, header)
    with pytest.raises(RateLimited, match=said) as caught:
        gmail.request("gmail", "GET", PROFILE)
    assert caught.value.retry_after == seconds and caught.value.status == 429
    assert gmail.is_live("gmail")


def test_a_rate_limited_search_reaches_the_model_as_a_sentence_and_nothing_retries(
    gmail: Vault, google: Google
) -> None:
    google.api = (429, {}, {"Retry-After": "7"})
    provider = gmail.transport
    assert isinstance(provider, FakeProvider)
    before = len(provider.seen)
    result = Service(gmail.spec("gmail"), gmail).call("search_mail", {"query": "invoice"})
    assert not result.ok and result.error == "engine_error"
    assert "rate limited" in result.output and "429" in result.output and "7 s" in result.output
    assert len(provider.seen) == before + 1, "exactly one request, no retry"
    assert gmail.is_live("gmail")


def test_a_notion_429_is_rate_limited_and_a_notion_401_is_still_returned(
    notion: Vault, provider: FakeProvider
) -> None:
    provider.script = lambda *_: (
        429,
        {"object": "error", "code": "rate_limited"},
        {"Retry-After": "2"},
    )
    with pytest.raises(RateLimited, match="2 s"):
        notion.request("notion", "POST", "https://api.notion.com/v1/search", {"query": "x"})
    provider.script = lambda *_: (401, {"object": "error", "code": "unauthorized"})
    status, _ = notion.request("notion", "POST", "https://api.notion.com/v1/search", {})
    assert status == 401 and notion.is_live("notion")


# -- item 5: the client pair is sealed only by a flow that succeeded -------------------------------


def _callback(flow_port: int, state: str, code: str) -> None:
    url = f"http://127.0.0.1:{flow_port}/callback?state={state}&code={code}"
    try:
        with urllib.request.urlopen(url, timeout=5) as reply:
            reply.read()
    except urllib.error.HTTPError as exc:
        exc.read()


def test_a_flow_that_fails_or_is_cancelled_leaves_the_sealed_pair_and_the_grant(
    tmp_path: Path, specs: dict[str, ConnectorSpec], google: Google
) -> None:
    vault = _vault(tmp_path, specs, google)
    vault._admit(specs["gmail"], "ya29.live", refresh="1//r", expires_in=3600, client=("A", "a"))
    try:
        cancelled = vault.connect_oauth(
            "gmail", client_id="B", client_secret="b", open_browser=False
        )
        cancelled.cancel()
        assert (vault._get("gmail", "client_id"), vault._get("gmail", "client_secret")) == (
            "A",
            "a",
        )

        google.token = (400, {"error": "invalid_grant"})
        refused = vault.connect_oauth("gmail", client_id="C", client_secret="c", open_browser=False)
        _callback(refused.port, refused.state, "the-code")
        assert refused.wait(5) and refused.phase == "failed"
        assert (vault._get("gmail", "client_id"), vault._get("gmail", "client_secret")) == (
            "A",
            "a",
        )
        assert google.posts[-1]["client_secret"] == "c", "the flow's own pair was the one used"
        assert vault.is_live("gmail") and vault._get("gmail", "token") == "ya29.live"

        google.token = (200, {"access_token": "ya29.d", "refresh_token": "1//d", "expires_in": 60})
        good = vault.connect_oauth("gmail", client_id="D", client_secret="d", open_browser=False)
        _callback(good.port, good.state, "the-code")
        assert good.wait(5) and good.phase == "done", good.detail
        assert (vault._get("gmail", "client_id"), vault._get("gmail", "client_secret")) == (
            "D",
            "d",
        )
        assert vault._get("gmail", "token") == "ya29.d"
    finally:
        vault.close()


def test_a_flow_view_never_carries_the_client_secret(vault: Vault) -> None:
    flow = vault.connect_oauth(
        "gmail", client_id="cid", client_secret="s3cret-v", open_browser=False
    )
    try:
        assert "s3cret-v" not in str(flow.view()) and "s3cret-v" not in str(vault.views())
    finally:
        flow.cancel()


# -- reconnect: a lost grant reuses the client the vault already sealed (ADR 0117) ----------------

KEPT_ID = "kept-client.apps.googleusercontent.com"
KEPT_SECRET = "kept-secret-0451"


@pytest.fixture
def lost(tmp_path: Path, specs: dict[str, ConnectorSpec], google: Google) -> Iterator[Vault]:
    """Gmail admitted with a client pair, then lost: a 401 during a call marks it needs_reauth."""
    vault = _vault(tmp_path, specs, google)
    vault._admit(
        specs["gmail"], "ya29.live", refresh="1//r", expires_in=3600, client=(KEPT_ID, KEPT_SECRET)
    )
    google.api = (401, {})
    with pytest.raises(NeedsReauth):
        vault.request("gmail", "GET", PROFILE)
    google.api = (200, {"emailAddress": ME})
    try:
        yield vault
    finally:
        vault.close()


def _consent(flow: Any) -> None:
    _callback(flow.port, flow.state, "the-code")
    assert flow.wait(5), "the flow never settled"


def _kept_pair(vault: Vault) -> tuple[str | None, str | None]:
    return vault._get("gmail", "client_id"), vault._get("gmail", "client_secret")


def test_case_0_a_reconnect_reuses_the_sealed_client_for_consent_and_exchange(
    lost: Vault, google: Google
) -> None:
    assert lost.record("gmail").status == "needs_reauth"
    google.token = (200, {"access_token": "ya29.back", "refresh_token": "1//b", "expires_in": 60})
    flow = lost.connect_oauth("gmail", client_id="", client_secret="", reuse_client=True)
    asked = parse_qs(urlsplit(flow.authorize_url).query)
    assert asked["client_id"] == [KEPT_ID]
    _consent(flow)
    assert flow.phase == "done", flow.detail
    posted = google.posts[-1]
    assert posted["grant_type"] == "authorization_code"
    assert (posted["client_id"], posted["client_secret"]) == (KEPT_ID, KEPT_SECRET)
    assert lost.record("gmail").status == "connected"


def test_case_1_the_view_says_a_client_is_kept_and_never_carries_it(lost: Vault) -> None:
    view = lost.view("gmail")
    assert view["client_kept"] is True
    flow = lost.connect_oauth("gmail", client_id="", client_secret="", reuse_client=True)
    try:
        for said in (json.dumps(lost.view("gmail")), json.dumps(lost.views())):
            assert KEPT_ID not in said and KEPT_SECRET not in said
    finally:
        flow.cancel()
    assert lost.view("notion")["client_kept"] is False
    lost.disconnect("gmail")
    after = lost.view("gmail")
    assert after["client_kept"] is False
    assert KEPT_ID not in json.dumps(after) and KEPT_SECRET not in json.dumps(after)


def test_case_3_a_reconnect_as_the_same_account_keeps_the_switches(
    tmp_path: Path, specs: dict[str, ConnectorSpec], google: Google
) -> None:
    vault = _vault(tmp_path, specs, google)
    try:
        vault._admit(
            specs["gmail"],
            "ya29.live",
            refresh="1//r",
            expires_in=3600,
            client=(KEPT_ID, KEPT_SECRET),
        )
        vault.set_writes("gmail", True)
        vault.set_allowlist("gmail", ["ap@northwind.example"])
        google.token = (400, {"error": "invalid_grant"})
        vault.record("gmail").expires_at = "2000-01-01T00:00:00+00:00"
        with pytest.raises(NeedsReauth):
            vault.request("gmail", "GET", PROFILE)
        assert vault.record("gmail").status == "needs_reauth"
        google.token = (200, {"access_token": "ya29.back", "expires_in": 3600})
        flow = vault.connect_oauth(
            "gmail", client_id="", client_secret="", reuse_client=True, open_browser=False
        )
        _consent(flow)
        assert flow.phase == "done", flow.detail
        rec = vault.record("gmail")
        assert rec.status == "connected" and rec.identity == ME
        assert rec.writes_enabled is True
        assert rec.allowlist == ["ap@northwind.example"]
        assert rec.notice == ""
    finally:
        vault.close()


def test_case_4_a_reconnect_that_fails_or_is_cancelled_destroys_and_reseals_nothing(
    lost: Vault, google: Google, monkeypatch: pytest.MonkeyPatch
) -> None:
    sealed: list[str] = []
    original = lost._put

    def watching(connector_id: str, kind: str, value: str) -> None:
        sealed.append(kind)
        original(connector_id, kind, value)

    monkeypatch.setattr(lost, "_put", watching)
    cancelled = lost.connect_oauth(
        "gmail", client_id="", client_secret="", reuse_client=True, open_browser=False
    )
    cancelled.cancel()
    assert lost.record("gmail").status == "needs_reauth"
    assert _kept_pair(lost) == (KEPT_ID, KEPT_SECRET)

    google.token = (400, {"error": "invalid_grant"})
    refused = lost.connect_oauth(
        "gmail", client_id="", client_secret="", reuse_client=True, open_browser=False
    )
    _consent(refused)
    assert refused.phase == "failed"
    assert lost.record("gmail").status == "needs_reauth"
    assert _kept_pair(lost) == (KEPT_ID, KEPT_SECRET)
    assert sealed == [], "a reconnect that did not complete sealed nothing"
    assert lost.view("gmail")["client_kept"] is True


def test_a_pasted_pair_wins_over_the_kept_one_in_the_vault(lost: Vault, google: Google) -> None:
    google.token = (200, {"access_token": "ya29.other", "expires_in": 3600})
    flow = lost.connect_oauth(
        "gmail",
        client_id="pasted.apps.googleusercontent.com",
        client_secret="pasted-secret",
        reuse_client=True,
        open_browser=False,
    )
    assert parse_qs(urlsplit(flow.authorize_url).query)["client_id"] == [
        "pasted.apps.googleusercontent.com"
    ]
    _consent(flow)
    assert flow.phase == "done", flow.detail
    assert google.posts[-1]["client_secret"] == "pasted-secret"
    assert _kept_pair(lost) == ("pasted.apps.googleusercontent.com", "pasted-secret")


def test_a_reconnect_with_no_kept_client_asks_for_the_client_id(vault: Vault) -> None:
    with pytest.raises(VaultError, match="client id"):
        vault.connect_oauth("gmail", client_id="", client_secret="", reuse_client=True)


def test_a_flow_cancelled_while_its_code_is_exchanged_admits_nothing(
    tmp_path: Path, specs: dict[str, ConnectorSpec], google: Google
) -> None:
    vault = _vault(tmp_path, specs, google)
    vault._admit(specs["gmail"], "ya29.live", refresh="1//r", expires_in=3600, client=("A", "a"))
    google.token = (200, {"access_token": "ya29.late", "refresh_token": "1//l", "expires_in": 60})
    google.block = True
    try:
        flow = vault.connect_oauth("gmail", client_id="B", client_secret="b", open_browser=False)
        _callback(flow.port, flow.state, "the-code")
        assert google.entered.wait(5), "the exchange never started"
        flow.cancel("replaced by a newer flow")
        google.release.set()
        assert flow.wait(5) and flow._finisher is not None
        flow._finisher.join(5)  # the exchange thread runs on past the cancel
        assert flow.phase == "failed" and flow.detail == "replaced by a newer flow"
        assert vault._get("gmail", "token") == "ya29.live"
        assert _kept_pair(vault) == ("A", "a")
    finally:
        vault.close()
