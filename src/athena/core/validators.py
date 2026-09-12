"""Parameter validation — the last line of the gate (README §3.3, ADR 0004).

A hand-written subset of JSON Schema, stdlib only (ADR 0002): ``type``, ``required``, ``enum``,
``additionalProperties: false``, ``maxLength``, ``minItems``, ``maxItems``, ``minimum``,
``maximum`` and nested ``items``. That subset is exactly what the manifests in this repository
declare — an enum and a ``maxItems`` on every parameter that addresses a page — and refusing to
grow it is what keeps ``core`` dependency-free.

Every rejection carries a reason from ``ERROR_REASONS`` and puts the human sentence in ``detail``:
the ledger groups by the reason, and the model reads the detail on its next turn. A validator that
invented its own reason string would be a ledger column nobody can group by.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any

from athena.contracts.ids import is_id
from athena.contracts.registry import TurnContext, ValidationResult, ValidatorFn

__all__ = [
    "all_of",
    "check_schema",
    "live_sources",
    "schema_validator",
]

#: JSON Schema's type names, mapped onto what ``isinstance`` understands.
_TYPES: dict[str, type | tuple[type, ...]] = {
    "string": str,
    "number": (int, float),
    "integer": int,
    "boolean": bool,
    "array": list,
    "object": dict,
}


def check_schema(params: dict[str, Any], schema: dict[str, Any]) -> ValidationResult:
    """Validate ``params`` against the supported subset, or reject with the first problem found."""
    if not isinstance(params, dict):
        return ValidationResult.reject("validator_failed", "params must be an object")

    for name in schema.get("required", []):
        if name not in params:
            return ValidationResult.reject(
                "validator_failed", f"missing required parameter {name!r}"
            )

    props = schema.get("properties", {})
    if not isinstance(props, dict):
        props = {}

    if schema.get("additionalProperties") is False:
        extra = sorted(set(params) - set(props))
        if extra:
            return ValidationResult.reject(
                "validator_failed", f"unknown parameter(s): {', '.join(extra)}"
            )

    for name, value in params.items():
        sub = props.get(name)
        if isinstance(sub, dict):
            result = _check_value(name, value, sub)
            if not result.ok:
                return result
    return ValidationResult.accept()


def _check_value(path: str, value: Any, schema: dict[str, Any]) -> ValidationResult:
    expected = schema.get("type")
    if isinstance(expected, str) and expected in _TYPES:
        # ``True`` is an ``int`` in Python and is not a number in any manifest that ever meant
        # one, so the two numeric types refuse a bool before isinstance would wave it through.
        if expected in ("integer", "number") and isinstance(value, bool):
            return ValidationResult.reject(
                "validator_failed", f"{path}: expected {expected}, got boolean"
            )
        if not isinstance(value, _TYPES[expected]):
            return ValidationResult.reject(
                "validator_failed", f"{path}: expected {expected}, got {type(value).__name__}"
            )

    if "enum" in schema:
        allowed = schema["enum"]
        if isinstance(allowed, list) and value not in allowed:
            rendered = ", ".join(repr(v) for v in allowed)
            return ValidationResult.reject(
                "validator_failed", f"{path}: {value!r} is not one of [{rendered}]"
            )

    if isinstance(value, str):
        limit = schema.get("maxLength")
        if isinstance(limit, int) and len(value) > limit:
            return ValidationResult.reject(
                "validator_failed", f"{path}: {len(value)} characters exceeds maxLength {limit}"
            )

    if isinstance(value, list):
        cap = schema.get("maxItems")
        if isinstance(cap, int) and len(value) > cap:
            return ValidationResult.reject(
                "validator_failed", f"{path}: {len(value)} items exceeds maxItems {cap}"
            )
        floor = schema.get("minItems")
        if isinstance(floor, int) and len(value) < floor:
            return ValidationResult.reject(
                "validator_failed", f"{path}: {len(value)} items is under minItems {floor}"
            )
        items = schema.get("items")
        if isinstance(items, dict):
            for index, item in enumerate(value):
                result = _check_value(f"{path}[{index}]", item, items)
                if not result.ok:
                    return result

    if isinstance(value, int | float) and not isinstance(value, bool):
        low = schema.get("minimum")
        if isinstance(low, int | float) and value < low:
            return ValidationResult.reject(
                "validator_failed", f"{path}: {value} is below minimum {low}"
            )
        high = schema.get("maximum")
        if isinstance(high, int | float) and value > high:
            return ValidationResult.reject(
                "validator_failed", f"{path}: {value} is above maximum {high}"
            )

    return ValidationResult.accept()


def schema_validator(schema: dict[str, Any]) -> ValidatorFn:
    """Bind a schema into the ``(params, ctx) -> ValidationResult`` shape the registry wants."""

    def _validate(params: dict[str, Any], ctx: TurnContext) -> ValidationResult:
        return check_schema(params, schema)

    return _validate


def all_of(*validators: ValidatorFn) -> ValidatorFn:
    """Run validators in order and return the first rejection, or an acceptance.

    Order matters: the schema check runs first so that a policy validator behind it can read the
    parameters knowing they are the shape it expects.
    """

    def _validate(params: dict[str, Any], ctx: TurnContext) -> ValidationResult:
        for validator in validators:
            result = validator(params, ctx)
            if not result.ok:
                return result
        return ValidationResult.accept()

    return _validate


def live_sources(
    sources_alive: Callable[[Sequence[str]], bool],
    *,
    field: str = "sources",
) -> ValidatorFn:
    """Refuse a memory write whose sources are not live episode ids (README §2 invariant 2).

    ``sources_alive`` is a port — the brain answers it — so the catalog states the provenance rule
    without importing the memory engine. This is the gate's copy of the rule; the brain enforces
    it again at write. Two checks of one invariant is the design: the gate refuses before a
    decision card is ever filed, and the writer refuses whatever route reached it.
    """

    def _validate(params: dict[str, Any], ctx: TurnContext) -> ValidationResult:
        raw = params.get(field)
        if not isinstance(raw, list) or not raw:
            return ValidationResult.reject(
                "validator_failed", f"{field} must be a non-empty list of episode ids"
            )
        sources = [str(item) for item in raw]
        malformed = [s for s in sources if not is_id("episode", s)]
        if malformed:
            return ValidationResult.reject(
                "validator_failed",
                f"{field}: not episode ids: {', '.join(sorted(malformed))}",
            )
        if not sources_alive(sources):
            return ValidationResult.reject(
                "validator_failed",
                f"{field}: no such live episodes: {', '.join(sources)}",
            )
        return ValidationResult.accept()

    return _validate
