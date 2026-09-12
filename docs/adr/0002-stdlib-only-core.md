# 0002. The core is stdlib-only and the contracts import nothing at all

Date: 2026-09-12

## Context

README §2 invariant 5 says no provider is mandatory, and invariant 1 says a brain is portable by
copying its directory. Both are claims about what a machine needs in order to read Athena's
memory. CPython already ships `sqlite3` with FTS5, so the memory engine — markdown on disk, SQLite
as a rebuildable index — needs nothing installed.

The pressure runs the other way, though. `src/athena/contracts/` is the seam five packages are
written against in parallel, and the cheapest way to make a dataclass validate itself is to import
a schema library. One such import in `contracts/` is an import in every package, and the invariant
is gone before the first engine exists.

## Decision

`athena.contracts` imports only the standard library, and only modules that cannot fail to import:
`dataclasses`, `enum`, `typing`, `json`, `re`, `secrets`, `datetime`. No I/O at import time, no
provider, no transport. `athena.core` holds to the same rule.

Everything that talks to a model, a transport or a cloud is an optional dependency, imported
lazily inside the package that needs it, behind an error that names the extra to install. The
`dev` extra is tooling and nothing under `src/` imports it.

Validation is therefore hand-written: `HostManifest.validate()` returns a list of problems and the
caller refuses the manifest whole. That is more code than a schema decorator and it is the code we
want, because the refusals are the product — a tool that never declared `reversible` is refused by
name, not by a generic "does not match schema".

## Consequences

A brain can be read, written and reconciled on a machine with only Python, and `uv sync` with no
extras installs nothing. The contracts package is importable from a test, a script, or the frozen
sidecar with no environment at all, which is what makes the gate fast.

The cost is manual validation in `manifest.py` and manual serialization in `channel.py`, both of
which have to stay covered by tests — `tests/contracts/` is that cover. When a package genuinely
needs a third-party library it declares an extra and imports it inside the function that uses it;
if that import ever appears at the top of a module under `core/` or `contracts/`, this ADR is the
thing it contradicts.
