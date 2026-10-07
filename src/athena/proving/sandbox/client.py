"""Token Factory Sandboxes over stdlib HTTP: the branching-world adapter (README §9; ADR 0033).

Sandboxes (the Contree service) runs one command per microVM against an immutable filesystem
image and, unless the run is disposable, saves the resulting filesystem as a new image. That new
image *is* the checkpoint: running two commands on the same image is a fork. Nothing else is
needed for the spike, so this adapter speaks five REST calls and nothing more:

- ``GET  /v1/whoami``                     — which permissions the key holds in the project
- ``POST /v1/images/import``              — pull a public OCI image (async operation)
- ``POST /v1/files``                      — upload a blob to inject into a run
- ``POST /v1/instances``                  — run one command (async operation)
- ``GET  /v1/operations/{id}``            — poll an operation to its end
- ``GET  /v1/inspect/{image}/download``   — read one file out of an image

**Why not the SDK.** ``contree-sdk`` 0.3.6 pulls httpx, cattrs, aiofiles and strenum, its
published "Getting Started" constructor (``ContreeSync(api_client)``) raises on the released
version, and it folds the service's ``Insufficient permissions: spawn`` into a generic
``ForbiddenError``. Five calls over ``urllib`` cost less than an extra (ADR 0002, ADR 0033).

**Auth.** The Token Factory key (``NEBIUS_API_KEY``) as a bearer, plus a ``Project`` header that
the service requires and Token Factory never shows: the ``aiproject-…`` id the key was minted in,
read from ``NEBIUS_AI_PROJECT`` (the CLI's name for it). The key is presence, never content: it
is in no ``repr``, no error sentence, no report.

**Errors are the service's own words.** The hackathon feedback wants them verbatim, so a failure
keeps the ``error`` field of the JSON body — scrubbed of the key and bounded, with the cut
announced — and the HTTP status.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

__all__ = [
    "API_KEY_ENV",
    "DEFAULT_BASE_URL",
    "ERROR_CHARS",
    "OUTPUT_CHARS",
    "PROJECT_ENV",
    "TERMINAL",
    "Http",
    "HttpReply",
    "Operation",
    "SandboxClient",
    "SandboxError",
    "bounded",
    "urllib_http",
]

#: The key. The same one the ``nebius`` engine reads (ADR 0031).
API_KEY_ENV = "NEBIUS_API_KEY"

#: The project the key belongs to (``aiproject-…``). ``contree auth`` reads this name;
#: ``contree-sdk``'s ``IAMAuth`` reads ``NEBIUS_PROJECT_ID`` instead — a gap we report.
PROJECT_ENV = "NEBIUS_AI_PROJECT"

#: The public IAM-fronted endpoint, from the OpenAPI ``servers`` block (``{baseUrl}/v1``).
DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/sandboxes/v1"

#: An operation in one of these states will not change again.
TERMINAL = frozenset({"SUCCESS", "FAILED", "CANCELLED"})

#: How much of a service error sentence a record keeps.
ERROR_CHARS = 300

#: How much of a run's stdout or stderr a record keeps.
OUTPUT_CHARS = 4000


@dataclass(frozen=True)
class HttpReply:
    """A status, the body and the headers. An HTTP error is a reply, not an exception."""

    status: int
    body: bytes = b""
    headers: Mapping[str, str] = field(default_factory=dict)


Http = Callable[[str, str, Mapping[str, str], bytes | None, float], HttpReply]
"""``(method, url, headers, body, timeout) -> reply``; raises ``OSError`` when the network is down.

