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

**A refresh is classified, never assumed.** Only a terminal answer from the token endpoint — a
4xx naming ``invalid_grant``, ``invalid_client`` or ``unauthorized_client``, or a 400 or 401 with
no readable error — marks a grant ``needs_reauth``. A 429, a 5xx, a 3xx, a timeout or a 2xx
without a token is transient: the grant stays connected and the caller gets
:class:`RefreshFailed` or :class:`RateLimited` with the status in its sentence. The token POST
runs with the vault's lock released, behind one guard per connector, and commits only if the
connection is still the one it started from.

**The record is one JSON file, the secrets are sealed beside it.** ``ATHENA_HOME/connectors/
connections.json`` holds what a surface may see — status, identity, the writes switch, the
allow-list, the last probe — and never a value. A brain copied elsewhere carries none of this.

Stdlib only. HTTP is ``urllib`` behind an injectable :class:`Transport`, so the whole lifecycle
runs in a test against a fake provider with no network.
"""

from __future__ import annotations

import contextlib
import http.client
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
from typing import Any, ClassVar, Protocol

from athena.connectors import health
from athena.connectors.health import is_quota_refusal, refresh_is_terminal
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
    "NoAnswer",
    "NotConnected",
    "RateLimited",
    "RefreshFailed",
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
#: Health is three-valued, rendered with its age, probed on events and never on render. A check
#: that reached no verdict is an attempt beside it, never a fourth value (connectors/health.py).
HEALTH: tuple[str, ...] = ("healthy", "broken", "unknown")
#: A ``Retry-After`` the model is told is an integer of seconds, at most a day.
RETRY_AFTER_CAP_S = 86_400
RECORDS_FILENAME = "connections.json"
UNREADABLE_INFIX = ".unreadable-"

logger = logging.getLogger(__name__)


class VaultError(RuntimeError):
    """Something the vault refuses. Safe to show a model: never a value.

    ``verdict`` and ``worded`` are read by :func:`athena.connectors.health.classify`: whether
    meeting this error is the provider's word on the credential, and whether its sentence already
    names the obstacle (otherwise the provider is taken as not reached)."""

    verdict: ClassVar[bool] = False
    worded: ClassVar[bool] = False


class HostRefused(VaultError):
    """A URL outside the spec's ``api_hosts``. The broker dials nothing else."""


class NotConnected(VaultError):
    """Not connected, or switched off."""


class NoAnswer(VaultError):
    """The request may have reached the provider and no answer came back: it timed out, or the
    connection dropped after it was sent. A write that meets this may have run (ADR 0101)."""


class NeedsReauth(VaultError):
    """The grant is gone. A caller cannot widen its own grant; the person reconnects."""

    verdict = True


class RefreshFailed(VaultError):
    """The grant could not be refreshed this time; it stays connected. The sentence names why."""

    worded = True


