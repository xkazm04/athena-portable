"""WP-V: the corpus comes from the sheet alone, deterministically, truth by construction."""

from __future__ import annotations

import html
import json
import re
import struct
from pathlib import Path

import pytest

from athena.proving.adopt_tiers.scenarios import Scenario, load_scenarios
from athena.proving.docread.corpus import (
    DEGRADATIONS,
    PDF,
    build_docs,
    png_size,
    units_of,
    write_docs,
)
from athena.proving.docread.score import score_unit
from athena.proving.docread.templates import KINDS

SCENARIOS = load_scenarios()


def _plain(text: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text))).strip()


def test_three_documents_per_scenario_nine_scenarios() -> None:
    assert len(SCENARIOS) == 9
    for s in SCENARIOS:
        assert [d.kind for d in build_docs(s)] == list(KINDS)


@pytest.mark.parametrize("scenario", SCENARIOS, ids=lambda s: s.id)
def test_every_fact_and_trap_is_stated_by_a_document(scenario: Scenario) -> None:
    entries = {e.id for e in scenario.sheet if e.kind in ("fact", "trap")}
    assert {i for d in build_docs(scenario) for i in d.facts} == entries


@pytest.mark.parametrize("scenario", SCENARIOS, ids=lambda s: s.id)
def test_documents_state_the_sheet_text_and_only_that(scenario: Scenario) -> None:
    by_id = {e.id: e for e in scenario.sheet}
    for d in build_docs(scenario):
        body = _plain(d.html)
        for entry_id in d.facts:
            assert _plain(by_id[entry_id].truth) in body
        for entry in scenario.sheet:
            if entry.kind in ("fact", "trap") and entry.id not in d.facts:
                assert _plain(entry.truth) not in body


@pytest.mark.parametrize("scenario", SCENARIOS, ids=lambda s: s.id)
def test_the_sheet_truth_scores_correct_against_its_own_patterns(scenario: Scenario) -> None:
    """A reader that copies the sheet verbatim must be scored right, or the scorer is the bug."""
    entries = [e for e in scenario.sheet if e.kind in ("fact", "trap")]
    rows = score_unit(scenario.sheet, [e.id for e in entries], {e.id: e.truth for e in entries})
    assert all(r["correct"] and not r["false_fact"] for r in rows), rows


def test_html_is_deterministic() -> None:
    first = [d.html for s in SCENARIOS for d in build_docs(s)]
    second = [d.html for s in SCENARIOS for d in build_docs(s)]
    assert first == second
    assert len(set(first)) == len(first)  # nothing collapsed into a duplicate


def test_written_files_are_byte_identical_across_runs(tmp_path: Path) -> None:
    docs = build_docs(SCENARIOS[0])
    write_docs(tmp_path / "a", docs)
    write_docs(tmp_path / "b", docs)
    files = [f for f in (tmp_path / "a").rglob("*") if f.is_file()]
    assert files
    for f in files:
        assert f.read_bytes() == (tmp_path / "b" / f.relative_to(tmp_path / "a")).read_bytes()


def test_facts_json_names_the_ids_each_document_states(tmp_path: Path) -> None:
    docs = build_docs(SCENARIOS[0])
    write_docs(tmp_path, docs)
    for d in docs:
        raw = json.loads((tmp_path / d.stem).with_suffix(".facts.json").read_text())
        assert raw["states"] == list(d.facts)


def test_units_cover_each_degradation_and_one_pdf_per_scenario() -> None:
    docs = [d for s in SCENARIOS for d in build_docs(s)]
    units = units_of(docs, (*DEGRADATIONS, PDF))
    assert len(units) == 27 * 3 + 9
    pdfs = [u for u in units if u.degradation == PDF]
    assert len(pdfs) == 9 and all(u.kind == "letter" and u.file.endswith(".pdf") for u in pdfs)
    # the VL is never handed the PDF: it reads the clean render of the same letter
    assert all(u.image.endswith("letter.clean.png") for u in pdfs)


def test_png_size_reads_the_header() -> None:
    header = b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", 992, 1404)
    assert png_size(header) == (992, 1404)
    with pytest.raises(ValueError):
        png_size(b"GIF89a" + b"\0" * 30)
