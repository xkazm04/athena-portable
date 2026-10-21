"""save_choice stages under a unique name: overlapping saves do not collide, failures clean up."""

from __future__ import annotations

import os
import threading
from pathlib import Path

import pytest

from athena.channels.voice import config
from athena.channels.voice.config import DEFAULT_CHOICE, VoiceChoice, load_choice, save_choice

A = VoiceChoice(stt_model="tiny.en")
B = VoiceChoice(stt_model="small.en")


def test_overlapping_saves_neither_raise_and_leave_one_whole_choice(tmp_path: Path) -> None:
    errors: list[BaseException] = []
    barrier = threading.Barrier(2)

    def run(choice: VoiceChoice) -> None:
        try:
            barrier.wait()
            for _ in range(200):
                save_choice(tmp_path, choice)
        except BaseException as exc:
            errors.append(exc)

    threads = [threading.Thread(target=run, args=(c,)) for c in (A, B)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []
    assert DEFAULT_CHOICE not in (A, B)
    assert load_choice(tmp_path) in (A, B)
    assert list(tmp_path.glob("*.tmp")) == []


def test_failed_replace_leaves_no_staging_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    save_choice(tmp_path, A)

    def boom(src: object, dst: object) -> None:
        raise OSError("replace refused")

    monkeypatch.setattr(config.os, "replace", boom)
    with pytest.raises(OSError, match="replace refused"):
        save_choice(tmp_path, B)
    monkeypatch.setattr(config.os, "replace", os.replace)

    assert list(tmp_path.glob("*.tmp")) == []
    assert load_choice(tmp_path) == A
