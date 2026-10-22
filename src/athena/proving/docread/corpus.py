"""WP-V (nvidia-revisit): the document corpus, built from fact sheets and rendered by Playwright.

Per scenario three documents (letter, statement, notice), each stating a deterministic subset of
the sheet's fact/trap entries (every entry is stated by at least one document), as HTML filled
from sheet text only. :func:`render` hands the HTML to ``examples/journey/scripts/render-docs.mjs``
(Playwright lives in node), which writes the PNGs at three degradations and one PDF per scenario
(the letter). Ground truth is by construction: ``<kind>.facts.json`` lists the sheet ids a
document states.
"""

from __future__ import annotations

import json
import shutil
import struct
import subprocess
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from athena.proving.adopt_tiers.scenarios import Entry, Scenario
from athena.proving.docread.templates import KINDS, Statement, render_html

__all__ = [
    "DEGRADATIONS",
    "MAX_EDGE",
    "PDF",
    "RENDER_SCRIPT",
    "DocSpec",
    "Unit",
    "build_docs",
    "png_size",
    "render",
    "units_of",
    "write_docs",
]

#: The three image degradations, in the order the brief names them.
DEGRADATIONS: tuple[str, ...] = ("clean", "skew", "scan")
#: The unit label for the scenario's letter read as a PDF (the VL reads its clean PNG instead).
PDF = "pdf"
#: The long edge a picture sent to the VL may have (the renderer keeps below it by design).
MAX_EDGE = 1600
REPO = Path(__file__).resolve().parents[4]
RENDER_SCRIPT = REPO / "examples" / "journey" / "scripts" / "render-docs.mjs"


@dataclass(frozen=True)
class DocSpec:
    """One document: where it lives under the corpus, the HTML, and the entries it states."""

    scenario: str
    kind: str
    html: str
    facts: tuple[str, ...]

    @property
    def stem(self) -> str:
        return f"{self.scenario}/{self.kind}"


@dataclass(frozen=True)
class Unit:
    """One thing a reader reads: a document at a degradation (or the letter as a PDF)."""

    scenario: str
    kind: str
    degradation: str
    #: Corpus-relative file the Claude lane reads.
    file: str
    #: Corpus-relative PNG the VL reads (the clean render for a PDF).
    image: str
    facts: tuple[str, ...]

    @property
    def id(self) -> str:
        return f"{self.scenario}/{self.kind}/{self.degradation}"


def stated_ids(entries: Sequence[Entry]) -> list[list[str]]:
    """The entry ids each of the three documents states: entry ``i`` goes to document ``i % 3``
    and, when ``i`` is even, also to document ``(i + 1) % 3``. Every entry lands somewhere."""
    dealt: list[list[str]] = [[] for _ in KINDS]
    for i, entry in enumerate(entries):
        dealt[i % 3].append(entry.id)
        if i % 2 == 0:
            dealt[(i + 1) % 3].append(entry.id)
    return dealt


def build_docs(scenario: Scenario) -> list[DocSpec]:
    """The scenario's three documents, deterministically and without a model."""
    entries = [e for e in scenario.sheet if e.kind in ("fact", "trap")]
    by_id = {e.id: e for e in entries}
    title = str(scenario.playbook.get("title") or scenario.playbook_id)
    docs: list[DocSpec] = []
    for kind, ids in zip(KINDS, stated_ids(entries), strict=True):
        statements = [Statement(i, by_id[i].about, by_id[i].truth) for i in ids]
        page = render_html(kind, scenario.id, scenario.person, title, statements)
        docs.append(DocSpec(scenario.id, kind, page, tuple(ids)))
    return docs


def write_docs(corpus: Path, docs: Sequence[DocSpec]) -> None:
    """``<corpus>/<scenario>/<kind>.html`` and ``<kind>.facts.json`` for each document."""
    for doc in docs:
        base = corpus / doc.stem
        base.parent.mkdir(parents=True, exist_ok=True)
        base.with_suffix(".html").write_text(doc.html, encoding="utf-8", newline="\n")
        base.with_suffix(".facts.json").write_text(
            json.dumps({"scenario": doc.scenario, "kind": doc.kind, "states": list(doc.facts)})
            + "\n",
            encoding="utf-8",
            newline="\n",
        )


def units_of(docs: Sequence[DocSpec], degradations: Sequence[str]) -> list[Unit]:
    """Every unit to read: each document at each degradation, plus each letter as a PDF when
    ``pdf`` is among the degradations."""
    units: list[Unit] = []
    for doc in docs:
        for deg in degradations:
            if deg == PDF:
                if doc.kind == "letter":
                    units.append(
                        Unit(
                            doc.scenario,
                            doc.kind,
                            PDF,
                            f"{doc.stem}.pdf",
                            f"{doc.stem}.clean.png",
                            doc.facts,
                        )
                    )
                continue
            png = f"{doc.stem}.{deg}.png"
            units.append(Unit(doc.scenario, doc.kind, deg, png, png, doc.facts))
    return units


Runner = Callable[[Sequence[str]], "subprocess.CompletedProcess[str]"]


def _node_run(argv: Sequence[str]) -> subprocess.CompletedProcess[str]:  # pragma: no cover
    return subprocess.run(list(argv), capture_output=True, text=True, check=False, timeout=900)


def render(
    corpus: Path,
    docs: Sequence[DocSpec],
    *,
    run: Runner = _node_run,
    node: str | None = None,
) -> None:
    """Render every document's HTML to PNGs (and the letters to PDF) through Playwright."""
    executable = node or shutil.which("node")
    if executable is None:
        raise RuntimeError("node is not on PATH; render-docs.mjs needs it (and Playwright)")
    jobs = [
        {
            "html": str(corpus / f"{d.stem}.html"),
            "prefix": str(corpus / d.stem),
            "pdf": d.kind == "letter",
        }
        for d in docs
    ]
    manifest = corpus / "render-manifest.json"
    manifest.write_text(json.dumps(jobs, indent=1) + "\n", encoding="utf-8")
    done = run([executable, str(RENDER_SCRIPT), "--manifest", str(manifest)])
    if done.returncode != 0:
        raise RuntimeError(f"render-docs.mjs failed ({done.returncode}): {done.stderr[-800:]}")


def png_size(data: bytes) -> tuple[int, int]:
    """``(width, height)`` from a PNG header, or raise ``ValueError``."""
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise ValueError("not a PNG")
    width, height = struct.unpack(">II", data[16:24])
    return int(width), int(height)
