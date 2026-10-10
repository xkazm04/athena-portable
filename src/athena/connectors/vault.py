"""The vault: the one door a credential is ever behind (README §4; ADR 0021).

**Actions cross the boundary; values never do.** An executor says "call Gmail with this request"
and gets a status and a decoded body back. There is no method here that returns a credential.
:meth:`Vault.request` is the only place plaintext exists: it refuses a host outside the spec's
``api_hosts``, refreshes a grant that is nearly up, attaches the credential, performs the call
with a timeout and a response cap, sanitises the provider's error text through one
:func:`redact`, and returns.

**Admission is a live probe.** :meth:`connect_token` and the OAuth exchange both go through
:meth:`_admit`: the probe first, the seal second. A credential the provider refused leaves
nothing sealed.

**The record is one JSON file, the secrets are sealed beside it.** ``ATHENA_HOME/connectors/
connections.json`` holds what a surface may see — status, identity, the writes switch, the
allow-list, the last probe — and never a value. A brain copied elsewhere carries none of this.

Stdlib only. HTTP is ``urllib`` behind an injectable :class:`Transport`, so the whole lifecycle
runs in a test against a fake provider with no network.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import re
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Protocol

from athena.connectors.oauth import FlowManager, OAuthFlow
from athena.connectors.seal import SealPort, SealUnavailable, select_seal
from athena.connectors.spec import ConnectorSpec, load_builtin
from athena.core.brain.paths import athena_home

__all__ = [
    "HEALTH",
    "MAX_RESPONSE_BYTES",
    "REQUEST_TIMEOUT_S",
    "ConnectionRecord",
    "HostRefused",
    "NeedsReauth",
    "NotConnected",
    "Transport",
    "UrllibTransport",
    "Vault",
    "VaultError",
    "redact",
]

#: A 20 s timeout and a 1 MB response cap, both non-negotiable.
REQUEST_TIMEOUT_S = 20.0
MAX_RESPONSE_BYTES = 1_048_576
#: Refresh ahead when under five minutes of a grant remain.
REFRESH_FLOOR_S = 300.0
#: Health is three-valued, rendered with its age, probed on events and never on render.
HEALTH: tuple[str, ...] = ("healthy", "broken", "unknown")
RECORDS_FILENAME = "connections.json"
UNREADABLE_INFIX = ".unreadable-"

logger = logging.getLogger(__name__)


class VaultError(RuntimeError):
    """Something the vault refuses. Safe to show a model: never a value."""


class HostRefused(VaultError):
    """A URL outside the spec's ``api_hosts``. The broker dials nothing else."""


class NotConnected(VaultError):
    """Not connected, or switched off."""


class NeedsReauth(VaultError):
    """The grant is gone. A caller cannot widen its own grant; the person reconnects."""


