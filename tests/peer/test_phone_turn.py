"""The phone page follows a turn to its end (ADR 0140, "Phone and setup").

athena/peer/mobile/turn.js - followTurn, createTurnReader, pendingTurn, turnMessage. The cases live
in ``tests/peer/phone/turn.test.mjs`` (node:test, a scripted fake beacon); this runs them under
pytest so the Python gate holds them. Skipped only where node is absent (the repo needs node 22.5+).
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from athena.peer.phone import FILES, MOBILE_DIR

HERE = Path(__file__).resolve().parent
SUITE = HERE / "phone" / "turn.test.mjs"
NODE = shutil.which("node")


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_the_turn_follower_cases_pass_under_node() -> None:
    assert NODE is not None
    done = subprocess.run(
        [NODE, "--test", "--test-reporter=tap", str(SUITE)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=120,
        check=False,
    )
    assert done.returncode == 0, done.stdout + done.stderr
    assert "# fail 0" in done.stdout


def test_turn_js_is_served_and_app_js_delegates_to_it() -> None:
    assert FILES["turn.js"] == "text/javascript; charset=utf-8"
    script = (MOBILE_DIR / "app.js").read_text(encoding="utf-8")
    assert 'from "./turn.js"' in script
    # The single-shot reader is gone: a quiet end is resumed, not reported as a failure.
    assert "The answer stopped before it finished." not in script
    # A reload re-attaches to the open turn.
    assert "pendingTurn(" in script
    # The five-second cards poll redraws only when the cards changed.
    assert "if (sameCards(chat.cards, polled)) return;" in script


def test_turn_js_never_writes_html_from_a_string() -> None:
    script = (MOBILE_DIR / "turn.js").read_text(encoding="utf-8")
    assert "innerHTML" not in script and "insertAdjacentHTML" not in script
    assert "eval(" not in script and "document." not in script
