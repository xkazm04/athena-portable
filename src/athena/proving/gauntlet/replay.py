"""Replay a saved Gauntlet corpus and say what changed against it (README §9; ADR 0177).

A run writes every attack whole into its ``report.json`` (id, surface, target, goal, payload, the
judge's grade and each row's verdict), so a replay needs no new artifact. :func:`load_corpus`
reads one back: each attack is rebuilt from its id plus its content and re-checked against
today's vocabulary (:func:`~.attacks.check_attack`), and one that no longer passes — its surface
or target left the registry — is listed as stale with the reason, never dropped silently. The
source's grades ride along marked with the run that judged them; the source's per-row verdicts
are what :func:`diff` compares the replay's against.

A replay asks no generator and no judge. Proof 2 is not re-measured: re-driving a corpus does not
re-sample the generator, so a valid rate taken from it would be the source's number reported
twice (ADR 0177).
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from athena.proving.gauntlet.attacks import Attack, check_attack
from athena.proving.gauntlet.verdict import BREACHED, HELD

__all__ = ["Corpus", "diff", "load_corpus", "proof_two_na"]

#: The fields of a run result a replay compares, in the order the report names them.
COMPARED: tuple[str, ...] = ("verdict", "pressure", "on_target")


@dataclass(frozen=True)
class Corpus:
    """A saved corpus, ready to drive."""

    #: The run id of the report it came from.
    source: str
    #: The surfaces the source run carried, as its report lists them.
    surfaces: tuple[str, ...]
    #: Every attack that still passes today's check, in the source's order.
    attacks: tuple[Attack, ...]
    #: The source's grade per attack id, ``{"valid": bool, "reason": str | None}``.
    grades: Mapping[str, Mapping[str, Any]] = field(default_factory=dict)
    #: The source's run result per ``(attack id, row key)``; skipped runs are not here.
    verdicts: Mapping[tuple[str, str], Mapping[str, Any]] = field(default_factory=dict)
    #: ``{"attack": id, "reason": why}`` for each attack today's vocabulary refuses.
    stale: tuple[Mapping[str, str], ...] = ()


def _report_path(path: str | Path) -> Path:
    given = Path(path)
    return given / "report.json" if given.is_dir() else given


def load_corpus(path: str | Path, only: Sequence[str] = ()) -> Corpus:
    """The corpus in the run at ``path`` (a run directory or its ``report.json``).

    ``only`` keeps just those attack ids. An id the corpus does not hold, an unreadable report,
    or a corpus with no usable attack raises :class:`ValueError` naming it — before any world is
    built, so a mistyped id costs nothing.
    """
    report_path = _report_path(path)
    try:
        report = json.loads(report_path.read_text("utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError(f"no readable Gauntlet report at {report_path}: {exc}") from exc
    if not isinstance(report, Mapping) or not isinstance(report.get("attacks"), list):
        raise ValueError(f"{report_path} is not a Gauntlet report (no attacks list)")
    source = str(report.get("run_id") or report_path.parent.name)
    saved = [item for item in report["attacks"] if isinstance(item, Mapping)]
    held_ids = {str(item.get("id", "")) for item in saved}
    missing = [attack_id for attack_id in only if attack_id not in held_ids]
    if missing:
        raise ValueError(f"--only names attacks {source} does not hold: {', '.join(missing)}")
    wanted = set(only)

    attacks: list[Attack] = []
    grades: dict[str, dict[str, Any]] = {}
    verdicts: dict[tuple[str, str], dict[str, Any]] = {}
    stale: list[dict[str, str]] = []
    for item in saved:
        attack_id = str(item.get("id", ""))
        if wanted and attack_id not in wanted:
            continue
        surface = str(item.get("surface", ""))
        why = check_attack(
            {key: item.get(key) for key in ("surface", "goal", "payload", "target_tool")},
            surface,
        )
        if why:
            stale.append({"attack": attack_id, "reason": why})
            continue
        attacks.append(
            Attack(
                id=attack_id,
                surface=surface,
                goal=str(item["goal"]).strip(),
                payload=str(item["payload"]),
                target_tool=str(item["target_tool"]),
                generator=str(item.get("generator", "")),
                model=str(item.get("model", "")),
                rung=str(item.get("rung", "")),
            )
        )
        if isinstance(item.get("valid"), bool):
            grades[attack_id] = {"valid": item["valid"], "reason": item.get("judge_reason")}
        for run in item.get("runs") or []:
            if isinstance(run, Mapping) and not run.get("skipped") and run.get("verdict"):
                verdicts[(attack_id, str(run.get("row")))] = {k: run.get(k) for k in COMPARED}
    if not attacks:
        reasons = f" ({len(stale)} stale)" if stale else ""
        raise ValueError(f"no usable attack in the corpus at {report_path}{reasons}")
    surfaces = tuple(str(s) for s in report.get("surfaces") or ()) or tuple(
        dict.fromkeys(a.surface for a in attacks)
    )
    return Corpus(
        source=source,
        surfaces=surfaces,
        attacks=tuple(attacks),
        grades=grades,
        verdicts=verdicts,
        stale=tuple(stale),
    )


def diff(corpus: Corpus, results: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """What moved against the source, per ``(attack, row)`` both runs drove.

    A pair is *changed* when its verdict, pressure or on-target moved; a *regression* is held to
    breached, a *fix* breached to held. A pair the source never drove (a skipped run, a row it did
    not have) is counted ``unmatched``, never compared against an absent verdict.
    """
    changed: list[dict[str, Any]] = []
    compared = unmatched = 0
    for result in results:
        if result.get("skipped"):
            continue
        key = (str(result.get("attack")), str(result.get("row")))
        before = corpus.verdicts.get(key)
        if before is None:
            unmatched += 1
            continue
        compared += 1
        moved = [f for f in COMPARED if _value(before, f) != _value(result, f)]
        if not moved:
            continue
        entry: dict[str, Any] = {
            "attack": key[0],
            "row": key[1],
            "from": before.get("verdict"),
            "to": result.get("verdict"),
        }
        for name in moved:
            if name != "verdict":
                entry[name] = {"from": bool(before.get(name)), "to": bool(result.get(name))}
        changed.append(entry)
    changed.sort(key=lambda c: (c["attack"], c["row"]))
    return {
        "source": corpus.source,
        "compared": compared,
        "unmatched": unmatched,
        "changed": changed,
        "regressions": sum(1 for c in changed if c["from"] == HELD and c["to"] == BREACHED),
        "fixed": sum(1 for c in changed if c["from"] == BREACHED and c["to"] == HELD),
        "stale": [dict(s) for s in corpus.stale],
    }


def _value(result: Mapping[str, Any], name: str) -> Any:
    """A compared field as the report means it: the verdict word, or a flag read as a bool."""
    return result.get(name) if name == "verdict" else bool(result.get(name))


def proof_two_na(source: str) -> str:
    """Why proof 2 has no value on a replay. Shown as is, on the page and in the report."""
    return (
        f"n/a — replay: this corpus was generated and judged in {source}; a replay re-drives it "
        "and does not re-sample the generator, so there is no new valid rate to compare"
    )
