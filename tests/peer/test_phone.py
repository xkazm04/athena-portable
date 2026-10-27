"""The phone page on the peer listener: open, fixed files, no traversal (ADR 0140, WP4).

athena/peer/phone.py - peer_routes and serve, over a real peer socket built as athena serve builds
it, with the beacon on so the listener is bound.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from athena.peer.phone import FILES, MOBILE_DIR, SECURITY_HEADERS, serve

from .conftest import Device, http


@pytest.fixture
def beacon(device: Device) -> Device:
    assert device.ui("/devices/beacon", method="PUT", body={"on": True}).status == 200
    return device


def get(device: Device, path: str) -> tuple[int, dict[str, str], bytes]:
    from http.client import HTTPConnection

    connection = HTTPConnection("127.0.0.1", device.peer_port, timeout=10)
    try:
        connection.request("GET", path)
        answer = connection.getresponse()
        return answer.status, {k.lower(): v for k, v in answer.getheaders()}, answer.read()
    finally:
        connection.close()


def test_the_shell_is_served_without_a_token(beacon: Device) -> None:
    status, headers, body = get(beacon, "/m/")
    assert status == 200
    assert headers["content-type"] == "text/html; charset=utf-8"
    assert b'<script type="module" src="app.js"></script>' in body


@pytest.mark.parametrize("name", sorted(FILES))
def test_every_file_has_its_own_content_type_and_the_security_headers(
    beacon: Device, name: str
) -> None:
    status, headers, body = get(beacon, f"/m/{name}")
    assert status == 200
    assert headers["content-type"] == FILES[name]
    assert body == (MOBILE_DIR / name).read_bytes()
    for header, value in SECURITY_HEADERS.items():
        assert headers[header.lower()] == value
    assert "'unsafe-inline'" not in headers["content-security-policy"]


def test_m_without_its_slash_redirects_to_the_page(beacon: Device) -> None:
    status, headers, _ = get(beacon, "/m")
    assert status == 308
    assert headers["location"] == "/m/"


@pytest.mark.parametrize(
    "path",
    [
        "/m/../routes.py",
        "/m/%2e%2e/routes.py",
        "/m/..%2f..%2fwiring.py",
        "/m/%2e%2e%5csetup.py",
        "/m/mobile/app.js",
        "/m/app.js/",
        "/m/APP.JS",
        "/m/index.html%00",
        "/m/nothing.html",
    ],
)
def test_anything_but_a_listed_name_is_a_404_not_a_file(beacon: Device, path: str) -> None:
    status, headers, body = get(beacon, path)
    assert status == 404
    assert b"import" not in body and b"<html" not in body
    assert headers["x-content-type-options"] == "nosniff"


def test_the_rest_of_the_listener_still_wants_a_token(beacon: Device) -> None:
    assert http(beacon.peer_port, "/peer/hello").status == 401
    assert http(beacon.peer_port, "/peer/brain/manifest").status == 401


def test_the_page_never_writes_html_from_a_string() -> None:
    script = (MOBILE_DIR / "app.js").read_text(encoding="utf-8")
    assert "innerHTML" not in script and "insertAdjacentHTML" not in script
    assert "eval(" not in script
    # The claim is read from the fragment and wiped from the address bar.
    assert "history.replaceState" in script


def test_serve_reads_only_from_its_own_directory(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<p>elsewhere</p>", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("no", encoding="utf-8")
    assert serve("index.html", tmp_path).body == b"<p>elsewhere</p>"
    assert serve("secret.txt", tmp_path).status == 404
    assert serve("app.js", tmp_path).status == 404  # listed, but not there: still a 404


def test_the_offline_shell_precaches_every_served_file() -> None:
    # sw.js caches the shell for a page opened offline; a module the page imports but the cache
    # lacks would leave that page broken. "./" is the shell's own URL; sw.js is the worker itself.
    script = (MOBILE_DIR / "sw.js").read_text(encoding="utf-8")
    match = re.search(r"const FILES = \[([^\]]*)\];", script)
    assert match is not None
    cached = set(re.findall(r'"([^"]+)"', match.group(1)))
    assert cached - {"./"} == set(FILES) - {"sw.js"}
    assert "./" in cached


def test_a_hidden_element_stays_hidden_whatever_its_display() -> None:
    # app.js hides the empty cards list and the banner with the `hidden` attribute, and `.cards`
    # sets `display: flex`, which beats the browser's own `[hidden] { display: none }`: the empty
    # "Waiting on you" region would still take its row and gap and be exposed to a screen reader.
    css = (MOBILE_DIR / "app.css").read_text(encoding="utf-8")
    script = (MOBILE_DIR / "app.js").read_text(encoding="utf-8")
    assert ".hidden = " in script and "hidden: true" in script
    assert re.search(r"\[hidden\]\s*\{[^}]*display:\s*none\s*!important", css)


def test_read_it_first_is_a_tap_target_a_thumb_can_hit() -> None:
    # A card's "Read it first" <summary> is the only way to see what Sign would run. At the card's
    # 13px text and 1.45 line height it was a 19px-tall target; every button here is 44px.
    css = (MOBILE_DIR / "app.css").read_text(encoding="utf-8")
    rule = re.search(r"\.card summary\s*\{([^}]*)\}", css)
    assert rule is not None
    assert re.search(r"min-height:\s*44px", rule.group(1))