The seam the tests replace: nothing under ``tests/`` opens a socket to Sandboxes.
"""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """``/inspect/?tag=`` answers with a 302 whose target is the finding; never follow it."""

    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


def urllib_http(
    method: str, url: str, headers: Mapping[str, str], body: bytes | None, timeout: float
) -> HttpReply:
    """One request with the standard library."""
    request = urllib.request.Request(url, data=body, headers=dict(headers), method=method)
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(request, timeout=timeout) as response:
            return HttpReply(int(response.status), response.read(), dict(response.headers))
    except urllib.error.HTTPError as exc:
        try:
            payload = exc.read()
        finally:
            exc.close()
        return HttpReply(int(exc.code), payload, dict(exc.headers or {}))
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, TimeoutError):
            raise TimeoutError("timed out") from None
        raise OSError(f"could not reach Sandboxes: {type(exc.reason).__name__}") from None


class SandboxError(RuntimeError):
    """A call the service refused, or an operation that did not succeed.

    ``status`` is the HTTP status (0 for an operation that ended badly); ``detail`` is the
    service's own sentence, scrubbed and bounded.
    """

    def __init__(self, call: str, status: int, detail: str) -> None:
        super().__init__(f"{call}: {status} {detail}".strip())
        self.call = call
        self.status = status
        self.detail = detail


@dataclass(frozen=True)
class Operation:
    """One finished (or abandoned) operation, reduced to what a probe reads.

    ``wall_s`` is the client's clock from spawn to the terminal poll; ``duration_s`` is the
    service's own ``duration`` when it reports one. The request's ``env`` is never kept: the
    service echoes it in ``metadata``, and a branch's env carries the key.
    """

    op_id: str
    status: str
    exit_code: int | None = None
    stdout: str = ""
    stderr: str = ""
    result_image: str | None = None
    error: str = ""
    wall_s: float = 0.0
    duration_s: float | None = None
    timed_out: bool = False

    @property
    def ok(self) -> bool:
        return self.status == "SUCCESS" and self.exit_code in (0, None) and not self.timed_out


@dataclass
class SandboxClient:
    """The five calls, plus ``run`` = spawn then wait."""

    api_key: str | None = field(default=None, repr=False)
    project: str | None = None
    base_url: str = DEFAULT_BASE_URL
    http: Http = field(default=urllib_http, repr=False)
    clock: Callable[[], float] = field(default=time.perf_counter, repr=False)
    sleep: Callable[[float], None] = field(default=time.sleep, repr=False)
    timeout_s: float = 60.0
    poll_s: float = 0.5

    def __post_init__(self) -> None:
        if self.api_key is None:
            self.api_key = os.environ.get(API_KEY_ENV, "")
        if self.project is None:
            self.project = os.environ.get(PROJECT_ENV, "")
        self.api_key = self.api_key.strip()
        self.project = self.project.strip()

    # --- calls -----------------------------------------------------------------------------

    def whoami(self) -> dict[str, Any]:
        """The token's permissions and the account's limits."""
        return self._json("whoami", "GET", "/whoami")

    def import_image(self, registry_url: str, *, tag: str | None = None, timeout: int = 900) -> str:
        """Start an import of a public OCI image; returns the operation id."""
        body: dict[str, Any] = {"registry": {"url": registry_url}, "timeout": timeout}
        if tag:
            body["tag"] = tag
        reply = self._json("import", "POST", "/images/import", body)
        return str(reply["uuid"])

    def upload(self, content: bytes) -> str:
        """Upload a blob; returns the file uuid a run's ``files`` map can name."""
        reply = self._json("upload", "POST", "/files", raw=content)
        return str(reply["uuid"])

    def spawn(
        self,
        command: str,
        image: str,
        *,
        disposable: bool = False,
        env: Mapping[str, str] | None = None,
        files: Mapping[str, str] | None = None,
        networking: bool = True,
        timeout: int = 300,
        cwd: str = "",
    ) -> str:
        """Start one shell command on ``image`` (a uuid, or ``tag:name``); returns the op id."""
        body: dict[str, Any] = {
            "command": command,
            "image": image,
            "shell": True,
            "disposable": disposable,
            "timeout": timeout,
            "networking": {"enabled": networking},
        }
        if env:
            body["env"] = dict(env)
        if cwd:
            body["cwd"] = cwd
        if files:
            body["files"] = {path: {"uuid": uuid} for path, uuid in files.items()}
        reply = self._json("spawn", "POST", "/instances", body)
        return str(reply["uuid"])

    def status(self, op_id: str) -> dict[str, Any]:
        return self._json("status", "GET", f"/operations/{urllib.parse.quote(op_id)}")

    def wait(
        self, op_id: str, *, started: float | None = None, limit_s: float = 900.0
    ) -> Operation:
        """Poll until the operation ends or ``limit_s`` passes. Never raises for a bad ending."""
        begin = self.clock() if started is None else started
        while True:
            data = self.status(op_id)
            state = str(data.get("status", ""))
            if state in TERMINAL:
                return _operation(op_id, data, self.clock() - begin, self._scrub)
            if self.clock() - begin > limit_s:
                return Operation(
                    op_id,
                    state or "UNKNOWN",
                    error=f"still {state or 'unknown'} after {limit_s:g}s",
                    wall_s=self.clock() - begin,
                    timed_out=True,
                )
            self.sleep(self.poll_s)

    def run(self, command: str, image: str, **kwargs: Any) -> Operation:
        """Spawn and wait. The wall clock starts before the spawn call."""
        begin = self.clock()
        op_id = self.spawn(command, image, **kwargs)
        return self.wait(op_id, started=begin)

    def read_file(self, image: str, path: str) -> bytes:
        """One file's bytes from an image's filesystem (no VM is started)."""
        query = urllib.parse.urlencode({"path": path})
        reply = self._call("GET", f"/inspect/{urllib.parse.quote(image)}/download?{query}")
        if not 200 <= reply.status < 300:
            raise SandboxError("read_file", reply.status, self._detail(reply.body))
        return reply.body

    # --- plumbing --------------------------------------------------------------------------

    def _headers(self, content_type: str) -> dict[str, str]:
        headers = {"Accept": "application/json", "Content-Type": content_type}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if self.project:
            headers["Project"] = self.project
        return headers

    def _call(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        content_type: str = "application/json",
    ) -> HttpReply:
        return self.http(
            method,
            self.base_url.rstrip("/") + path,
            self._headers(content_type),
            body,
            self.timeout_s,
        )

    def _json(
        self,
        call: str,
        method: str,
        path: str,
        body: Mapping[str, Any] | None = None,
        *,
        raw: bytes | None = None,
    ) -> dict[str, Any]:
        if raw is not None:
            reply = self._call(method, path, raw, "application/octet-stream")
        else:
            payload = json.dumps(body).encode("utf-8") if body is not None else None
            reply = self._call(method, path, payload)
        if not 200 <= reply.status < 300:
            raise SandboxError(call, reply.status, self._detail(reply.body))
        try:
            data = json.loads(reply.body or b"{}")
        except ValueError:
            raise SandboxError(call, reply.status, "the reply was not JSON") from None
        if not isinstance(data, dict):
            raise SandboxError(call, reply.status, "the reply was not a JSON object")
        return data

    def _detail(self, body: bytes) -> str:
        try:
            data = json.loads(body)
            text = data.get("error", "") if isinstance(data, dict) else ""
            text = text if isinstance(text, str) else json.dumps(text)
        except ValueError:
            text = body.decode("utf-8", "replace")
        return self._scrub(text)

    def _scrub(self, text: str, limit: int = ERROR_CHARS) -> str:
        if self.api_key:
            text = text.replace(self.api_key, "<key>")
        return bounded(text.strip(), limit)


