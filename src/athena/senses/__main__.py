"""``python -m athena.senses build|prove|status [<playbook> ...] [--segmenter B] [--transcriber B]
[--reader B]`` - build a featured chore's sensed tables, prove them, or list featured status.

With no playbook ids, ``status`` lists every playbook carrying a ``featured`` block.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from athena.senses.build import SenseError, build, featured_status, prove
from athena.senses.contract import BACKENDS, Backend

LIBRARY = Path(__file__).resolve().parents[3] / "playbooks"


def featured_ids(library: Path) -> list[str]:
    out: list[str] = []
    for path in sorted(library.glob("*/playbook.json")):
        if "featured" in json.loads(path.read_text(encoding="utf-8")):
            out.append(path.parent.name)
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m athena.senses")
    parser.add_argument("command", choices=("build", "prove", "status"))
    parser.add_argument("playbooks", nargs="*")
    parser.add_argument("--library", type=Path, default=LIBRARY)
    for role in ("segmenter", "transcriber", "reader"):
        parser.add_argument(f"--{role}", choices=BACKENDS)
    args = parser.parse_args(argv)
    overrides: dict[str, Backend] = {
        role: getattr(args, role)
        for role in ("segmenter", "transcriber", "reader")
        if getattr(args, role)
    }
    ids = args.playbooks or featured_ids(args.library)
    code = 0
    for pid in ids:
        root = args.library / pid
        try:
            if args.command == "build":
                out = build(root, overrides)
                rows = {t: len(r) for t, r in out.tables.items()}
                print(f"{pid}: built {rows}, {len(out.calls)} calls, {len(out.asked)} asked")
            elif args.command == "prove":
                results = prove(root, overrides)
                for r in results:
                    mark = "pass" if r.passed else "FAIL"
                    shown: Any = "-" if r.measured is None else round(r.measured, 4)
                    print(f"{pid} {r.id:<3} {mark} {shown} {r.op} {r.bar} (n={r.n}) {r.question}")
                code = code or (0 if results and all(r.passed for r in results) else 1)
            else:
                print(f"{pid}: {featured_status(root)}")
        except (SenseError, NotImplementedError, OSError) as exc:
            print(f"{pid}: {type(exc).__name__}: {exc}", file=sys.stderr)
            code = 2
    return code


if __name__ == "__main__":
    raise SystemExit(main())