class Transport(Protocol):
    def __call__(
        self, method: str, url: str, headers: Mapping[str, str], body: bytes | None, timeout: float
    ) -> tuple[int, bytes]: ...


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(when: datetime | None) -> str:
    return when.isoformat() if when is not None else ""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A 3xx is the answer. The host pin holds for the first URL only, so none is followed."""

    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


class UrllibTransport:
    """The real thing. A non-2xx answer is returned, not raised; the caller reads the status.
    No redirect is followed, so the credential never rides to a host the pin did not name."""

    def __call__(
        self, method: str, url: str, headers: Mapping[str, str], body: bytes | None, timeout: float
    ) -> tuple[int, bytes]:
        request = urllib.request.Request(url, data=body, method=method, headers=dict(headers))
        try:
            with _OPENER.open(request, timeout=timeout) as reply:
                return int(reply.status), reply.read(MAX_RESPONSE_BYTES + 1)
        except urllib.error.HTTPError as exc:
            return int(exc.code), exc.read(MAX_RESPONSE_BYTES + 1)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise VaultError(f"the provider could not be reached: {type(exc).__name__}") from None


@dataclass
class ConnectionRecord:
    """What a surface may see of one connection. No field here is or names a credential."""

    id: str
    status: str = "disconnected"  # disconnected | connected | needs_reauth
    identity: str = ""
    connected_at: str = ""
    enabled: bool = True
    writes_enabled: bool = False
    allowlist: list[str] = field(default_factory=list)
    health: str = "unknown"
    health_at: str = ""
    health_detail: str = ""
    seal: str = ""
    expires_at: str = ""
    last_used_at: str = ""
    #: The identity the writes switch and the allow-list were set under (ADR 0062).
    switches_identity: str = ""

    def view(self) -> dict[str, Any]:
        return asdict(self)


def redact(text: str, secrets: Iterable[str]) -> str:
    """Strip every secret value, and anything that looks like a bearer token, from a sentence."""
    out = text
    for value in secrets:
        if value:
            out = out.replace(value, "[redacted]")
    out = re.sub(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]{8,}", "Bearer [redacted]", out)
    return re.sub(r"\b(ya29|ntn_|sk-|secret_)[A-Za-z0-9._~+/=-]{8,}", "[redacted]", out)


class Vault:
    """One user-level vault: the specs, the records, the seals, and the outbound door."""

    def __init__(
        self,
        root: str | Path | None = None,
        *,
        specs: Mapping[str, ConnectorSpec] | None = None,
        transport: Transport | None = None,
        seal: SealPort | None = None,
        seal_preference: str | None = None,
        open_browser: Callable[[str], object] | None = None,
    ) -> None:
        self.root = Path(root) if root is not None else athena_home() / "connectors"
        self.root.mkdir(parents=True, exist_ok=True)
        self.specs: dict[str, ConnectorSpec] = dict(specs) if specs is not None else load_builtin()
        self.transport: Transport = transport or UrllibTransport()
        try:
            self._seal: SealPort | None = seal or select_seal(
                self.root / "sealed", prefer=seal_preference
            )
        except SealUnavailable:
            self._seal = None
        self._open_browser = open_browser or (lambda url: webbrowser.open(url))
        self._lock = threading.RLock()
        self._records: dict[str, ConnectionRecord] = {}
        #: Plain words when the records file could not be read; empty otherwise.
        self.records_notice = ""
        self.flows = FlowManager()
        self._listeners: list[Callable[[str], None]] = []
        self._load()

    # -- records ----------------------------------------------------------------------------------

    @property
    def _records_path(self) -> Path:
        return self.root / RECORDS_FILENAME

    def _load(self) -> None:
        """Read the records. A file that cannot be read is never taken for "nothing connected":
        its bytes are copied aside and the vault says so (:attr:`records_notice`)."""
        path = self._records_path
        raw: bytes | None = None
        try:
            raw = path.read_bytes()
            data = json.loads(raw.decode("utf-8"))
            if not isinstance(data, dict):
                raise ValueError("the top level is not an object")
        except FileNotFoundError:
            self._note_earlier_copies()
            return
        except (OSError, ValueError) as exc:
            self._set_aside(path, raw, exc)
            return
        names = {f.name for f in ConnectionRecord.__dataclass_fields__.values()}
        for cid, item in data.items():
            if isinstance(item, dict) and cid in self.specs:
                rec = ConnectionRecord(
                    **{k: v for k, v in item.items() if k in names and k != "id"}, id=cid
                )
                if rec.status == "connected" and rec.identity and not rec.switches_identity:
                    # A record from before the identity was kept, live at load: adopt it (ADR 0062).
                    rec.switches_identity = rec.identity
                self._records[cid] = rec
        self._note_earlier_copies()

    def _note_earlier_copies(self) -> None:
        kept = sorted(self.root.glob(f"{RECORDS_FILENAME}{UNREADABLE_INFIX}*"))
        if kept:
            self.records_notice = (
                f"An earlier connections file could not be read; its bytes are kept as "
                f"{kept[-1].name}."
            )

    def _set_aside(self, path: Path, raw: bytes | None, exc: Exception) -> None:
        stamp = _now().strftime("%Y%m%dT%H%M%S%fZ")
        copy = path.with_name(f"{path.name}{UNREADABLE_INFIX}{stamp}")
        try:
            if raw is None:
                raw = path.read_bytes()
            with copy.open("xb") as handle:
                handle.write(raw)
                handle.flush()
                os.fsync(handle.fileno())
            kept = f"Its bytes are kept as {copy.name}."
        except OSError:
            kept = "It could not be copied aside."
        self.records_notice = (
            f"The connections file could not be read ({type(exc).__name__}), so no connection "
            f"is shown. {kept} Connect again to start a fresh file."
        )
        logger.warning("%s", self.records_notice)

    def _save(self) -> None:
        """Written whole into a sibling file, flushed to disk, then swapped in: a crash leaves
        the previous file, never half of the next."""
        with self._lock:
            payload = json.dumps(
                {cid: rec.view() for cid, rec in self._records.items()}, indent=2, sort_keys=True
            )
            fd, name = tempfile.mkstemp(dir=self.root, prefix=RECORDS_FILENAME, suffix=".tmp")
            tmp = Path(name)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as handle:
                    handle.write(payload)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(tmp, self._records_path)
            except OSError as exc:
                with contextlib.suppress(OSError):
                    tmp.unlink()
                raise VaultError(
                    f"the connections could not be saved ({type(exc).__name__})"
                ) from None

    def record(self, connector_id: str) -> ConnectionRecord:
        with self._lock:
            found = self._records.get(connector_id)
            if found is None:
                found = ConnectionRecord(id=connector_id)
                self._records[connector_id] = found
            return found

    def spec(self, connector_id: str) -> ConnectorSpec:
        try:
            return self.specs[connector_id]
        except KeyError:
            raise VaultError(f"no connector {connector_id!r}") from None

    def on_change(self, listener: Callable[[str], None]) -> None:
        """Called with the connector id after a connect, a disconnect or a switch, so the
        catalog can re-merge."""
        self._listeners.append(listener)

    def _changed(self, connector_id: str) -> None:
        self._save()
        for listener in self._listeners:
            listener(connector_id)

    def view(self, connector_id: str) -> dict[str, Any]:
        spec = self.spec(connector_id)
        rec = self.record(connector_id)
        flow = self.flows.for_connector(connector_id)
        return {
            **spec.view(),
            "connection": rec.view(),
            "live": self.is_live(connector_id),
            "seal_available": self._seal is not None,
            "flow": flow.view() if flow is not None else None,
            "records_notice": self.records_notice,
        }

    def views(self) -> list[dict[str, Any]]:
        return [self.view(cid) for cid in sorted(self.specs)]

    # -- liveness (the policy port) ---------------------------------------------------------------

    def is_live(self, connector_id: str) -> bool:
        with self._lock:
            rec = self._records.get(connector_id)
            return rec is not None and rec.status == "connected" and rec.enabled

    # -- seals ------------------------------------------------------------------------------------

    def _seal_or_refuse(self) -> SealPort:
        if self._seal is None:
            raise VaultError("no seal is available on this machine; nothing will be stored")
        return self._seal

    def _put(self, connector_id: str, kind: str, value: str) -> None:
        self._seal_or_refuse().seal(f"{connector_id}.{kind}", value)

    def _get(self, connector_id: str, kind: str) -> str | None:
        return None if self._seal is None else self._seal.unseal(f"{connector_id}.{kind}")

    def _drop(self, connector_id: str) -> None:
        if self._seal is None:
            return
        for kind in ("token", "refresh", "client_id", "client_secret"):
            self._seal.destroy(f"{connector_id}.{kind}")

    # -- the outbound door ------------------------------------------------------------------------

    def _check_host(self, spec: ConnectorSpec, url: str) -> None:
        host = urllib.parse.urlsplit(url).hostname or ""
        if urllib.parse.urlsplit(url).scheme != "https" or host not in spec.api_hosts:
            raise HostRefused(f"{spec.label} may only be reached at {', '.join(spec.api_hosts)}")

    def _raw(
        self,
        spec: ConnectorSpec,
        method: str,
        url: str,
        headers: Mapping[str, str],
        body: bytes | None,
    ) -> tuple[int, bytes]:
        self._check_host(spec, url)
        status, raw = self.transport(method, url, headers, body, REQUEST_TIMEOUT_S)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise VaultError(f"{spec.label} answered more than {MAX_RESPONSE_BYTES} bytes")
        return status, raw

    def request(
        self, connector_id: str, method: str, url: str, json_body: Any = None
    ) -> tuple[int, Any]:
        """One brokered call. The credential is attached here and nowhere else."""
        spec = self.spec(connector_id)
        with self._lock:
            if not self.is_live(connector_id):
                rec = self.record(connector_id)
                if rec.status == "needs_reauth":
                    raise NeedsReauth(f"{spec.label} needs to be reconnected in Connectors")
                raise NotConnected(f"{spec.label} is not connected, or is switched off")
            token = self._fresh_token(spec)
        headers: dict[str, str] = {"Accept": "application/json", **spec.auth.extra_headers}
        name, value = spec.auth.credential_header(token)
        headers[name] = value
        body: bytes | None = None
        if json_body is not None:
            body = json.dumps(json_body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        status, raw = self._raw(spec, method, url, headers, body)
        with self._lock:
            rec = self.record(connector_id)
            rec.last_used_at = _iso(_now())
            if status in (401, 403) and spec.auth.type == "oauth":
                rec.status = "needs_reauth"
                self._changed(connector_id)
                raise NeedsReauth(f"{spec.label} needs to be reconnected in Connectors")
        return status, self._decode(raw, token)

    def _decode(self, raw: bytes, token: str) -> Any:
        text = raw.decode("utf-8", "replace")
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return redact(text, [token])

    def _fresh_token(self, spec: ConnectorSpec) -> str:
        token = self._get(spec.id, "token")
        if token is None:
            raise NotConnected(f"{spec.label} has no sealed credential; reconnect it")
        rec = self.record(spec.id)
        if spec.auth.type == "oauth" and rec.expires_at:
            expires = datetime.fromisoformat(rec.expires_at)
            if (expires - _now()).total_seconds() < REFRESH_FLOOR_S:
                token = self._refresh(spec, rec)
        return token

    def _refresh(self, spec: ConnectorSpec, rec: ConnectionRecord) -> str:
        refresh = self._get(spec.id, "refresh")
        client_id = self._get(spec.id, "client_id") or ""
        client_secret = self._get(spec.id, "client_secret") or ""
        if not refresh:
            rec.status = "needs_reauth"
            self._changed(spec.id)
            raise NeedsReauth(f"{spec.label} needs to be reconnected in Connectors")
        form = {
            "grant_type": "refresh_token",
            "refresh_token": refresh,
            "client_id": client_id,
            "client_secret": client_secret,
        }
        status, raw = self._raw(
            spec,
            "POST",
            spec.auth.token_url,
            {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
            urllib.parse.urlencode(form).encode("ascii"),
        )
        grant = self._decode(raw, refresh)
        if status >= 300 or not isinstance(grant, Mapping) or not grant.get("access_token"):
            rec.status = "needs_reauth"
            self._changed(spec.id)
            raise NeedsReauth(f"{spec.label} needs to be reconnected in Connectors")
        token = str(grant["access_token"])
        self._put(spec.id, "token", token)
        rec.expires_at = _iso(_now() + timedelta(seconds=int(grant.get("expires_in", 3600))))
        self._save()
        return token

    # -- admission --------------------------------------------------------------------------------

    def _probe_with(self, spec: ConnectorSpec, token: str) -> str:
        """Ask the provider whether it accepts ``token``. Returns the identity; raises otherwise."""
        headers: dict[str, str] = {"Accept": "application/json", **spec.auth.extra_headers}
        name, value = spec.auth.credential_header(token)
        headers[name] = value
        status, raw = self._raw(spec, spec.probe.method, spec.probe.url, headers, None)
        body = self._decode(raw, token)
        if status >= 300:
            raise VaultError(f"{spec.label} refused the credential with {status}")
        identity = body.get(spec.probe.identity_field) if isinstance(body, Mapping) else None
        return str(identity) if identity else ""

    def _admit(
        self, spec: ConnectorSpec, token: str, *, refresh: str = "", expires_in: int | None = None
    ) -> str:
        identity = self._probe_with(spec, token)
        self._seal_or_refuse()
        with self._lock:
            self._put(spec.id, "token", token)
            if refresh:
                self._put(spec.id, "refresh", refresh)
            rec = self.record(spec.id)
            reset = self._reset_foreign_switches(rec, identity)
            rec.status = "connected"
            rec.identity = identity
            rec.connected_at = _iso(_now())
            rec.health, rec.health_at, rec.health_detail = "healthy", rec.connected_at, reset
            rec.seal = self._seal.kind if self._seal is not None else ""
            rec.expires_at = _iso(_now() + timedelta(seconds=expires_in)) if expires_in else ""
            self._changed(spec.id)
        return identity

    @staticmethod
    def _reset_foreign_switches(rec: ConnectionRecord, identity: str) -> str:
        """The switches belong to the account they were set under (ADR 0062). Turn writes off and
        empty the allow-list unless this connect is that very account; say so in plain words."""
        if not (rec.writes_enabled or rec.allowlist):
            return ""
        before = rec.switches_identity
        if identity and before == identity:
            return ""
        rec.writes_enabled = False
        rec.allowlist = []
        rec.switches_identity = identity
        who = identity or "an account the provider did not name"
        why = f"were set under {before}" if before else "were set without a known account"
        return (
            f"Connected as {who}. The writes switch and the recipient list {why}, "
            "so writes are off and the list was emptied."
        )

    def connect_token(self, connector_id: str, token: str) -> ConnectionRecord:
        spec = self.spec(connector_id)
        if spec.auth.type != "token":
            raise VaultError(f"{spec.label} connects with OAuth, not a pasted token")
        if not token.strip():
            raise VaultError("a token is required")
        self._admit(spec, token.strip())
        return self.record(connector_id)

    def connect_oauth(
        self, connector_id: str, *, client_id: str, client_secret: str, open_browser: bool = True
    ) -> OAuthFlow:
        """Start the consent flow. The flow's ``authorize_url`` is what the browser opens."""
        spec = self.spec(connector_id)
        if spec.auth.type != "oauth":
            raise VaultError(f"{spec.label} connects with a pasted token, not OAuth")
        if not client_id.strip():
            raise VaultError("a client id is required")
        self._seal_or_refuse()
        self._put(connector_id, "client_id", client_id.strip())
        self._put(connector_id, "client_secret", client_secret.strip())

        def on_code(flow: OAuthFlow, code: str) -> str:
            return self._exchange(spec, flow, code)

        flow = self.flows.add(
            OAuthFlow(connector_id, spec.auth, client_id=client_id.strip(), on_code=on_code)
        )
        if open_browser:
            self._open_browser(flow.authorize_url)
        return flow

    def _exchange(self, spec: ConnectorSpec, flow: OAuthFlow, code: str) -> str:
        form = {
            "grant_type": "authorization_code",
            "code": code,
            "client_id": flow.client_id,
            "client_secret": self._get(spec.id, "client_secret") or "",
            "redirect_uri": flow.redirect_uri,
        }
        if flow.verifier:
            form["code_verifier"] = flow.verifier
        status, raw = self._raw(
            spec,
            "POST",
            spec.auth.token_url,
            {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
            urllib.parse.urlencode(form).encode("ascii"),
        )
        grant = self._decode(raw, code)
        if status >= 300 or not isinstance(grant, Mapping) or not grant.get("access_token"):
            raise VaultError(f"{spec.label} refused the code with {status}")
        return self._admit(
            spec,
            str(grant["access_token"]),
            refresh=str(grant.get("refresh_token", "") or ""),
            expires_in=int(grant.get("expires_in", 3600) or 3600),
        )

    def probe(self, connector_id: str) -> ConnectionRecord:
        """Re-check a connected credential and record the answer with its time."""
        spec = self.spec(connector_id)
        rec = self.record(connector_id)
        token = self._get(connector_id, "token")
        if rec.status == "disconnected" or token is None:
            rec.health, rec.health_at, rec.health_detail = "unknown", _iso(_now()), "not connected"
            self._save()
            return rec
        try:
            identity = self._probe_with(spec, token)
            with self._lock:
                rec.health, rec.health_detail = "healthy", ""
                if identity:
                    rec.identity = identity
                if rec.status == "needs_reauth":
                    rec.status = "connected"
        except VaultError as exc:
            with self._lock:
                rec.health, rec.health_detail = "broken", redact(str(exc), [token])
        rec.health_at = _iso(_now())
        self._changed(connector_id)
        return rec

    def disconnect(self, connector_id: str) -> ConnectionRecord:
        """Revoke upstream when the spec knows how; destroy every sealed value; keep the
        switches, which are the person's and not the credential's."""
        spec = self.spec(connector_id)
        token = self._get(connector_id, "token")
        if token and spec.auth.revoke_url:
            # The sealed value is destroyed either way; an unreachable revoke endpoint is not a
            # reason to keep a credential the person asked to be rid of.
            with contextlib.suppress(VaultError):
                self._raw(
                    spec,
                    "POST",
                    spec.auth.revoke_url,
                    {"Content-Type": "application/x-www-form-urlencoded"},
                    urllib.parse.urlencode({"token": token}).encode("ascii"),
                )
        with self._lock:
            self._drop(connector_id)
            rec = self.record(connector_id)
            rec.status = "disconnected"
            rec.identity = ""
            rec.connected_at = ""
            rec.expires_at = ""
            rec.health, rec.health_at, rec.health_detail = "unknown", _iso(_now()), "disconnected"
            self._changed(connector_id)
        return rec

    # -- the switches -----------------------------------------------------------------------------

    def set_enabled(self, connector_id: str, enabled: bool) -> ConnectionRecord:
        self.spec(connector_id)
        with self._lock:
            rec = self.record(connector_id)
            rec.enabled = enabled
            self._changed(connector_id)
        return rec

    @staticmethod
    def _remember_identity(rec: ConnectionRecord) -> None:
        """A switch set while a grant exists is set under that grant's identity. One set with no
        connection leaves the stored identity as it was, so the next connect compares against it."""
        if rec.status in ("connected", "needs_reauth"):
            rec.switches_identity = rec.identity

    def set_writes(self, connector_id: str, enabled: bool) -> ConnectionRecord:
        spec = self.spec(connector_id)
        if spec.egress == "none":
            raise VaultError(f"{spec.label} has no write tools")
        with self._lock:
            rec = self.record(connector_id)
            rec.writes_enabled = enabled
            self._remember_identity(rec)
            self._changed(connector_id)
        return rec

    def set_allowlist(self, connector_id: str, values: Sequence[str]) -> ConnectionRecord:
        spec = self.spec(connector_id)
        if spec.egress == "none":
            raise VaultError(f"{spec.label} has no write tools")
        cleaned = sorted({v.strip().lower() for v in values if v and v.strip()})
        with self._lock:
            rec = self.record(connector_id)
            rec.allowlist = cleaned
            self._remember_identity(rec)
            self._changed(connector_id)
        return rec

    def close(self) -> None:
        self.flows.cancel_all()
