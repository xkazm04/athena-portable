"""The ``muse`` Reader: argv, the PNG it attaches, the answer it parses and its fallbacks."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from athena.senses.backends import FixtureReader, make_senses
from athena.senses.contract import MediaItem, ReadRequest
from athena.senses.muse_reader import MuseReader, answer_of

ITEM = MediaItem(id="sheet-S01", kind="paper", sense="paper", path="render/sheet-S01.pdf")


def stream(text: str, *, completed: bool = True) -> str:
    usage = {
        "payload_type": "run.usage",
        "payload": {"models": [{"input_tokens": 16604, "output_tokens": 450}]},
    }
    end = {
        "payload_type": f"run.terminal.{'completed' if completed else 'failed'}",
        "payload": {"terminal": "completed" if completed else "failed", "text": text},
    }
    return "\n".join(["muse: noise on stdout", json.dumps(usage), json.dumps(end)])


def sheet(tmp_path: Path) -> Path:
    pdf = tmp_path / "sheet-S01.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    pdf.with_suffix(".png").write_bytes(b"\x89PNG")
    return pdf


def fixtures(tmp_path: Path) -> FixtureReader:
    (tmp_path / "fx").mkdir(exist_ok=True)
    (tmp_path / "fx" / "sheet-S01.json").write_text(
        json.dumps({"reads": [{"fields": [{"name": "bill_id", "value": "FIXTURE"}]}]}), "utf-8"
    )
    return FixtureReader(tmp_path / "fx")


def test_a_read_attaches_the_png_with_contributor_off_and_parses_the_answer(
    tmp_path: Path,
) -> None:
    seen: dict[str, Any] = {}
    answer = {
        "fields": [
            {"name": "bill_id", "value": "RG-1001", "confidence": 1.0},
            {"name": "amount_due_usd", "value": "", "confidence": 0.2},
        ],
        "unreadable": [],
    }

    def run(argv: list[str], **kw: Any) -> Any:
        seen["argv"], seen["env"] = argv, kw["env"]
        assert Path(argv[argv.index("--output-schema") + 1]).is_file()
        return SimpleNamespace(returncode=0, stdout=stream(json.dumps(answer)))

    reader = MuseReader(fallback=fixtures(tmp_path), run=run, which=lambda _: "muse")
    request = ReadRequest(ITEM, sheet(tmp_path), ["bill_id", "amount_due_usd"])
    reading, call = reader.read(request)
    argv = seen["argv"]
    assert argv[argv.index("--image") + 1].endswith("sheet-S01.png")
    assert argv[argv.index("--contributor-mode") + 1] == "off"
    assert argv[argv.index("--model") + 1] == "muse-spark-1.3"
    assert "META_API_KEY" not in seen["env"]
    assert [f.value for f in reading.fields] == ["RG-1001"]
    assert reading.unreadable == ("amount_due_usd",)
    assert call.backend == "muse" and call.cost_estimated and call.cost_usd is not None
    assert call.units == 16604 + 450


def test_a_failed_run_asks_every_field_and_still_says_muse(tmp_path: Path) -> None:
    def run(argv: list[str], **kw: Any) -> Any:
        return SimpleNamespace(returncode=0, stdout=stream("{}", completed=False))

    reader = MuseReader(fallback=fixtures(tmp_path), run=run, which=lambda _: "muse")
    reading, call = reader.read(ReadRequest(ITEM, sheet(tmp_path), ["bill_id"]))
    assert reading.fields == () and reading.unreadable == ("bill_id",)
    assert call.backend == "muse"


def test_no_png_or_no_cli_falls_back_to_the_fixture_and_says_so(tmp_path: Path) -> None:
    pdf = tmp_path / "sheet-S01.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    reader = MuseReader(fallback=fixtures(tmp_path), run=None, which=lambda _: "muse")  # type: ignore[arg-type]
    reading, call = reader.read(ReadRequest(ITEM, pdf, ["bill_id"]))
    assert call.backend == "fixture" and reading.fields[0].value == "FIXTURE"
    no_cli = MuseReader(fallback=fixtures(tmp_path), which=lambda _: None)
    _, call = no_cli.read(ReadRequest(ITEM, sheet(tmp_path), ["bill_id"]))
    assert call.backend == "fixture"


def test_answer_of_ignores_noise_and_a_non_json_answer() -> None:
    assert answer_of(stream("not json")) == (None, 16604, 450)


def test_muse_is_a_reader_only(tmp_path: Path) -> None:
    import pytest

    with pytest.raises(ValueError, match="segmenter has no muse"):
        make_senses(tmp_path, {"segmenter": "muse"})
    assert make_senses(tmp_path, {"reader": "muse"}).backends["reader"] == "muse"
