"""Fake Gmail and Notion for the connect-then-use journey (README §4; ADR 0021; uat J6).

Test-only, and it lives only here. The vault is built exactly as ``athena serve`` builds it, with
two things handed in through its own constructor: this module's :class:`FakeProviders` as the
``transport`` and a consent page that plays the browser as ``open_browser``. The specs, the host
pin and the redirect handling are production code and unchanged: the fake answers the *pinned
production hosts* of ``gmail.json`` and ``notion.json``, and a request for any other host is
answered 599 and logged as not answered, so a test can prove nothing left for a real one.

The daemon is a subprocess, so the fake keeps its state on disk under ``ATHENA_HOME``:

* ``fake-providers/control.json`` is read on **every** request. A test writes it to pick the Gmail
  account the next grant is for, to revoke the grant, or to make Notion answer 401.
* ``fake-providers/log.ndjson`` gets one line per request the vault made: method, host, path, the
  status given, whether the fake knew the route, and for a send the decoded message. No
  credential is written to it.
"""

from __future__ import annotations

import base64
import json
import os
import threading
import urllib.parse
from collections.abc import Mapping
from email import message_from_bytes
from http.client import HTTPConnection
from pathlib import Path
from typing import Any

GMAIL_HOSTS = ("gmail.googleapis.com", "www.googleapis.com", "oauth2.googleapis.com")
NOTION_HOSTS = ("api.notion.com",)
CONSENT_HOST = "accounts.google.com"

DIRNAME = "fake-providers"
CONTROL = "control.json"
LOG = "log.ndjson"

#: A message in the fake mailbox, and the page Notion has shared with the integration.
MAIL_ID = "m-overdue-1"
MAIL_FROM = "Dana Client <dana@client.example>"
MAIL_SUBJECT = "Invoice 7 is overdue"
MAIL_BODY = "Hi, invoice 7 is still unpaid. Can you resend the link? Thanks, Dana"
SHARED_PAGE = "1" * 32
SHARED_TITLE = "Client chase notes"

_lock = threading.Lock()


def directory() -> Path:
    return Path(os.environ["ATHENA_HOME"]) / DIRNAME


def control() -> dict[str, Any]:
    try:
        data = json.loads((directory() / CONTROL).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode("utf-8")).decode("ascii").rstrip("=")


def _record(entry: dict[str, Any]) -> None:
    where = directory()
    where.mkdir(parents=True, exist_ok=True)
    with _lock, (where / LOG).open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry) + "\n")