class RateLimited(VaultError):
    """The provider is rate limiting the calls. The grant stays connected and nothing retries."""

    worded = True

    def __init__(self, message: str, *, status: int, retry_after: int | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after


class Transport(Protocol):
    """``(status, body)``, or ``(status, body, headers)`` when the transport has the headers."""

    def __call__(
        self, method: str, url: str, headers: Mapping[str, str], body: bytes | None, timeout: float
    ) -> tuple[int, bytes] | tuple[int, bytes, Mapping[str, str]]: ...


def retry_after_of(headers: Mapping[str, str]) -> int | None:
    """A ``Retry-After`` of whole seconds, capped; ``None`` when absent or given as a date."""
    value = headers.get("retry-after", "").strip()
    if not value.isascii() or not value.isdigit():
        return None
    return min(int(value), RETRY_AFTER_CAP_S)


def _expires_in(grant: Mapping[str, Any], label: str, error: type[VaultError]) -> int:
    raw = grant.get("expires_in")
    if raw is None or raw == "" or raw == 0:
        return 3600
    if isinstance(raw, bool):
        raise error(f"{label} answered an expiry that is not a number of seconds")
    try:
        return max(0, int(raw))
    except (TypeError, ValueError, OverflowError):
        raise error(f"{label} answered an expiry that is not a number of seconds") from None


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
    ) -> tuple[int, bytes, Mapping[str, str]]:
        request = urllib.request.Request(url, data=body, method=method, headers=dict(headers))
        try:
            with _OPENER.open(request, timeout=timeout) as reply:
                answer = reply.read(MAX_RESPONSE_BYTES + 1)
                return int(reply.status), answer, dict(reply.headers.items())
        except urllib.error.HTTPError as exc:
            answer = exc.read(MAX_RESPONSE_BYTES + 1)
            return int(exc.code), answer, dict(exc.headers.items()) if exc.headers else {}
        except urllib.error.URLError as exc:
            if isinstance(exc.reason, TimeoutError):
                why = type(exc.reason).__name__
                raise NoAnswer(f"the provider did not answer: {why}") from None
            raise VaultError(f"the provider could not be reached: {type(exc).__name__}") from None
        except (
            TimeoutError,
            ConnectionResetError,
            ConnectionAbortedError,
            http.client.HTTPException,
        ) as exc:
            # After the request went out (a garbled or cut-short answer included): whatever it
            # asked for may have been done. ``http.client``'s own errors are not ``OSError``s, and
            # one that escaped here would end the turn instead of failing the call.
            raise NoAnswer(f"the provider did not answer: {type(exc).__name__}") from None
        except OSError as exc:
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
    #: The provider's stable account key (a Notion bot's user id; for Gmail, the address itself),
    #: and the key the switches were set under. The key decides; the identity is for display.
    account: str = ""
    switches_account: str = ""
    #: The last check that reached no verdict, and its obstacle; cleared by the next verdict, and
    #: never written over ``health`` (connectors/health.py).
    attempt_at: str = ""
    attempt_detail: str = ""
    #: The vault's word at the last connect (that the switches were reset, ADR 0062). A probe
    #: never touches it; the next connect or a disconnect replaces it.
    notice: str = ""

    def view(self) -> dict[str, Any]:
        return asdict(self)


