"""The law and the identity, loaded from wherever Athena was installed (README §3.2 step 2).

Two markdown files make the part of the prompt that never moves:

    constitution/law.md       what Athena may do and how she refuses — never edited by a model
    constitution/identity.md  who she is to this user, and how she works with them

They live in one directory and Athena may be running from one of three shapes, so the loader has
one candidate per shape and takes the first that carries a ``law.md``:

1. an **explicit** argument or ``$ATHENA_CONSTITUTION`` — an instruction, and then the only
   candidate, because a deployment that named a directory does not want a silent fallback;
2. a **frozen bundle** — PyInstaller's extraction directory, most specific because a one-file
   binary carries its own law and must never read a sibling's;
3. the **package** copy at ``athena/constitution/``, which is how a wheel ships it (ADR 0006);
4. a **marker-guarded checkout** — the repository's own ``constitution/``, and only when a
   ``.athena-constitution`` file sits beside it.

That last guard is the point of this module. The repository root is three parents above this
file, and for an installed wheel or a frozen binary those three parents are ``site-packages/..``
or a temporary extraction directory — places anything at all may be sitting. A bare directory
that merely *contains* a ``constitution/`` is refused; only one that declares itself Athena's
source is read. Law that an attacker can drop into a temp directory is not law.

The version is a content hash per section: a change nothing reads is a change that did not ship.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from athena.contracts.harness import PromptBlock, fnv1a_64

__all__ = [
    "BLOCK_NAMES",
    "DIRNAME",
    "ENV_VAR",
    "MARKER",
    "REQUIRED_SECTION",
    "SECTIONS",
    "Constitution",
    "ConstitutionMissing",
    "Source",
    "is_marked_checkout",
    "load",
    "load_or_empty",
    "search_path",
]

#: The section files, in the order they are composed. ``law`` is mandatory; a deployment may drop
#: ``identity`` without editing code, and the composer renders an empty identity honestly.
SECTIONS: tuple[str, ...] = ("law", "identity")
REQUIRED_SECTION = "law"

#: The prompt block each section becomes. The names are the composer's, and the ledger's.
BLOCK_NAMES: Mapping[str, str] = {"law": "constitution", "identity": "identity"}

#: The directory name, identical in all four places it can live.
DIRNAME = "constitution"

#: The file that tells the loader a tree is Athena's own source checkout. It sits *beside*
#: ``constitution/``, not inside it, so that copying a ``constitution/`` somewhere else does not
#: copy the permission to be read from there.
MARKER = ".athena-constitution"

ENV_VAR = "ATHENA_CONSTITUTION"

SourceKind = Literal["explicit", "environment", "frozen", "package", "checkout"]


class ConstitutionMissing(FileNotFoundError):
    """No constitution could be resolved. Athena runs without law only on purpose, never by
    accident, so this is raised rather than defaulted — see :func:`load_or_empty` for the doctor's
    non-raising view."""


@dataclass(frozen=True)
class Source:
    """One place the constitution may live, and how it earned the right to be read."""

    kind: SourceKind
    directory: Path

    @property
    def complete(self) -> bool:
        """``True`` when this directory really carries a law. The other sections are optional."""
        return (self.directory / f"{REQUIRED_SECTION}.md").is_file()


# --- where Athena might be running from -------------------------------------------------------


def _package_root() -> Path:
    """``athena/`` — a wheel carries ``athena/constitution/`` (ADR 0006)."""
    return Path(__file__).resolve().parents[1]


def _frozen_root() -> Path | None:
    """PyInstaller's extraction directory, or ``None`` when this is not a frozen binary."""
    if not getattr(sys, "frozen", False):
        return None
    base = getattr(sys, "_MEIPASS", None)
    return Path(str(base)) if base else Path(sys.executable).resolve().parent


def _checkout_root() -> Path:
    """Three parents above this file: this repository, in a source checkout — and something else
    entirely anywhere else, which is why :func:`is_marked_checkout` guards it."""
    return Path(__file__).resolve().parents[3]


def is_marked_checkout(root: Path) -> bool:
    """``True`` only for a tree that declares itself Athena's source.

    A directory that merely contains a ``constitution/`` is not one. The marker is a file beside
    the directory, so the answer cannot be produced by copying the directory alone.
    """
    return (root / MARKER).is_file() and (root / DIRNAME).is_dir()


