"""``athena serve`` with a recorded engine: the same daemon, one substituted seam (README §3.5).

This is a **test-only entry point** and it is deliberately thin. It does not compose a daemon of
its own: it installs two substitutions and then calls
:func:`athena.daemon.server.serve` with every flag untouched, so the routes, the gate, the
catalog, the brain, the approval table, the ledger, the token check and the ready line are the
ones ``athena serve`` builds — byte for byte the same code path — and the only things replaced
are:

* the **engine's transport**, which becomes a
  :class:`~athena.harness.transports.ScriptedTransport` replaying ``--transcript`` (ADR 0007), and
* the **voice backend**, when ``--voice-backend scripted`` asks for the
  :class:`~athena.channels.voice.backends.ScriptedBackend` that hears ``--utterance`` in order
  (ADR 0019).

It is a test double of the *engine* and of the *microphone*. It is never a double of the gate, the
catalog or the policy: a scripted daemon refuses exactly what a real one refuses, which is the
only reason a test against it proves anything.

Usage, and the contract another suite may depend on::

    python tests/e2e/serve_scripted.py --transcript <ndjson> --port 0 --token <token> \
        --brain <dir> [--voice-backend scripted] [--utterance "..."] [--no-connectors]

Every other flag of ``athena serve`` is accepted and passed straight through, and the one line on
stdout is the ready line of :mod:`athena.daemon.ready` — same keys, same order, same moment
(bound, then printed, then served).
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

# A test-only script is run as a file, so the package it tests is not necessarily importable from
# the working directory. The repository's ``src`` is two levels up from ``tests/e2e/``.
_SRC = Path(__file__).resolve().parents[2] / "src"
if _SRC.is_dir() and str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from athena.channels.voice.backends import (  # noqa: E402 - after the path is arranged
    ScriptedBackend,
    VoiceBackend,
)
from athena.daemon import server  # noqa: E402
from athena.harness.transports import ScriptedTransport  # noqa: E402

__all__ = ["SCRIPTED_BACKEND", "build_parser", "install", "main"]

#: The name ``--voice-backend`` takes for the scripted microphone. It is added to the daemon's own
#: choices rather than replacing one, so ``auto``, ``openai`` and ``none`` still mean what they
#: mean.
SCRIPTED_BACKEND = "scripted"


def build_parser() -> argparse.ArgumentParser:
    """Only the flags this script adds. Every other flag belongs to ``athena serve``.

    Parsed with ``parse_known_args``, so the daemon's parser stays the one place its flags are
    declared and a flag added there needs no change here.
    """
    parser = argparse.ArgumentParser(
        prog="serve_scripted",
        description=__doc__.splitlines()[0] if __doc__ else "",
        add_help=False,
    )
    parser.add_argument(
        "--transcript",
        required=True,
        help="the NDJSON transcript the engine replays, one blank-line-separated round per "
        "provider invocation",
    )
    parser.add_argument(
        "--utterance",
        action="append",
        default=[],
        metavar="TEXT",
        help="what the scripted voice backend hears, once per utterance, in order; repeatable",
    )
    return parser


def install(transcript: str | Path, utterances: Sequence[str] = ()) -> None:
    """Substitute the engine's transport and teach ``--voice-backend`` the scripted microphone.

    Both substitutions are made by rebinding a name the daemon reads at call time — ``serve``
    imports ``build_local`` inside the function and looks ``backend_from_name`` and
    ``VOICE_BACKENDS`` up on its own module — so nothing about the daemon's own composition is
    copied here. A copy is what drifts.
    """
    path = Path(transcript)
    if not path.is_file():
        raise FileNotFoundError(f"no transcript at {path}")

    from athena import wiring

    built = wiring.build_local

    def build_scripted(**kwargs: Any) -> Any:
        kwargs["transport"] = lambda dialect: ScriptedTransport.from_transcript(path)
        return built(**kwargs)

    wiring.build_local = build_scripted

    chosen = server.backend_from_name

    def backend(name: str, environ: dict[str, str] | None = None) -> VoiceBackend | None:
        if name == SCRIPTED_BACKEND:
            return ScriptedBackend(utterances=list(utterances))
        return chosen(name, environ)

    server.backend_from_name = backend
    if SCRIPTED_BACKEND not in server.VOICE_BACKENDS:
        server.VOICE_BACKENDS = (*server.VOICE_BACKENDS, SCRIPTED_BACKEND)


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    mine, rest = build_parser().parse_known_args(args)
    install(mine.transcript, mine.utterance)
    return server.serve(rest)


if __name__ == "__main__":
    sys.exit(main())
