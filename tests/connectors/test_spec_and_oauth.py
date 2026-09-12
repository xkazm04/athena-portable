"""The spec parser refuses whole, the builtin specs load, and the consent flow answers only its
own callback (connectors/spec.py, connectors/oauth.py)."""

from __future__ import annotations

import json
import urllib.request
from typing import Any

import pytest

from athena.connectors.oauth import OAuthFlow, verify_state
from athena.connectors.spec import SpecError, load_builtin, parse_spec

GOOD: dict[str, Any] = {
    "id": "demo",
    "label": "Demo",
    "auth": {"type": "token"},
    "api_hosts": ["api.demo.test"],
    "probe": {"method": "get", "url": "https://api.demo.test/me", "identity_field": "name"},
    "egress": "resources",
    "tools": [
        {"name": "read", "description": "Read.", "reversible": True, "side_effects": "none"},
        {
            "name": "write",
            "description": "Write.",
            "reversible": False,
            "side_effects": "external",
            "egress_params": ["page"],
        },
    ],
}


def test_the_builtin_specs_load_and_name_their_tools() -> None:
    specs = load_builtin()
    assert sorted(specs) == ["gmail", "notion"]
    assert [t.name for t in specs["gmail"].tools] == ["search_mail", "read_mail", "send_mail"]
    assert specs["gmail"].auth.type == "oauth" and specs["gmail"].auth.pkce
    assert specs["notion"].auth.type == "token"
    assert specs["notion"].auth.extra_headers == {"Notion-Version": "2022-06-28"}
    view = specs["notion"].view()
    assert "guide" in view and view["tools"][2]["side_effects"] == "external"


def test_a_spec_parses_and_the_probe_method_is_upper_cased() -> None:
    spec = parse_spec(GOOD)
    assert spec.probe.method == "GET"
    assert spec.origin == "connector:demo"
    assert spec.tool("write") is not None and spec.tool("write").egress_params == ("page",)


@pytest.mark.parametrize(
    "broken, match",
    [
        ({**GOOD, "id": "Demo"}, "lowercase slug"),
        ({**GOOD, "auth": {"type": "magic"}}, "not one of"),
        ({**GOOD, "auth": {"type": "oauth"}}, "authorize_url"),
        ({**GOOD, "api_hosts": []}, "at least one host"),
        ({**GOOD, "egress": "everything"}, "not one of"),
        ({**GOOD, "tools": []}, "non-empty list"),
        ({**GOOD, "egress": "none"}, "egress_params"),
    ],
)
def test_a_malformed_spec_is_refused_whole(broken: dict[str, Any], match: str) -> None:
    with pytest.raises(SpecError, match=match):
        parse_spec(broken)


# -- the consent flow ----------------------------------------------------------------------------


def _get(url: str) -> tuple[int, str]:
    try:
        with urllib.request.urlopen(url, timeout=5) as reply:
            return reply.status, reply.read().decode()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()


def test_the_flow_answers_its_own_callback_and_refuses_a_stranger() -> None:
    specs = load_builtin()
    exchanged: list[str] = []

    def on_code(flow: OAuthFlow, code: str) -> str:
        exchanged.append(code)
        return "me@example.test"

    flow = OAuthFlow(
        "gmail", specs["gmail"].auth, client_id="cid", on_code=on_code, ttl_s=10
    ).start()
    try:
        assert flow.authorize_url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
        assert "code_challenge=" in flow.authorize_url and "state=" in flow.authorize_url
        assert verify_state(flow.state, flow._key)
        base = f"http://127.0.0.1:{flow.port}/callback"
        status, text = _get(f"{base}?state=forged.state&code=abc")
        assert status == 404 and "not for this flow" in text
        assert flow.phase == "awaiting_consent"
        status, text = _get(f"{base}?state={flow.state}&code=the-code")
        assert status == 200 and "connected" in text
        assert flow.wait(5) and flow.phase == "done"
        assert exchanged == ["the-code"]
        assert flow.view()["authorize_url"] == "", "the URL is not offered after consent"
    finally:
        flow.cancel()


def test_a_refused_consent_fails_the_flow() -> None:
    specs = load_builtin()
    flow = OAuthFlow(
        "gmail", specs["gmail"].auth, client_id="cid", on_code=lambda f, c: "", ttl_s=10
    ).start()
    try:
        _get(f"http://127.0.0.1:{flow.port}/callback?state={flow.state}&error=access_denied")
        assert flow.wait(5) and flow.phase == "failed"
        assert "access_denied" in flow.detail
    finally:
        flow.cancel()


def test_a_flow_view_carries_no_verifier_or_key() -> None:
    specs = load_builtin()
    flow = OAuthFlow(
        "gmail", specs["gmail"].auth, client_id="cid", on_code=lambda f, c: "", ttl_s=10
    )
    text = json.dumps(flow.view())
    # The client id is in the authorize URL by design — it is not a secret; the verifier and
    # the signing key never leave the process.
    assert flow.verifier not in text and flow._key.hex() not in text
    flow.cancel()