def bounded(text: str, limit: int) -> str:
    """``text`` cut to ``limit`` characters, and the cut announced (AGENTS.md)."""
    if len(text) <= limit:
        return text
    return f"{text[:limit]} (showing {limit} of {len(text)})"


def _stream(value: Any) -> str:
    """A ``StreamRepr`` (``{value, encoding}``) or a bare string, as text."""
    if isinstance(value, str):
        return value
    if not isinstance(value, dict):
        return ""
    raw = value.get("value", "")
    if not isinstance(raw, str):
        return ""
    if value.get("encoding") == "base64":
        import base64

        return base64.b64decode(raw).decode("utf-8", "replace")
    return raw


def _operation(
    op_id: str, data: Mapping[str, Any], wall_s: float, scrub: Callable[[str, int], str]
) -> Operation:
    metadata = data.get("metadata")
    result = metadata.get("result") if isinstance(metadata, dict) else None
    result = result if isinstance(result, dict) else {}
    state = result.get("state")
    state = state if isinstance(state, dict) else {}
    exit_code = state.get("exit_code")
    duration = data.get("duration")
    error = data.get("error")
    return Operation(
        op_id=op_id,
        status=str(data.get("status", "")),
        exit_code=exit_code if isinstance(exit_code, int) else None,
        stdout=scrub(_stream(result.get("stdout")), OUTPUT_CHARS),
        stderr=scrub(_stream(result.get("stderr")), OUTPUT_CHARS),
        result_image=_result_image(data),
        error=scrub(error, ERROR_CHARS) if isinstance(error, str) else "",
        wall_s=wall_s,
        duration_s=float(duration) if isinstance(duration, int | float) else None,
        timed_out=bool(state.get("timed_out", False)),
    )


def _result_image(data: Mapping[str, Any]) -> str | None:
    """The image an operation produced: a run's ``result_image_uuid``, an import's ``result``."""
    image = data.get("result_image_uuid")
    if isinstance(image, str) and image:
        return image
    result = data.get("result")
    if isinstance(result, dict) and isinstance(result.get("image"), str):
        return str(result["image"])
    return None
