"""A connector as the catalog sees it: the :class:`ConnectorPort` over one spec and the vault.

(README §4; ADR 0021.) Every rule a connector tool obeys beyond the gate's own is decided here,
before a provider runs, from the record read live on each call:

1. **Registration follows connection.** :meth:`Service.list_tools` yields the spec's tools only
   while the connection is live, so an unconnected service is not mentioned to the model at all
   rather than mentioned and then refused.
2. **The writes switch.** A write — any tool the catalog classes ``GATED`` — runs only while the
   connector's writes switch is on. The switch layers on the approval card; it never replaces it.
3. **The egress gate.** A write's named parameters are checked against the allow-list, values
   normalised, the offending address named; an empty allow-list refuses every write. Reads are
   never egress-gated.
4. **Reads are fenced and capped.** A read's text is cut to :data:`READ_CAP` with the cut
   announced, then wrapped in the nonce fence, so the harness has nothing left to cut and the
   model never reads a mailbox as instructions.
5. **Three error channels.** A provider's refusal is ``ok=False`` with a sanitised reason; a
   grant that is gone is the one sentence that sends the person to Connectors; a refused host is
   a bug in a provider and is reported as such. A write whose answer never came — it timed out,
   the connection dropped after it was sent, or the provider answered 5xx — is
   ``outcome_unknown``, not a failure: it may have run, and a record that said "failed" would
   invite the second send (ADR 0101). A read in the same plight is still ``engine_error``.
6. **No secret surface.** There is no tool here that lists, shows or rotates a credential.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any

from athena.connectors.addresses import one_address, refusal_reason
from athena.connectors.providers import gmail, notion
from athena.connectors.spec import ConnectorSpec, ToolSpec
from athena.connectors.vault import NeedsReauth, NoAnswer, Vault, VaultError
from athena.contracts.manifest import HostTool
from athena.contracts.registry import ExecResult, Tier, ToolClass
from athena.core.fence import wrap_untrusted

__all__ = ["READ_CAP", "Service", "check_egress", "is_write", "read_result", "services_for"]

#: The same cap every other READ in the catalog is held to.
READ_CAP = 1600
CONNECTOR_TIER: Tier = 3

Provider = Callable[[Any, str, Mapping[str, Any]], tuple[bool, str]]
PROVIDERS: dict[str, Provider] = {"gmail": gmail.execute, "notion": notion.execute}


def is_write(tool: HostTool) -> bool:
    """The catalog's own answer, read from the one rule that derives it: anything that is not
    declared reversible, or that leaves the app, is ``GATED`` — an unset ``reversible`` included,
    as the panel lists it (ADR 0116)."""
    return tool.default_class() is ToolClass.GATED


def _values(params: Mapping[str, Any], names: Sequence[str]) -> list[str]:
    out: list[str] = []
    for name in names:
        value = params.get(name)
        if isinstance(value, str):
            out.append(value)
        elif isinstance(value, list):
            out.extend(str(v) for v in value)
    return out


def _normal(value: str, kind: str) -> str:
    text = value.strip().lower()
    if kind == "resources":
        return text.replace("-", "")
    return one_address(text) or text  # "Name <a@b>" is the address inside


def check_egress(
    spec: ConnectorSpec, tool: ToolSpec, params: Mapping[str, Any], allowlist: Sequence[str]
) -> str | None:
    """The reason a write must not leave, or ``None`` when every address is allowed."""
    if not tool.egress_params:
        return None
    allowed = {_normal(v, spec.egress) for v in allowlist}
    if not allowed:
        noun = "recipients" if spec.egress == "recipients" else "pages"
        return f"{spec.label} has no allowed {noun}; add some in Connectors before a write"
    for value in _values(params, tool.egress_params):
        if spec.egress == "recipients" and one_address(value) is None:
            return refusal_reason(value)
        if _normal(value, spec.egress) not in allowed:
            return f"{value!r} is not on {spec.label}'s allow-list"
    return None


def read_result(text: str, label: str) -> str:
    """Capped inside the fence, so the cut is announced and nothing outside the fence is cut.
    ``label`` is the connector id — the fence's own slug rule — so a reader of the prompt sees
    ``notion`` on the fence and not a display name."""
    total = len(text)
    if total > READ_CAP:
        text = f"{text[:READ_CAP]}\n(showing {READ_CAP} of {total})"
    return wrap_untrusted(text, label=label)


class Service:
    """One connector's port. The catalog merges it; the gate calls it; the vault dials for it."""

    def __init__(self, spec: ConnectorSpec, vault: Vault, provider: Provider | None = None) -> None:
        self.spec = spec
        self.vault = vault
        provider = provider or PROVIDERS.get(spec.id)
        if provider is None:
            raise VaultError(f"no provider is built for connector {spec.id!r}")
        self._provider = provider

    def list_tools(self) -> Sequence[HostTool]:
        if not self.vault.is_live(self.spec.id):
            return []
        return [t.tool for t in self.spec.tools]

    def call(self, name: str, params: dict[str, Any]) -> ExecResult:
        tool = self.spec.tool(name)
        if tool is None:
            return ExecResult.failure(
                "unknown_ref", f"{self.spec.label} has no tool {name!r}", tier=CONNECTOR_TIER
            )
        record = self.vault.record(self.spec.id)
        write = is_write(tool.tool)
        if write:
            if not record.writes_enabled:
                return ExecResult.failure(
                    "validator_failed",
                    f"writes are switched off for {self.spec.label}; turn them on in Connectors",
                    tier=CONNECTOR_TIER,
                )
            refusal = check_egress(self.spec, tool, params, record.allowlist)
            if refusal is not None:
                return ExecResult.failure("validator_failed", refusal, tier=CONNECTOR_TIER)

        statuses: list[int] = []

        def request(method: str, url: str, json_body: Any) -> tuple[int, Any]:
            status, body = self.vault.request(self.spec.id, method, url, json_body)
            statuses.append(status)
            return status, body

        try:
            ok, text = self._provider(request, name, params)
        except NeedsReauth as exc:
            return ExecResult.failure("validator_failed", str(exc), tier=CONNECTOR_TIER)
        except NoAnswer as exc:
            if write:
                return self._unknown(f"{self.spec.label}: {exc}")
            return ExecResult.failure("engine_error", str(exc), tier=CONNECTOR_TIER)
        except VaultError as exc:
            return ExecResult.failure("engine_error", str(exc), tier=CONNECTOR_TIER)
        except gmail.SubjectRefused as exc:
            return ExecResult.failure("validator_failed", str(exc), tier=CONNECTOR_TIER)
        except ValueError as exc:  # a provider's own refusal never ends the turn
            return ExecResult.failure(
                "engine_error",
                f"{self.spec.label} could not build the request: {exc}",
                tier=CONNECTOR_TIER,
            )
        if not ok:
            if write and statuses and statuses[-1] >= 500:
                return self._unknown(text)
            return ExecResult.failure("engine_error", text, tier=CONNECTOR_TIER)
        if write:
            return ExecResult(ok=True, output=text, tier=CONNECTOR_TIER)
        return ExecResult(ok=True, output=read_result(text, self.spec.id), tier=CONNECTOR_TIER)

    @staticmethod
    def _unknown(said: str) -> ExecResult:
        """A write that was sent and whose outcome nobody heard (ADR 0101)."""
        return ExecResult.failure(
            "outcome_unknown",
            f"{said}; the write may have gone through, so check before trying it again",
            tier=CONNECTOR_TIER,
        )


def services_for(vault: Vault) -> dict[str, Service]:
    """One service per spec that has a provider. A spec without one is left out, not broken."""
    out: dict[str, Service] = {}
    for cid, spec in vault.specs.items():
        if cid in PROVIDERS:
            out[cid] = Service(spec, vault)
    return out
