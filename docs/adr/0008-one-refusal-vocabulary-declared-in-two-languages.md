# 0008. One refusal vocabulary and one fence, declared in two languages and pinned by a test

Date: 2026-09-12

## Context

README §2 invariant 6 says every failure is one ledger row with a reason from a closed set, and
`ERROR_REASONS` (`src/athena/contracts/harness.py`) is that set. Invariant 4 says every truncated
block announces `(showing N of M)`. `athena.core.fence` says text the page wrote reaches a prompt
only inside a nonce-tagged fence it cannot close from the inside.

All three rules have to hold on the surface, and the surface is JavaScript. The panel refuses a
call when an origin has spent its budget; it renders what a host tool returned into a prompt
block; it bounds a tool list before it shows it. None of that runs in Python, and there is no
import between the two.

Three ways out, and two of them are worse. Route every refusal through the daemon so only Python
names one: the surface then cannot refuse a call it has not made yet, which is exactly what a
budget is, and a refusal that needs a round trip is a spinner. Generate the JavaScript from the
Python at build time: a generator, a build step and a generated file in review, for one array of
fourteen strings and two sentences. Or declare it twice and make the drift fail a test.

Drift is the real risk, and it is silent. A new member added to `ERROR_REASONS` for a good reason
is a reason the panel cannot name, so it writes something close but not equal; the ledger stores
`unknown` and a reader groups by a column that no longer says why. A preamble reworded on one side
is a fence that still looks right in both files and no longer means the same thing to the model.
Neither of those breaks any test that exists.

## Decision

**The vocabulary and the fence's constants are declared once per language, and
`tests/test_refusal_parity.py` asserts they are the same.** `packages/athena-bridge/gate.js`
exports `REFUSAL_REASONS` frozen, in the Python's order, and `PREAMBLE`, `REDACTION`,
`DEFAULT_LABEL` and `NONCE_BYTES` as `athena.core.fence` writes them. The Python is the authority
in every case; the JavaScript is the port.

**The parity test reads the JavaScript as text; it does not execute it.** The Python gate runs in
CI without node — `uv run pytest` is a job of its own — and a test that needs a second toolchain
to compare a list of strings is a test that gets skipped on the machine that most needed it. The
test strips `//` comments and reads the string literals out of each `export const`.

**What the constants assemble into is pinned by one written-out literal that appears in both
files.** `tests/test_refusal_parity.py` asserts `wrap_untrusted("hi", nonce=…)` equals it and
`test/gate.test.js` asserts `fence("hi", …)` equals it. Comparing the constants alone would miss a
reordered fence; comparing only the output would not say which constant moved.

**`classify` is the same kind of port** — `HostTool.default_class` in twelve characters of
JavaScript — and is covered by its four flag combinations on both sides rather than by textual
parity, because a rule is not a string.

## Consequences

Adding a refusal reason is now a two-file change with a test that says so, which is the intended
friction: `ERROR_REASONS` is a low-cardinality ledger column and a new member should be a decision,
not a string typed at a call site. Rewording the fence preamble is the same.

The parity test knows how `gate.js` is written: it expects double-quoted literals and
`export const NAME = …;`. A refactor that moved the vocabulary into an object, or switched the file
to single quotes, would fail it with a confusing message. That is a shallow cost — the failure is
loud and lands in the file that changed — and the alternative was a generator.

`inject.js` is not covered by this test and does not import `gate.js`: it runs in the page's world
with no module loader, and it mints exactly one reason, `"timeout"`, which
`test/gate.test.js` asserts is a member of the vocabulary. One literal in a file that cannot import
is the smallest hole available, and it is guarded from the other side.
