"""The ``athena`` command line: serve, doctor, and rebuild the index (README §3.5, §7).

Three verbs, because three are what this build has a person do from a terminal.

``athena serve``
    Run the local daemon. It is a thin pass-through: every flag after ``serve`` belongs to
    :func:`athena.daemon.server.serve`, which owns the parser, mints or reads the token, composes
    one Athena through ``athena.wiring`` and prints the one ready line. A second parser here would
    be a second place the daemon's flags are declared.

``athena doctor``
    Six stages, in the order a failure actually cascades: the interpreter, the brain, the index,
    the law, the engine, the port. **Only ``fail`` sets the exit code**, and the first non-OK
    stage — ``fail`` or ``warn`` — is reported as the cause. That split is the whole design of the
    command: a missing CLI engine and a port already in use are both worth saying out loud and
    neither means the installation is broken, so reporting them as a non-zero exit would train a
    person to ignore the exit code. What does fail is what nothing else can work without: an
    interpreter with no FTS5, a brain that will not open, a law that is not there.

``athena brain reconcile``
    Rebuild the index from the markdown tree. This is the command that makes "a brain is portable
    by copying the directory" a thing you can do rather than a thing that is claimed: copy it,
    delete ``index.sqlite``, run this.

Every command prints one JSON object on stdout and nothing else, so a shell, a test and the
desktop shell all read the same answer.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from athena import __version__

__all__ = [
    "DOCTOR_STAGES",
    "STATUSES",
    "Stage",
    "build_parser",
    "cmd_doctor",
    "cmd_reconcile",
    "doctor_report",
    "doctor_stages",
    "main",
]

#: A stage's verdict. Only ``fail`` sets the exit code: ``warn`` is a degraded-but-working part
#: and ``skip`` an optional one nobody configured, and neither is a reason to tell somebody their
#: install is broken. The *cause* is the first stage that is not ``ok``, whichever it is.
STATUSES: tuple[str, ...] = ("ok", "warn", "skip", "fail")

#: The stages, in order. A failure early makes the later ones meaningless — there is no index to
#: check without a brain and no turn to run without a law — so the order is the diagnosis.
DOCTOR_STAGES: tuple[str, ...] = ("python", "brain", "index", "constitution", "engine", "port")


@dataclass(frozen=True)
class Stage:
    """One health stage: what was checked, how it went, and a sentence for a person."""

    name: str
    status: str
    detail: str

    def __post_init__(self) -> None:
        if self.status not in STATUSES:
            raise ValueError(f"a stage status must be one of {STATUSES}: {self.status!r}")

    @property
    def ok(self) -> bool:
        """``True`` for anything but a failure. A warning is not a broken installation."""
        return self.status != "fail"

    def as_dict(self) -> dict[str, Any]:
        return {"name": self.name, "status": self.status, "ok": self.ok, "detail": self.detail}


# --- the stages ---------------------------------------------------------------------------------


def _python_stage() -> Stage:
    """The interpreter and the one thing this build needs from it: SQLite with FTS5.

    Recall is BM25 over an FTS5 table, so a CPython built without it cannot open a brain at all.
    It is a ``fail`` and it is first, because every stage below would then fail for a reason that
    is not the reason.
    """
    import sqlite3

    version = sys.version.split()[0]
    try:
        con = sqlite3.connect(":memory:")
        try:
            con.execute("CREATE VIRTUAL TABLE probe USING fts5(body)")
        finally:
            con.close()
    except sqlite3.Error as exc:
        return Stage("python", "fail", f"Python {version}, sqlite {sqlite3.sqlite_version}: {exc}")
    return Stage("python", "ok", f"Python {version}, SQLite {sqlite3.sqlite_version} with FTS5")


def _brain_stage(root: str | Path | None) -> tuple[Stage, Any]:
    """Can this brain be opened and written? Returns the stage and the open brain, or ``None``.

    Opening one creates the tree and applies the schema, so this is a real write and not a
    ``stat``: a directory that exists and cannot be written to is the case a path check misses.
    """
    from athena.core.brain import paths
    from athena.core.brain.store import Brain

    target = paths.brain_root(root)
    try:
        brain = Brain(target)
    except Exception as exc:
        return Stage("brain", "fail", f"{target}: {type(exc).__name__}: {exc}"), None
    counts = json.dumps(brain.counts(), sort_keys=True)
    return Stage("brain", "ok", f"{brain.root} ({counts})"), brain


def _index_stage(brain: Any) -> Stage:
    """Is the index consistent with the tree, and can it be rebuilt from it?

    A row whose markdown is gone is a ``warn`` and not a ``fail``: disk is truth, the index is
    derivable, and ``athena brain reconcile`` is the fix. Athena runs meanwhile.
    """
    from athena.core.brain import reconcile

    missing = reconcile.missing_files(brain)
    if missing:
        return Stage(
            "index",
            "warn",
            f"{len(missing)} indexed row(s) have no file; run `athena brain reconcile`",
        )
    return Stage("index", "ok", "every indexed row has its file on disk")


def _constitution_stage() -> Stage:
    """Where the law was found, and which copy it is (ADR 0006).

    A ``fail``: a turn with no law is a turn that should not have started, so the doctor says so
    with the exit code and not only in a sentence.
    """
    from athena.core import constitution

    try:
        law = constitution.load()
    except constitution.ConstitutionMissing as exc:
        return Stage("constitution", "fail", str(exc).split(". ")[0])
    return Stage("constitution", "ok", f"{law.source.kind}: {law.directory} v{law.version}")


def _engine_stage(engine: str, home: Path | None = None) -> Stage:
    """Can this machine run a turn on the named engine?

    A ``warn`` when it cannot. The brain, the gate, the approval table and every read route work
    without an engine; what does not work is a turn, and the detail says what to install. A
    ``doctor`` that exited non-zero because a CLI is missing would be a doctor whose exit code
    means "something is not perfect", which is a thing nobody can act on.
    """
    from athena.harness.engines import probe

    status = probe(engine, home=home)
    if not status.available:
        return Stage("engine", "warn", f"{engine}: {status.detail}")
    if status.logged_in is False:
        return Stage("engine", "warn", f"{engine} {status.version}, but no credential was found")
    return Stage("engine", "ok", f"{engine}: {status.detail}")


def _port_stage(port: int) -> Stage:
    """Is the daemon's default port free?

    A ``warn`` either way it goes, because a port already in use usually means *your own daemon is
    already running* — the healthy case — and a sidecar passes ``--port 0`` regardless.
    """
    import socket

    from athena.daemon.server import DEFAULT_HOST

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind((DEFAULT_HOST, port))
        except OSError as exc:
            return Stage(
                "port",
                "warn",
                f"{DEFAULT_HOST}:{port} is taken ({exc.strerror or exc}); a daemon may already "
                "be running, and `--port 0` lets the kernel pick a free one",
            )
    return Stage("port", "ok", f"{DEFAULT_HOST}:{port} is free")


def doctor_stages(
    *,
    brain_root: str | Path | None = None,
    engine: str = "claude_code",
    port: int | None = None,
    home: Path | None = None,
) -> list[Stage]:
    """Every stage, in :data:`DOCTOR_STAGES` order.

    A brain that will not open short-circuits the index stage — there is nothing to check — but
    every other stage still runs, because a person fixing an install wants the whole picture and
    not the first thing that went wrong.
    """
    from athena.daemon.server import DEFAULT_PORT

    stages = [_python_stage()]
    brain_stage, brain = _brain_stage(brain_root)
    stages.append(brain_stage)
    if brain is None:
        stages.append(Stage("index", "skip", "there is no brain to check the index of"))
    else:
        try:
            stages.append(_index_stage(brain))
        finally:
            brain.close()
    stages.append(_constitution_stage())
    stages.append(_engine_stage(engine, home))
    stages.append(_port_stage(DEFAULT_PORT if port is None else port))
    return stages


def doctor_report(stages: list[Stage]) -> dict[str, Any]:
    """The stages as one JSON object, with the first non-OK stage named as the cause."""
    cause = next((stage for stage in stages if stage.status != "ok"), None)
    return {
        "ok": all(stage.ok for stage in stages),
        "stages": [stage.as_dict() for stage in stages],
        "cause": None if cause is None else cause.name,
    }


# --- the commands ---------------------------------------------------------------------------


def _emit(payload: dict[str, Any]) -> None:
    json.dump(payload, sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")
    sys.stdout.flush()


def cmd_doctor(args: argparse.Namespace) -> int:
    """Report the stages. Non-zero only if one of them failed."""
    stages = doctor_stages(brain_root=args.brain, engine=args.engine)
    report = doctor_report(stages)
    _emit(report)
    return 0 if report["ok"] else 1


def cmd_reconcile(args: argparse.Namespace) -> int:
    """Rebuild the index from the markdown tree (README §2 invariant 1; ADR 0003)."""
    from athena.core.brain import reconcile
    from athena.core.brain.store import Brain

    with Brain(args.brain, session_id="cli") as brain:
        stats = reconcile.reconcile_from_disk(brain)
        _emit(
            {
                "ok": not stats.skipped,
                "brain": str(brain.root),
                **stats.as_dict(),
                "summary": stats.summary(),
                "missing": reconcile.missing_files(brain),
            }
        )
    return 0


# --- the parser ---------------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    """The top-level parser. ``serve`` is listed here but parsed by the daemon itself."""
    from athena.harness.engines import ENGINES

    parser = argparse.ArgumentParser(prog="athena", description=__doc__.splitlines()[0])
    parser.add_argument("--version", action="version", version=f"athena-portable {__version__}")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser(
        "serve",
        help="run the local daemon on 127.0.0.1 (its own flags; try `athena serve --help`)",
        add_help=False,
    )

    doctor = sub.add_parser(
        "doctor", help="report health stages; the first non-OK stage is the cause"
    )
    doctor.add_argument("--brain", default=None, help="the brain directory (default: $ATHENA_HOME)")
    doctor.add_argument("--engine", default="claude_code", choices=ENGINES, help="which engine")
    doctor.set_defaults(func=cmd_doctor)

    brain = sub.add_parser("brain", help="read and write the brain on disk")
    brain_sub = brain.add_subparsers(dest="brain_command")
    rebuild = brain_sub.add_parser(
        "reconcile", help="rebuild index.sqlite from the markdown tree (ADR 0003)"
    )
    rebuild.add_argument(
        "--brain", default=None, help="the brain directory (default: $ATHENA_HOME)"
    )
    rebuild.set_defaults(func=cmd_reconcile)
    brain.set_defaults(parser=brain)

    return parser


def main(argv: list[str] | None = None) -> int:
    """The console script. ``athena serve ...`` is handed to the daemon's own parser untouched."""
    args = list(sys.argv[1:] if argv is None else argv)
    if args and args[0] == "serve":
        from athena.daemon.server import serve

        return serve(args[1:])

    parser = build_parser()
    parsed = parser.parse_args(args)
    handler = getattr(parsed, "func", None)
    if handler is None:
        # A bare ``athena``, or ``athena brain`` with no verb: print the help of whichever level
        # the caller actually reached rather than the top one, which would hide the verb list.
        getattr(parsed, "parser", parser).print_help()
        return 0
    return int(handler(parsed))


if __name__ == "__main__":  # pragma: no cover - exercised through the console script
    raise SystemExit(main())
