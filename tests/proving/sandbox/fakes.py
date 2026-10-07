"""An in-memory Sandboxes for the WP4 spike tests (README §9; ADR 0033).

It speaks the REST shapes :class:`~athena.proving.sandbox.client.SandboxClient` sends — whoami,
import, upload, instances, operations, inspect/download — and keeps a filesystem per image, so a
non-disposable run produces a child image and a fork is a second run on the same parent. The
commands are not executed; the fake reads the few things the spike's scripts do (write a marker,
start the daemon, fetch the catalog, print versions) and answers as a healthy service would.
Knobs make it fail the way the beta did, or might.
"""

from __future__ import annotations

import base64
import itertools
import json
import re
import urllib.parse
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from athena.proving.sandbox.client import HttpReply

ALL_PERMISSIONS = {
    "import": True,
    "spawn": True,
    "spawn_disposable": True,
    "list": True,
    "cancel": True,
    "set_image_tag": True,
}


@dataclass
class FakeClock:
    now: float = 0.0
    step: float = 0.25

    def __call__(self) -> float:
        self.now += self.step
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


@dataclass
class FakeSandboxes:
    permissions: dict[str, bool] = field(default_factory=lambda: dict(ALL_PERMISSIONS))
    import_fails: bool = False
    network: bool = True
    daemon_ok: bool = True
    marker_override: str | None = None
    echo_key_in_errors: str = ""
    #: Accept spawns whatever the permission map says (a map that disagrees with the service).
    enforce_spawn: bool = True
    #: How many polls an operation stays EXECUTING before it ends.
    polls_before_done: int = 1
    calls: list[tuple[str, str]] = field(default_factory=list)
    requests: list[dict[str, Any]] = field(default_factory=list)
    headers_seen: list[Mapping[str, str]] = field(default_factory=list)
    images: dict[str, dict[str, str]] = field(default_factory=dict)
    ops: dict[str, dict[str, Any]] = field(default_factory=dict)
    _ids: itertools.count[int] = field(default_factory=lambda: itertools.count(1))

    def _id(self, prefix: str) -> str:
        return f"{prefix}-{next(self._ids):04d}"

    def __call__(
        self, method: str, url: str, headers: Mapping[str, str], body: bytes | None, timeout: float
    ) -> HttpReply:
        parsed = urllib.parse.urlsplit(url)
        path = parsed.path.split("/v1", 1)[1]
        self.calls.append((method, path))
        self.headers_seen.append(dict(headers))
        if "Project" not in headers:
            return _error(400, 'Missing "Project" header')
        if path == "/whoami":
            limits = {"instance_max_concurrency": 50}
            return _ok({"permissions": self.permissions, "limits": limits})
        if path == "/images/import" and method == "POST":
            if not self.permissions["import"]:
                return _error(403, "Insufficient permissions: import")
            return self._import(json.loads(body or b"{}"))
        if path == "/files" and method == "POST":
            return _ok({"uuid": self._id("file")})
        if path == "/instances" and method == "POST":
            request = json.loads(body or b"{}")
            self.requests.append(request)
            allowed = self.permissions["spawn"] or self.permissions["spawn_disposable"]
            if self.enforce_spawn and not allowed:
                detail = "Insufficient permissions: spawn or spawn_disposable"
                if self.echo_key_in_errors:
                    detail += f" (token {self.echo_key_in_errors})"
                return _error(403, detail)
            return self._spawn(request)
        if path.startswith("/operations/"):
            return self._status(path.rsplit("/", 1)[1])
        match = re.fullmatch(r"/inspect/([^/]+)/download", path)
        if match:
            wanted = urllib.parse.parse_qs(parsed.query)["path"][0]
            files = self.images.get(match.group(1), {})
            if wanted not in files:
                return _error(404, "Not Found")
            return HttpReply(200, files[wanted].encode())
        return _error(404, "Not Found")

    # --- behaviour -------------------------------------------------------------------------

    def _import(self, request: dict[str, Any]) -> HttpReply:
        op = self._id("op")
        if self.import_fails:
            self.ops[op] = {"status": "FAILED", "error": "manifest unknown", "polls": 0}
        else:
            image = self._id("img")
            self.images[image] = {}
            self.ops[op] = {"status": "SUCCESS", "result": {"image": image}, "polls": 0}
        self.ops[op]["kind"] = "image_import"
        return _ok({"uuid": op})

    def _spawn(self, request: dict[str, Any]) -> HttpReply:
        command: str = request["command"]
        parent = request["image"]
        fs = dict(self.images.get(parent, {}))
        out: list[str] = []
        exit_code = 0
        for marker in re.findall(r"echo (\S+) > /state/marker", command):
            fs["/state/marker"] = self.marker_override or marker
        if "VERSION python" in command:
            out += ["VERSION python=3.12.3", "VERSION node=v22.12.0"]
            out.append("VERSION chromium=/ms-playwright/chromium-1200")
            out.append("VERSION athena=0.1.0")
        if "VERSION app" in command:
            out.append("VERSION app=ledgerbox")
        for tag in re.findall(r'print\("(\w+) status=%d body', command):
            out.append(f"{tag} status=200 body={{}}" if self.daemon_ok else f"{tag} status=none")
        if "MODELS status" in command:
            env = request.get("env") or {}
            ok = self.network and env.get("NEBIUS_API_KEY")
            out.append("MODELS status=200 count=4" if ok else "MODELS status=none error=URLError")
        if "BRANCH files" in command:
            out.append("BRANCH files=11")
        if not self.daemon_ok and "set -e" in command and "serve" in command:
            exit_code = 1
        op = self._id("op")
        result_image = parent
        changed = fs != self.images.get(parent, {}) or "VERSION python" in command
        if not request.get("disposable") and changed:
            result_image = self._id("img")
            self.images[result_image] = fs
        stdout = base64.b64encode("\n".join(out).encode()).decode()
        self.ops[op] = {
            "status": "SUCCESS",
            "kind": "instance",
            "polls": 0,
            "duration": 1.5,
            "result_image_uuid": None if request.get("disposable") else result_image,
            "metadata": {
                "env": request.get("env"),
                "result": {
                    "state": {"exit_code": exit_code, "timed_out": False},
                    "stdout": {"value": stdout, "encoding": "base64"},
                    "stderr": {"value": "", "encoding": "ascii"},
                },
            },
        }
        return _ok({"uuid": op})

    def _status(self, op_id: str) -> HttpReply:
        op = self.ops.get(op_id)
        if op is None:
            return _error(404, "Not Found")
        if op["polls"] < self.polls_before_done:
            op["polls"] += 1
            return _ok({"uuid": op_id, "status": "EXECUTING"})
        body = {k: v for k, v in op.items() if k != "polls"}
        return _ok({"uuid": op_id, **body})


def _ok(data: Mapping[str, Any]) -> HttpReply:
    return HttpReply(200, json.dumps(data).encode())


def _error(status: int, message: str) -> HttpReply:
    return HttpReply(status, json.dumps({"status": status, "error": message}).encode())