class _KeptClientFlow(OAuthFlow):
    """A consent flow started with the vault's own sealed client (ADR 0117). Its authorize URL
    names the client id, so its view leaves the URL out: the daemon opened the browser, and the
    route and the surface learn the phase, never the client."""

    def view(self) -> dict[str, Any]:
        return {**super().view(), "authorize_url": ""}


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
        #: One refresh at a time per connector; a caller with a stale token waits for it.
        self._refresh_guards: dict[str, threading.Lock] = {}
        #: Bumped by every connect and disconnect, so a refresh or a call that began under one
        #: grant never commits onto the next.
        self._generations: dict[str, int] = {}
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
                if rec.status == "connected" and rec.account and not rec.switches_account:
                    rec.switches_account = rec.account
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
            "client_kept": self.client_kept(connector_id),
            "flow": flow.view() if flow is not None else None,
            "records_notice": self.records_notice,
        }

    def views(self) -> list[dict[str, Any]]:
        return [self.view(cid) for cid in sorted(self.specs)]

    def client_kept(self, connector_id: str) -> bool:
        """Whether an OAuth client pair is sealed for this connector, so a reconnect can reuse it
        (ADR 0117). The answer is a yes or a no; the value never leaves the seal by this door."""
        if self.spec(connector_id).auth.type != "oauth":
            return False
        try:
            return bool(self._get(connector_id, "client_id"))
        except VaultError:
            return False

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
        try:
            self._seal_or_refuse().seal(f"{connector_id}.{kind}", value)
        except SealUnavailable as exc:
            raise VaultError(f"the credential could not be stored: {exc}") from None

    def _get(self, connector_id: str, kind: str) -> str | None:
        if self._seal is None:
            return None
        try:
            return self._seal.unseal(f"{connector_id}.{kind}")
        except SealUnavailable as exc:
            raise VaultError(f"the credential could not be read: {exc}") from None

    def _drop(self, connector_id: str) -> None:
        if self._seal is None:
            return
        for kind in ("token", "refresh", "client_id", "client_secret"):
            self._seal.destroy(f"{connector_id}.{kind}")

    def _generation(self, connector_id: str) -> int:
        with self._lock:
            return self._generations.get(connector_id, 0)

    def _next_generation(self, connector_id: str) -> None:
        with self._lock:
            self._generations[connector_id] = self._generations.get(connector_id, 0) + 1

    def _refresh_guard(self, connector_id: str) -> threading.Lock:
        with self._lock:
            return self._refresh_guards.setdefault(connector_id, threading.Lock())

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
    ) -> tuple[int, bytes, dict[str, str]]:
        """One call on the wire: status, body, and the reply's headers with lower-cased names."""
        self._check_host(spec, url)
        status, raw, *rest = self.transport(method, url, headers, body, REQUEST_TIMEOUT_S)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise VaultError(f"{spec.label} answered more than {MAX_RESPONSE_BYTES} bytes")
        replied = {str(k).lower(): str(v) for k, v in rest[0].items()} if rest else {}
        return status, raw, replied

    @staticmethod
    def _rate_limited(spec: ConnectorSpec, status: int, headers: Mapping[str, str]) -> RateLimited:
        wait = retry_after_of(headers)
        when = f"it asked for {wait} s before the next try" if wait is not None else "try later"
        return RateLimited(
            f"{spec.label} rate limited the request (it answered {status}); the connection is "
            f"kept and nothing was retried, {when}",
            status=status,
            retry_after=wait,
        )

    def request(
        self, connector_id: str, method: str, url: str, json_body: Any = None
    ) -> tuple[int, Any]:
        """One brokered call. The credential is attached here and nowhere else.

        A 429 — or, on OAuth, a 403 whose body names a rate or quota reason — is
        :class:`RateLimited` and the grant stays connected. A 401, or any other 403, on an OAuth
        call marks the grant ``needs_reauth``: a refusal it cannot place fails closed. A 401 on a
        pasted token is returned as it came and recorded as a broken verdict."""
        spec = self.spec(connector_id)
        token, generation = self._fresh_token(spec)
        headers: dict[str, str] = {"Accept": "application/json", **spec.auth.extra_headers}
        name, value = spec.auth.credential_header(token)
        headers[name] = value
        body: bytes | None = None
        if json_body is not None:
            body = json.dumps(json_body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        status, raw, replied = self._raw(spec, method, url, headers, body)
        decoded = self._decode(raw, token)
        oauth = spec.auth.type == "oauth"
        with self._lock:
            rec = self.record(connector_id)
            rec.last_used_at = _iso(_now())
            if status == 429 or (oauth and status == 403 and is_quota_refusal(decoded)):
                raise self._rate_limited(spec, status, replied)
            if oauth and status in (401, 403):
                if self._generation(connector_id) != generation:
                    raise NotConnected(
                        f"{spec.label} was disconnected or reconnected while the call was out; "
                        "nothing was marked"
                    )
                lost = NeedsReauth(
                    f"{spec.label} needs to be reconnected in Connectors (it answered {status})"
                )
                self._mark_reauth(spec, generation, lost)
                raise lost
            if not oauth and status == 401 and self._generation(connector_id) == generation:
                # A pasted token's 401 is the provider's word on the credential, as the probe
                # reads it: a broken verdict with its time. The record stays connected (a person
                # pastes a new token; nothing here can be refreshed), and the caller still gets
                # the answer. A 403 is about the resource, not the token, and is not a verdict.
                health.record(rec, health.classify(status, decoded, label=spec.label), _now())
                self._save()
        return status, decoded

    def _decode(self, raw: bytes, token: str) -> Any:
        text = raw.decode("utf-8", "replace")
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return redact(text, [token])

    def _live_token(self, spec: ConnectorSpec) -> tuple[str, int, bool]:
        """Under the lock: the sealed token, the grant's generation, and whether it is stale."""
        with self._lock:
            if not self.is_live(spec.id):
                if self.record(spec.id).status == "needs_reauth":
                    raise NeedsReauth(f"{spec.label} needs to be reconnected in Connectors")
                raise NotConnected(f"{spec.label} is not connected, or is switched off")
            token = self._get(spec.id, "token")
            if token is None:
                raise NotConnected(f"{spec.label} has no sealed credential; reconnect it")
            return token, self._generation(spec.id), self._stale(spec, self.record(spec.id))

    @staticmethod
    def _stale(spec: ConnectorSpec, rec: ConnectionRecord) -> bool:
        """Whether an OAuth grant has less than :data:`REFRESH_FLOOR_S` left."""
        if spec.auth.type != "oauth" or not rec.expires_at:
            return False
        expires = datetime.fromisoformat(rec.expires_at)
        return (expires - _now()).total_seconds() < REFRESH_FLOOR_S

    def _fresh_token(self, spec: ConnectorSpec) -> tuple[str, int]:
        """A token good for the next call, and the generation of the grant it belongs to. A stale
        grant is refreshed by one caller; the others wait on the connector's guard and re-read."""
        token, generation, stale = self._live_token(spec)
        if not stale:
            return token, generation
        with self._refresh_guard(spec.id):
            token, generation, stale = self._live_token(spec)
            if not stale:
                return token, generation  # another caller refreshed it while this one waited
            return self._refresh(spec, generation), generation

    def _refresh(self, spec: ConnectorSpec, generation: int, *, live_only: bool = True) -> str:
        """Called holding the connector's refresh guard, not the vault's lock. Reads under the
        lock, posts with it released, and commits under it only onto the same ``generation``.

        Every outcome is written as health (connectors/health.py): a token the endpoint gave is a
        healthy verdict, a terminal answer a broken one with ``needs_reauth``, and a refresh that
        failed this time an attempt that leaves the verdict as it was. ``live_only=False`` (the
        probe) also commits onto a grant that is switched off or needs reconnecting."""
        try:
            return self._refresh_once(spec, generation, live_only)
        except (RefreshFailed, RateLimited) as exc:
            self._note_attempt(spec, generation, exc)
            raise

    def _refresh_once(self, spec: ConnectorSpec, generation: int, live_only: bool) -> str:
        with self._lock:
            refresh = self._get(spec.id, "refresh")
            client_id = self._get(spec.id, "client_id") or ""
            client_secret = self._get(spec.id, "client_secret") or ""
            if not refresh:
                lost = NeedsReauth(
                    f"{spec.label} needs to be reconnected in Connectors (no refresh token is kept)"
                )
                self._mark_reauth(spec, generation, lost)
                raise lost
        form = {
            "grant_type": "refresh_token",
            "refresh_token": refresh,
            "client_id": client_id,
            "client_secret": client_secret,
        }
        try:
            status, raw, replied = self._raw(
                spec,
                "POST",
                spec.auth.token_url,
                {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
                urllib.parse.urlencode(form).encode("ascii"),
            )
        except HostRefused:
            raise
        except VaultError as exc:
            raise RefreshFailed(
                f"{spec.label} could not refresh its grant ({exc}); the connection is kept"
            ) from None
        grant = self._decode(raw, refresh)
        if refresh_is_terminal(status, grant):
            error = grant.get("error") if isinstance(grant, Mapping) else None
            named = f" {error.strip()}" if isinstance(error, str) and error.strip() else ""
            lost = NeedsReauth(
                f"{spec.label} needs to be reconnected in Connectors (the token endpoint "
                f"answered {status}{named})"
            )
            with self._lock:
                self._still(spec, generation, live_only)
                self._mark_reauth(spec, generation, lost)
            raise lost
        if status == 429:
            raise self._rate_limited(spec, status, replied)
        if not 200 <= status < 300 or not isinstance(grant, Mapping):
            raise RefreshFailed(
                f"{spec.label} could not refresh its grant (the token endpoint answered "
                f"{status}); the connection is kept"
            )
        if not grant.get("access_token"):
            raise RefreshFailed(
                f"{spec.label} could not refresh its grant (the token endpoint answered "
                f"{status} without an access token); the connection is kept"
            )
        seconds = _expires_in(grant, spec.label, RefreshFailed)
        token = str(grant["access_token"])
        rotated = grant.get("refresh_token")
        with self._lock:
            self._still(spec, generation, live_only)
            self._put(spec.id, "token", token)
            if isinstance(rotated, str) and rotated.strip():
                self._put(spec.id, "refresh", rotated.strip())
            rec = self.record(spec.id)
            rec.expires_at = _iso(_now() + timedelta(seconds=seconds))
            health.record(rec, health.classify(status, grant, label=spec.label), _now())
            self._save()
        return token

    def _still(self, spec: ConnectorSpec, generation: int, live_only: bool = True) -> None:
        """Refuse to commit a refresh onto a grant that is no longer the one it began under (or,
        with ``live_only``, onto one that is no longer live)."""
        kept = (
            self.is_live(spec.id)
            if live_only
            else self.record(spec.id).status in ("connected", "needs_reauth")
        )
        if self._generation(spec.id) != generation or not kept:
            raise NotConnected(
                f"{spec.label} was disconnected or reconnected while its grant was refreshed; "
                "nothing from the refresh was kept"
            )

    def _mark_reauth(self, spec: ConnectorSpec, generation: int, lost: NeedsReauth) -> None:
        """The grant is gone: ``needs_reauth``, and a broken verdict with its time."""
        with self._lock:
            if self._generation(spec.id) == generation:
                rec = self.record(spec.id)
                rec.status = "needs_reauth"
                health.record(rec, health.classify(exc=lost, label=spec.label), _now())
                self._changed(spec.id)

    def _note_attempt(self, spec: ConnectorSpec, generation: int, exc: VaultError) -> None:
        """A check that reached no verdict, onto the same grant only; the verdict is left."""
        with self._lock:
            rec = self.record(spec.id)
            if self._generation(spec.id) == generation and rec.status != "disconnected":
                health.record(rec, health.classify(exc=exc, label=spec.label), _now())
                self._save()

    # -- admission --------------------------------------------------------------------------------

    def _ask(self, spec: ConnectorSpec, token: str) -> tuple[int, Any]:
        """The probe on the wire with ``token``: the provider's status and decoded body."""
        headers: dict[str, str] = {"Accept": "application/json", **spec.auth.extra_headers}
        name, value = spec.auth.credential_header(token)
        headers[name] = value
        status, raw, _ = self._raw(spec, spec.probe.method, spec.probe.url, headers, None)
        return status, self._decode(raw, token)

    def _probe_with(self, spec: ConnectorSpec, token: str) -> tuple[str, str]:
        """Ask the provider whether it accepts ``token``. Returns the identity to show and the
        account key to compare (empty when the provider named none); raises otherwise."""
        status, body = self._ask(spec, token)
        if status >= 300:
            raise VaultError(f"{spec.label} refused the credential with {status}")
        return self._identity_of(spec, body)

    @staticmethod
    def _identity_of(spec: ConnectorSpec, body: Any) -> tuple[str, str]:
        """The identity to show and the account key to compare, from an accepted probe's body."""
        if not isinstance(body, Mapping):
            return "", ""
        named = body.get(spec.probe.identity_field)
        identity = str(named) if named else ""
        if not spec.probe.key_field:
            return identity, identity
        key = body.get(spec.probe.key_field)
        account = key.strip() if isinstance(key, str) else ""
        bot = body.get("bot")
        workspace = bot.get("workspace_name") if isinstance(bot, Mapping) else None
        if identity and isinstance(workspace, str) and workspace.strip():
            identity = f"{identity} ({workspace.strip()})"
        return identity, account

    def _admit(
        self,
        spec: ConnectorSpec,
        token: str,
        *,
        refresh: str = "",
        expires_in: int | None = None,
        client: tuple[str, str] | None = None,
        admit_if: Callable[[], bool] | None = None,
    ) -> str:
        """Probe, then seal: the token, the refresh token and the OAuth client pair are all put
        together, after the provider accepted the grant, so a refused one leaves the last intact.

        ``admit_if`` is asked under the lock, last, before anything is sealed (a consent flow's
        :meth:`~athena.connectors.oauth.OAuthFlow.claim`): a flow cancelled meanwhile keeps
        nothing."""
        identity, account = self._probe_with(spec, token)
        self._seal_or_refuse()
        with self._lock:
            if admit_if is not None and not admit_if():
                raise VaultError(
                    f"the {spec.label} consent was cancelled before it was admitted; "
                    "nothing was kept"
                )
            self._next_generation(spec.id)
            self._put(spec.id, "token", token)
            if refresh:
                self._put(spec.id, "refresh", refresh)
            if client is not None:
                self._put(spec.id, "client_id", client[0])
                self._put(spec.id, "client_secret", client[1])
            rec = self.record(spec.id)
            reset = self._reset_foreign_switches(spec, rec, identity, account)
            rec.status = "connected"
            rec.identity = identity
            rec.account = account
            rec.connected_at = _iso(_now())
            rec.health, rec.health_at, rec.health_detail = "healthy", rec.connected_at, ""
            rec.attempt_at, rec.attempt_detail, rec.notice = "", "", reset
            rec.seal = self._seal.kind if self._seal is not None else ""
            rec.expires_at = _iso(_now() + timedelta(seconds=expires_in)) if expires_in else ""
            self._changed(spec.id)
        return identity

    @staticmethod
    def _reset_foreign_switches(
        spec: ConnectorSpec, rec: ConnectionRecord, identity: str, account: str
    ) -> str:
        """The switches belong to the account they were set under (ADR 0062). Turn writes off and
        empty the allow-list unless this connect is that very account; say so in plain words.

        The account is compared by its key, the display identity never. A connector that names a
        key field (Notion's bot user id) is compared on it; a record that holds only a display
        name for it resets once, on this connect."""
        keyed = bool(spec.probe.key_field)
        was = rec.switches_identity
        before = rec.switches_account or ("" if keyed else was)
        if not (rec.writes_enabled or rec.allowlist):
            return ""
        if account and before == account:
            rec.switches_identity, rec.switches_account = identity, account
            return ""
        rec.writes_enabled = False
        rec.allowlist = []
        rec.switches_identity, rec.switches_account = identity, account
        who = identity or "an account the provider did not name"
        if not account:
            why = (
                f"were set under {was or 'no known account'}, and the provider named no account "
                "id this time, so the account could not be confirmed"
            )
        elif keyed and was and not before:
            why = (
                f"were set under {was}, an account known only by its name, which cannot tell two "
                "workspaces apart; they are reset once and kept by account id from now on"
            )
        else:
            why = f"were set under {was}" if was else "were set without a known account"
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
        self,
        connector_id: str,
        *,
        client_id: str = "",
        client_secret: str = "",
        open_browser: bool = True,
        reuse_client: bool = False,
        guard: Callable[[], contextlib.AbstractContextManager[object]] | None = None,
    ) -> OAuthFlow:
        """Start the consent flow. The flow's ``authorize_url`` is what the browser opens.

        The client pair rides on the flow and is sealed only once the exchange has been admitted:
        a flow that fails, is cancelled or runs out leaves the sealed pair and a live grant as
        they were.

        ``reuse_client`` with no pasted pair starts the flow with the pair this vault sealed at the
        last admission (ADR 0117): the caller names the act and never the value, and the flow's
        view withholds its authorize URL, which carries the client id. A pasted pair always wins.

        ``guard`` is what every other connector act runs inside (the daemon's writer lock): the
        flow thread takes it around the admission — after the code is exchanged, so a long turn
        cannot let the code expire — and the catalog's re-merge happens under it, never beside a
        running turn."""
        spec = self.spec(connector_id)
        if spec.auth.type != "oauth":
            raise VaultError(f"{spec.label} connects with a pasted token, not OAuth")
        pasted = client_id.strip()
        if pasted:
            pair, kept = (pasted, client_secret.strip()), False
        elif reuse_client:
            pair, kept = self._kept_client(spec), True
        else:
            raise VaultError("a client id is required")
        self._seal_or_refuse()

        def on_code(flow: OAuthFlow, code: str) -> str:
            return self._exchange(spec, flow, code, guard)

        made = _KeptClientFlow if kept else OAuthFlow
        flow = self.flows.add(
            made(
                connector_id,
                spec.auth,
                client_id=pair[0],
                client_secret=pair[1],
                on_code=on_code,
            )
        )
        if open_browser:
            self._open_browser(flow.authorize_url)
        return flow

    def _kept_client(self, spec: ConnectorSpec) -> tuple[str, str]:
        """The client pair sealed at the last admission, or a refusal that asks for one."""
        with self._lock:
            kept_id = self._get(spec.id, "client_id") or ""
            kept_secret = self._get(spec.id, "client_secret") or ""
        if not kept_id:
            raise VaultError(
                f"no client is kept for {spec.label}; a client id is required to connect"
            )
        return kept_id, kept_secret

    def _exchange(
        self,
        spec: ConnectorSpec,
        flow: OAuthFlow,
        code: str,
        guard: Callable[[], contextlib.AbstractContextManager[object]] | None = None,
    ) -> str:
        form = {
            "grant_type": "authorization_code",
            "code": code,
            "client_id": flow.client_id,
            "client_secret": flow.client_secret,
            "redirect_uri": flow.redirect_uri,
        }
        if flow.verifier:
            form["code_verifier"] = flow.verifier
        status, raw, _ = self._raw(
            spec,
            "POST",
            spec.auth.token_url,
            {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
            urllib.parse.urlencode(form).encode("ascii"),
        )
        grant = self._decode(raw, code)
        if status >= 300 or not isinstance(grant, Mapping) or not grant.get("access_token"):
            raise VaultError(f"{spec.label} refused the code with {status}")
        with guard() if guard is not None else contextlib.nullcontext():
            return self._admit(
                spec,
                str(grant["access_token"]),
                refresh=str(grant.get("refresh_token", "") or ""),
                expires_in=_expires_in(grant, spec.label, VaultError),
                client=(flow.client_id, flow.client_secret),
                admit_if=flow.claim,
            )

    def probe(self, connector_id: str) -> ConnectionRecord:
        """Re-check a stored credential and record what was learnt (connectors/health.py): a
        verdict with its time, or an attempt that reached none, beside the last verdict.

        A stale OAuth token is refreshed first, with the token a call would use, on a record that
        is switched off or needs reconnecting as well; a token the provider accepts returns a
        ``needs_reauth`` record to connected. The notice from the last connect is never touched."""
        spec = self.spec(connector_id)
        with self._lock:
            rec = self.record(connector_id)
            token = self._get(connector_id, "token")
            if rec.status == "disconnected" or token is None:
                rec.health, rec.health_at = "unknown", _iso(_now())
                rec.health_detail = "not connected"
                self._save()
                return rec
            generation = self._generation(connector_id)
            stale = self._stale(spec, rec)
        body: Any = None
        try:
            if stale:
                token = self._probe_token(spec, generation)
            status, body = self._ask(spec, token)
            outcome = health.classify(
                status, body, label=spec.label, oauth=spec.auth.type == "oauth"
            )
        except NotConnected:
            return rec  # disconnected or reconnected while the probe was out: nothing to say
        except VaultError as exc:
            outcome = health.classify(exc=exc, label=spec.label)
        with self._lock:
            if self._generation(connector_id) != generation or rec.status == "disconnected":
                return rec
            health.record(rec, outcome, _now())
            rec.health_detail = redact(rec.health_detail, [token])
            rec.attempt_detail = redact(rec.attempt_detail, [token])
            if isinstance(outcome, health.Verdict) and outcome.health == "healthy":
                identity, account = self._identity_of(spec, body)
                if identity:
                    rec.identity = identity
                if account:
                    rec.account = account
                if rec.status == "needs_reauth":
                    rec.status = "connected"
            self._changed(connector_id)
        return rec

    def _probe_token(self, spec: ConnectorSpec, generation: int) -> str:
        """The probe's own way to a fresh token: not :meth:`_fresh_token`, which refuses a record
        that is not live. Under the connector's refresh guard, after its own disconnected check."""
        with self._refresh_guard(spec.id):
            with self._lock:
                rec = self.record(spec.id)
                token = self._get(spec.id, "token")
                if (
                    rec.status == "disconnected"
                    or token is None
                    or self._generation(spec.id) != generation
                ):
                    raise NotConnected(f"{spec.label} was disconnected while it was probed")
                if not self._stale(spec, rec):
                    return token  # another caller refreshed it while this one waited
            return self._refresh(spec, generation, live_only=False)

    def disconnect(self, connector_id: str) -> ConnectionRecord:
        """Revoke upstream when the spec knows how; destroy every sealed value; keep the
        switches, which are the person's and not the credential's."""
        spec = self.spec(connector_id)
        try:
            token = self._get(connector_id, "token")
        except VaultError:
            # A seal that cannot be read (a locked keychain) cannot revoke upstream, and is no
            # more a reason to keep the credential than an unreachable revoke endpoint is.
            token = None
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
            self._next_generation(connector_id)
            self._drop(connector_id)
            rec = self.record(connector_id)
            rec.status = "disconnected"
            rec.identity = ""
            rec.account = ""
            rec.connected_at = ""
            rec.expires_at = ""
            rec.health, rec.health_at, rec.health_detail = "unknown", _iso(_now()), "disconnected"
            rec.attempt_at, rec.attempt_detail, rec.notice = "", "", ""
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
            rec.switches_account = rec.account

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