class FakeProviders:
    """The vault's ``Transport``: ``(method, url, headers, body, timeout) -> (status, bytes)``."""

    def __init__(self) -> None:
        self._grants = 0

    def __call__(
        self, method: str, url: str, headers: Mapping[str, str], body: bytes | None, timeout: float
    ) -> tuple[int, bytes]:
        parts = urllib.parse.urlsplit(url)
        host = parts.hostname or ""
        entry: dict[str, Any] = {"method": method, "host": host, "path": parts.path}
        known = host in GMAIL_HOSTS or host in NOTION_HOSTS
        if not known:
            status, answer = 599, {"error": "a host the fake does not stand in for"}
        elif host in GMAIL_HOSTS:
            status, answer = self._gmail(method, host, parts, headers, body, entry)
        else:
            status, answer = self._notion(method, parts, headers, body, entry)
        entry.update(status=status, answered=known and entry.get("answered", True))
        _record(entry)
        return status, json.dumps(answer).encode("utf-8")

    # -- Gmail ----------------------------------------------------------------------------------

    def _account_of(self, headers: Mapping[str, str]) -> str:
        auth = headers.get("Authorization", "")
        token = auth.removeprefix("Bearer ").strip()
        # ya29.fake.<account, base64url>.<n>: the grant remembers whose it is.
        if not token.startswith("ya29.fake."):
            return ""
        coded = token.split(".")[2]
        return base64.urlsafe_b64decode(coded + "=" * (-len(coded) % 4)).decode("utf-8")

    def _gmail(
        self,
        method: str,
        host: str,
        parts: urllib.parse.SplitResult,
        headers: Mapping[str, str],
        body: bytes | None,
        entry: dict[str, Any],
    ) -> tuple[int, Any]:
        path, state = parts.path, control()
        if host == "oauth2.googleapis.com" and path == "/token" and method == "POST":
            form = dict(urllib.parse.parse_qsl((body or b"").decode("ascii")))
            entry["grant"] = form.get("grant_type", "")
            if form.get("grant_type") == "authorization_code":
                if not form.get("code", "").startswith("fake-code") or not form.get(
                    "code_verifier"
                ):
                    return 400, {"error": "invalid_grant"}
            elif form.get("grant_type") == "refresh_token":
                if state.get("gmail_revoked"):
                    return 400, {"error": "invalid_grant"}
            else:
                return 400, {"error": "unsupported_grant_type"}
            self._grants += 1
            account = str(state.get("gmail_account", "mira@studio.example"))
            return 200, {
                "access_token": f"ya29.fake.{_b64(account)}.{self._grants}",
                "refresh_token": f"1//fake-refresh-{self._grants}",
                "expires_in": int(state.get("gmail_expires_in", 3600)),
                "token_type": "Bearer",
            }
        if host == "oauth2.googleapis.com" and path == "/revoke" and method == "POST":
            return 200, {}
        if host != "gmail.googleapis.com":
            entry["answered"] = False
            return 404, {"error": "no such route"}
        account = self._account_of(headers)
        if not account or state.get("gmail_revoked"):
            return 401, {"error": {"code": 401, "status": "UNAUTHENTICATED"}}
        base = "/gmail/v1/users/me"
        query = dict(urllib.parse.parse_qsl(parts.query))
        if method == "GET" and path == f"{base}/profile":
            return 200, {"emailAddress": account, "messagesTotal": 1}
        if method == "GET" and path == f"{base}/messages":
            hit = bool(query.get("q", "").strip())
            return 200, {"messages": [{"id": MAIL_ID, "threadId": "t1"}]} if hit else {}
        if method == "GET" and path == f"{base}/messages/{MAIL_ID}":
            return 200, self._message(full=query.get("format") == "full")
        if method == "POST" and path == f"{base}/messages/send":
            raw = json.loads(body or b"{}").get("raw", "")
            mail = message_from_bytes(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
            payload = mail.get_payload(decode=True)
            entry["sent"] = {
                "from_account": account,
                "to": str(mail["To"]),
                "cc": str(mail["Cc"] or ""),
                "subject": str(mail["Subject"]),
                "body": payload.decode("utf-8") if isinstance(payload, bytes) else "",
            }
            return 200, {"id": f"sent-{self._grants}-{len(raw) % 97}", "labelIds": ["SENT"]}
        entry["answered"] = False
        return 404, {"error": "no such route"}

    def _message(self, *, full: bool) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "headers": [
                {"name": "From", "value": MAIL_FROM},
                {"name": "To", "value": "mira@studio.example"},
                {"name": "Subject", "value": MAIL_SUBJECT},
                {"name": "Date", "value": "Fri, 09 Oct 2026 10:00:00 +0000"},
            ]
        }
        if full:
            payload["mimeType"] = "text/plain"
            payload["body"] = {"data": _b64(MAIL_BODY)}
        return {"id": MAIL_ID, "snippet": MAIL_BODY[:40], "payload": payload}

    # -- Notion ---------------------------------------------------------------------------------

    def _notion(
        self,
        method: str,
        parts: urllib.parse.SplitResult,
        headers: Mapping[str, str],
        body: bytes | None,
        entry: dict[str, Any],
    ) -> tuple[int, Any]:
        path, state = parts.path, control()
        if state.get("notion_mode") == "401" or not headers.get("Authorization", "").strip():
            return 401, {"object": "error", "status": 401, "code": "unauthorized"}
        sent = json.loads(body) if body else {}
        if method == "GET" and path == "/v1/users/me":
            return 200, {"object": "user", "type": "bot", "name": "Fake Integration"}
        if method == "POST" and path == "/v1/search":
            return 200, {"results": [self._page(SHARED_PAGE)]}
        segments = path.split("/")
        if len(segments) >= 4 and segments[2] in ("pages", "blocks"):
            if segments[3] != SHARED_PAGE:
                # What Notion says about a page the integration was never added to.
                return 404, {"object": "error", "status": 404, "code": "object_not_found"}
            if method == "GET" and segments[2] == "pages":
                return 200, self._page(SHARED_PAGE)
            if method == "GET":
                return 200, {
                    "results": [
                        {
                            "type": "paragraph",
                            "paragraph": {"rich_text": [{"plain_text": "Chase on day 3."}]},
                        }
                    ]
                }
            if method == "PATCH":
                entry["appended"] = {"page": segments[3], "children": sent.get("children")}
                return 200, {"results": []}
        if method == "POST" and path == "/v1/pages":
            entry["created"] = sent
            return 200, {"object": "page", "id": "2" * 32}
        entry["answered"] = False
        return 404, {"object": "error", "code": "no_such_route"}

    def _page(self, page_id: str) -> dict[str, Any]:
        return {
            "object": "page",
            "id": page_id,
            "properties": {
                "title": {"type": "title", "title": [{"plain_text": SHARED_TITLE}]},
            },
        }


def play_consent(authorize_url: str) -> None:
    """The browser, as a person would be: open the consent page, press Allow. Google redirects to
    the loopback ``redirect_uri`` with a code and the flow's own ``state``."""
    parts = urllib.parse.urlsplit(authorize_url)
    query = dict(urllib.parse.parse_qsl(parts.query))
    _record({"method": "GET", "host": parts.hostname, "path": parts.path, "consent": True})
    if parts.hostname != CONSENT_HOST or query.get("response_type") != "code":
        return
    redirect = query["redirect_uri"]
    if not redirect.startswith("http://127.0.0.1:"):
        return
    back = urllib.parse.urlencode({"code": "fake-code-1", "state": query["state"]})
    # The loopback listener of this very process: the only socket the journey opens. http.client
    # rather than urllib, so no proxy variable of the machine can carry it anywhere else.
    target = urllib.parse.urlsplit(redirect)
    connection = HTTPConnection(target.hostname or "127.0.0.1", target.port or 80, timeout=10)
    try:
        connection.request("GET", f"{target.path}?{back}")
        connection.getresponse().read()
    finally:
        connection.close()
