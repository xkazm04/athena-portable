"""Gmail: three intent-shaped tools over the REST API (README §4; ADR 0021).

``search_mail`` lists ids then reads each one's metadata; ``read_mail`` reads one message in
full and takes its ``text/plain`` part; ``send_mail`` posts one RFC 2822 message. Everything on
the wire goes through the ``Request`` callable, which is the vault's and holds the credential.
"""

from __future__ import annotations

import base64
import binascii
from collections.abc import Callable, Mapping, Sequence
from email.message import EmailMessage
from typing import Any
from urllib.parse import quote

__all__ = ["API", "Request", "execute", "extract_text", "parse_metadata", "render_results"]

API = "https://gmail.googleapis.com/gmail/v1/users/me"
WANTED_HEADERS = ("From", "To", "Subject", "Date")

#: ``(method, url, json_body) -> (status, decoded body)``. The vault's door.
Request = Callable[[str, str, Any], tuple[int, Any]]


def _q(value: str) -> str:
    return quote(value, safe="")


def parse_message_ids(body: Any) -> list[str]:
    if not isinstance(body, Mapping) or not isinstance(body.get("messages"), list):
        return []
    return [str(m["id"]) for m in body["messages"] if isinstance(m, Mapping) and "id" in m]


def _headers_of(payload: Any) -> dict[str, str]:
    if not isinstance(payload, Mapping) or not isinstance(payload.get("headers"), list):
        return {}
    out: dict[str, str] = {}
    for header in payload["headers"]:
        if isinstance(header, Mapping) and str(header.get("name", "")) in WANTED_HEADERS:
            out[str(header["name"])] = str(header.get("value", ""))
    return out


def parse_metadata(body: Any) -> dict[str, str]:
    if not isinstance(body, Mapping):
        return {}
    headers = _headers_of(body.get("payload"))
    return {
        "id": str(body.get("id", "")),
        "from": headers.get("From", ""),
        "date": headers.get("Date", ""),
        "subject": headers.get("Subject", "(no subject)"),
        "snippet": str(body.get("snippet", "")),
    }


def decode_b64url(data: str) -> str:
    padded = data + "=" * (-len(data) % 4)
    try:
        return base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8", "replace")
    except (binascii.Error, ValueError, UnicodeDecodeError):
        return ""


def _parts(payload: Any) -> list[Mapping[str, Any]]:
    if not isinstance(payload, Mapping):
        return []
    found: list[Mapping[str, Any]] = [payload]
    for part in payload.get("parts") or []:
        found.extend(_parts(part))
    return found


def extract_text(body: Any) -> str:
    """The ``text/plain`` part of a full message, else its snippet."""
    if not isinstance(body, Mapping):
        return ""
    for part in _parts(body.get("payload")):
        if part.get("mimeType") != "text/plain":
            continue
        data = part.get("body")
        if isinstance(data, Mapping) and isinstance(data.get("data"), str):
            text = decode_b64url(data["data"])
            if text.strip():
                return text
    return str(body.get("snippet", ""))


def render_results(rows: Sequence[Mapping[str, str]]) -> str:
    return "\n".join(
        f"- id: {r.get('id', '')}\n  from: {r.get('from', '')}\n  date: {r.get('date', '')}\n"
        f"  subject: {r.get('subject', '')}\n  snippet: {r.get('snippet', '')}"
        for r in rows
    )


def build_send_body(
    *, to: Sequence[str], subject: str, body: str, cc: Sequence[str] = ()
) -> dict[str, str]:
    message = EmailMessage()
    message["To"] = ", ".join(to)
    if cc:
        message["Cc"] = ", ".join(cc)
    message["Subject"] = subject
    message.set_content(body)
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode("ascii").rstrip("=")
    return {"raw": raw}


def execute(request: Request, tool: str, params: Mapping[str, Any]) -> tuple[bool, str]:
    """Run one tool. ``(ok, text)``: a read's text, a write's sentence, or a refusal's reason."""
    if tool == "search_mail":
        limit = int(params.get("max_results", 5) or 5)
        status, body = request(
            "GET", f"{API}/messages?q={_q(str(params['query']))}&maxResults={limit}", None
        )
        if status >= 300:
            return False, f"Gmail answered {status} to the search"
        rows = []
        for message_id in parse_message_ids(body)[:limit]:
            headers = "".join(f"&metadataHeaders={h}" for h in WANTED_HEADERS)
            status, detail = request(
                "GET", f"{API}/messages/{_q(message_id)}?format=metadata{headers}", None
            )
            if status < 300:
                rows.append(parse_metadata(detail))
        return True, render_results(rows) if rows else "No messages matched."
    if tool == "read_mail":
        status, body = request(
            "GET", f"{API}/messages/{_q(str(params['message_id']))}?format=full", None
        )
        if status >= 300:
            return False, f"Gmail answered {status} to the read"
        meta = parse_metadata(body)
        return True, (
            f"from: {meta.get('from', '')}\ndate: {meta.get('date', '')}\n"
            f"subject: {meta.get('subject', '')}\n\n{extract_text(body)}"
        )
    if tool == "send_mail":
        payload = build_send_body(
            to=[str(a) for a in params["to"]],
            subject=str(params["subject"]),
            body=str(params["body"]),
            cc=[str(a) for a in params.get("cc", [])],
        )
        status, body = request("POST", f"{API}/messages/send", payload)
        if status >= 300:
            return False, f"Gmail answered {status} to the send"
        sent_id = body.get("id", "") if isinstance(body, Mapping) else ""
        return True, f"sent to {', '.join(str(a) for a in params['to'])} (message {sent_id})"
    return False, f"gmail has no tool {tool!r}"