def search_path(
    explicit: str | Path | None = None,
    *,
    environ: Mapping[str, str] | None = None,
    frozen_root: Path | None = None,
    package_root: Path | None = None,
    checkout_root: Path | None = None,
) -> list[Source]:
    """Every directory that may hold the constitution, most specific first.

    Every default is overridable by keyword so a test can build a real installation under
    ``tmp_path`` and exercise the real resolution, rather than patching module state and
    exercising the patch.
    """
    if explicit is not None:
        return [Source("explicit", Path(explicit).expanduser())]
    env = (os.environ if environ is None else environ).get(ENV_VAR, "").strip()
    if env:
        return [Source("environment", Path(env).expanduser())]

    frozen = _frozen_root() if frozen_root is None else frozen_root
    package = _package_root() if package_root is None else package_root
    checkout = _checkout_root() if checkout_root is None else checkout_root

    found: list[Source] = []
    if frozen is not None:
        found.append(Source("frozen", frozen / DIRNAME))
    found.append(Source("package", package / DIRNAME))
    if is_marked_checkout(checkout):
        found.append(Source("checkout", checkout / DIRNAME))
    return found


# --- what was loaded --------------------------------------------------------------------------


@dataclass(frozen=True)
class Constitution:
    """The law and identity text, with the hash of each section and where it came from."""

    source: Source
    sections: Mapping[str, str]

    @property
    def directory(self) -> Path:
        return self.source.directory

    def section(self, name: str) -> str:
        return self.sections.get(name, "").strip()

    def hashes(self) -> dict[str, str]:
        """One content hash per section present. What the ledger records, and what tells a
        deployment that its law is the law it thinks it is."""
        return {name: fnv1a_64(self.sections[name]) for name in SECTIONS if name in self.sections}

    @property
    def version(self) -> str:
        """One hash over every section in fixed order — the delivery mechanism for a change."""
        joined = "\n".join(f"{name}\n{self.sections.get(name, '')}" for name in SECTIONS)
        return fnv1a_64(joined)

    def block(self, name: str) -> PromptBlock:
        """One section as a prompt block. Never fenced and never bounded: this is Athena's own
        text, it is whole or it is a bug, and a fence around it would make its hash move every
        turn (ADR 0006)."""
        body = self.section(name) or f"(no {name} on file)"
        return PromptBlock(name=BLOCK_NAMES.get(name, name), text=f"{body}\n")

    def blocks(self) -> list[PromptBlock]:
        return [self.block(name) for name in SECTIONS]


def _read(source: Source) -> Constitution:
    sections: dict[str, str] = {}
    for name in SECTIONS:
        path = source.directory / f"{name}.md"
        if path.is_file():
            sections[name] = path.read_text(encoding="utf-8")
    return Constitution(source=source, sections=sections)


def load(
    explicit: str | Path | None = None,
    *,
    environ: Mapping[str, str] | None = None,
    frozen_root: Path | None = None,
    package_root: Path | None = None,
    checkout_root: Path | None = None,
) -> Constitution:
    """Load the constitution from the first candidate that carries a ``law.md``.

    Raises :class:`ConstitutionMissing` naming every place that was looked in, so an installation
    that shipped without its law says which copy is absent rather than composing an empty prompt.
    """
    candidates = search_path(
        explicit,
        environ=environ,
        frozen_root=frozen_root,
        package_root=package_root,
        checkout_root=checkout_root,
    )
    for candidate in candidates:
        if candidate.complete:
            return _read(candidate)
    looked = ", ".join(f"{c.kind}: {c.directory}" for c in candidates) or "(nowhere)"
    raise ConstitutionMissing(
        f"no {REQUIRED_SECTION}.md in any candidate directory (looked in: {looked}). An installed "
        f"Athena reads the copy shipped at athena/{DIRNAME}/; if that is missing the distribution "
        f"was built without it. A checkout is read only when a {MARKER} file sits beside its "
        f"{DIRNAME}/. Otherwise set ${ENV_VAR}."
    )


def load_or_empty(
    explicit: str | Path | None = None,
    *,
    environ: Mapping[str, str] | None = None,
    frozen_root: Path | None = None,
    package_root: Path | None = None,
    checkout_root: Path | None = None,
) -> Constitution:
    """For the doctor and for fixtures: never raises, reports an empty constitution instead.

    The composer does not use this. A turn with no law is a turn that should not have started.
    """
    try:
        return load(
            explicit,
            environ=environ,
            frozen_root=frozen_root,
            package_root=package_root,
            checkout_root=checkout_root,
        )
    except ConstitutionMissing:
        candidates = search_path(
            explicit,
            environ=environ,
            frozen_root=frozen_root,
            package_root=package_root,
            checkout_root=checkout_root,
        )
        missing = candidates[-1] if candidates else Source("package", _package_root() / DIRNAME)
        return Constitution(source=missing, sections={})
