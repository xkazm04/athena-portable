"""ADR 0226 decision 2 (the ``muse`` Reader): Muse Spark reads one sheet through Muse Code.

Meta's own model on the person's Muse Code plan, before an API key exists: one ``muse exec`` per
read, the sheet's PNG attached with ``--image`` and the answer shaped by ``--output-schema``
(measured on Muse Code 1.4.13, 2026-10-27: a rendered bill, five fields, all exact, 4.3 s). The
run carries :data:`~athena.harness.cli_harness.MUSE_EXTRA_ARGS`, so Contributor mode is off and
Muse's own tools, shell, web and the person's Claude skills stay out of it.

- **The picture is the PNG beside the sheet's PDF** (``python -m athena.senses render`` writes it
  when a Chrome is found). No PNG, or no ``muse`` on PATH -> the ``fallback`` answers and its call
  row says ``fixture``: a degraded call is visible, never silent.
- **A failed run** (exit, timeout, no terminal record, an answer that is not the schema) -> every
  field is unreadable, so the sense asks rather than guesses; the call row still says ``muse``.
- **Provenance:** frame ``0`` of the sheet and no box (the reader is asked for none).
- **Cost:** a plan call has no invoice line. The row prices its tokens at Muse Spark's list rate
  (:func:`athena.harness.meta.prices.token_cost`), ``cost_estimated=True``: what the same read
  would cost on the API, which is the figure spike 01's R3 is about.
- **The run's workspace is a fresh temp directory**: Muse refuses a workspace that contains its
  own ``TMPDIR`` tool-output root, so the directory is a child of it, never the repo.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from athena.harness.cli_harness import MUSE_EXTRA_ARGS
from athena.harness.transports import child_env
from athena.senses.backends import FixtureReader
from athena.senses.claude_reader import READ_SYSTEM, parse_reading
from athena.senses.contract import Reading, ReadRequest, SenseCall

MODEL = "muse-spark-1.3"
EXECUTABLE = "muse"
READ_TIMEOUT_S = 180.0

SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["fields", "unreadable"],
    "properties": {
        "fields": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "value", "confidence"],
                "properties": {
                    "name": {"type": "string"},
                    "value": {"type": "string"},
                    "confidence": {"type": "number"},
                },
            },
        },
        "unreadable": {"type": "array", "items": {"type": "string"}},
    },
}

Run = Callable[..., Any]


def read_prompt(request: ReadRequest) -> str:
    from athena.senses.paper.render import field_label

    rows = "\n".join(f"- {f} ({field_label(f)})" for f in request.fields)
    hint = f"\nIt should be a {request.hint}." if request.hint else ""
    rules = READ_SYSTEM.split("Answer with only")[0].replace(
        "Use the Read tool on the one file you are given. Read nothing else.",
        "The sheet is the picture attached to this message.",
    )
    return f"{rules}\nTHE SHEET\nThe attached picture.{hint}\n\nFIELDS\n{rows}\n\nCopy the fields."


def answer_of(stdout: str) -> tuple[Mapping[str, Any] | None, int, int]:
    """The terminal answer as JSON (``None`` when the run did not complete with one), and the
    input and output tokens its ``run.usage`` record reported."""
    value: Mapping[str, Any] | None = None
    tokens_in = tokens_out = 0
    for line in stdout.splitlines():
        line = line.strip().lstrip("﻿")
        if not line.startswith("{"):
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        kind, payload = record.get("payload_type"), record.get("payload") or {}
        if kind == "run.usage":
            for row in payload.get("models") or []:
                tokens_in += int(row.get("input_tokens") or 0)
                tokens_out += int(row.get("output_tokens") or 0)
        elif kind == "run.terminal.completed":
            try:
                parsed = json.loads(str(payload.get("text", "")))
            except json.JSONDecodeError:
                parsed = None
            value = parsed if isinstance(parsed, Mapping) else None
    return value, tokens_in, tokens_out


class MuseReader:
    """A :class:`~athena.senses.contract.Reader` on ``muse exec``. ``run`` and ``which`` are seams
    for tests: a fake ``subprocess.run`` and a ``which`` that finds no CLI."""

    def __init__(
        self,
        *,
        fallback: FixtureReader,
        run: Run = subprocess.run,
        which: Callable[[str], str | None] = shutil.which,
        model: str = MODEL,
    ) -> None:
        self.fallback = fallback
        self.run = run
        self.which = which
        self.model = model

    def read(self, request: ReadRequest) -> tuple[Reading, SenseCall]:
        picture = request.file.with_suffix(".png") if request.file is not None else None
        executable = self.which(EXECUTABLE)
        if picture is None or not picture.is_file() or executable is None:
            return self.fallback.read(request)
        started = time.monotonic()
        with tempfile.TemporaryDirectory(prefix="athena-muse-read-") as tmp:
            work = Path(tmp)
            prompt, schema = work / "prompt.md", work / "schema.json"
            prompt.write_text(read_prompt(request), encoding="utf-8")
            schema.write_text(json.dumps(SCHEMA), encoding="utf-8")
            argv = [
                executable,
                "exec",
                "--json",
                "--model",
                self.model,
                "--prompt-file",
                str(prompt),
                "--image",
                str(picture),
                "--output-schema",
                str(schema),
                "--reasoning-effort",
                "low",
                *MUSE_EXTRA_ARGS,
            ]
            try:
                done = self.run(
                    argv,
                    cwd=str(work),
                    env=child_env(os.environ),
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=READ_TIMEOUT_S,
                    check=False,
                )
                stdout = (done.stdout or "") if done.returncode == 0 else ""
            except (OSError, subprocess.SubprocessError):
                stdout = ""
        value, tokens_in, tokens_out = answer_of(stdout)
        fields, unreadable = parse_reading(request, value)
        ms = int((time.monotonic() - started) * 1000)
        return Reading(request.media.id, fields, unreadable), self._call(
            request, tokens_in, tokens_out, ms
        )

    def _call(self, request: ReadRequest, tokens_in: int, tokens_out: int, ms: int) -> SenseCall:
        from athena.harness.meta.prices import token_cost

        priced = token_cost(self.model, tokens_in, tokens_out) if tokens_in or tokens_out else None
        return SenseCall(
            sense=request.media.sense,
            role="read",
            backend="muse",
            model=self.model,
            mode="standard",
            media_id=request.media.id,
            units=float(tokens_in + tokens_out),
            unit="token",
            cost_usd=priced,
            cost_estimated=True,
            latency_ms=ms,
        )
