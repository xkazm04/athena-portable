# 0202. An Atlas edge names how it is carried, and the tree is asked

Date: 2026-10-25

## Context

Atlas (`examples/atlas`) holds one content rule: every entry cites its source, and
`test/data.test.ts` holds the cited files to the tree. Edges escaped that rule. An edge was
`{from, to, kind, note}`, so whether `cmp-hooks -> cmp-catalog` was an import, a Protocol the
composition root binds, or an HTTP hop was unstated and unchecked. Scraping the imports of the
modelled `src/athena` modules showed 26 of 70 Python-to-Python edges with no import behind them.
Most were ports (the harness never imports a core service, README §3.1), which the model hid. Some
were carried by one named intermediate module (the daemon object, a base class, a re-export). Four
had nothing in the tree at all. And `model.test.ts` asserted "no edge runs back up the stack"
against the model's own list while `src/athena/daemon/server.py` imports `athena.wiring` locally, a
channels-to-surfaces import.

## Decision

1. **Every edge says what carries it.** `Edge.via` is `import`, `port` or `wire`. A port edge names
   its port module in `through`; a wire edge names its protocol (HTTP, SSE, Tauri IPC, the bridge
   protocol, WebMCP). An import edge may name one intermediate module in `through`. That is a
   checked claim, not a hedge: the from-file imports it, and it imports the to-file.
2. **A port is checked where it is bound.** The from-file imports the port, or declares it itself
   (`core/prompt.py`'s `CatalogPort` and `RecallPort`, `harness/hooks.py`'s `GateHook`,
   `harness/policy.py`'s `ConnectorStatePort`, `harness/cli_harness.py`'s `CliDialect`). Then
   `src/athena/wiring.py` imports the module behind it. An edge that points at the port itself (a
   structural implementer) is bound the other way: the root imports the implementer. So
   `cmp-prompt -> cmp-catalog` stays drawn as the model reads it, and is a port through
   `core/prompt.py`. It is not reversed, even though `core/catalog.py` imports `core.prompt` for
   `BUDGETS`.
3. **The tree is asked, and what it cannot answer is counted.** `test/source-imports.ts`
   pattern-scrapes Python source (no Python run). `test/edges.test.ts` reports checked, failed and
   skipped-with-reason, and checked plus skipped is every edge. A Rust, JS, TS or Markdown end, a
   directory, a planned module or a wire is skipped with that reason, never counted clean.
4. **An up edge is declared, never discovered.** `up: true` marks the one up edge
   (`cmp-daemon-server -> cmp-wiring`). `model.test.ts` holds that the up edges are exactly the
   declared ones. `edges.test.ts` holds that every import of a higher layer the tree holds is one
   of them.
5. **Edges the tree does not carry are removed, not annotated.** `daemon-sessions -> catalog`,
   `daemon-connectors -> conn-service`, `op-grammar -> c-registry` and `fence -> ids` are removed:
   the from-module imports nothing of the other, directly or through any named module. The spoken
   yes was drawn from `voice-commands`, which only recognises the word. It is now drawn from
   `voice-gateway`, which resolves the decision on the daemon's approval table.

## Consequences

- A drawn arrow between two Python modules is a checked claim. An edge with no import behind it,
  a port whose consumer never reaches it, or an undeclared up-stack import turns a test red and
  names the edge.
- The ports architecture is now data. A later pane or read tool can print "through
  `harness/ports.py`" instead of a bare arrow.
- The edge count goes from 123 to 120: four edges removed, one up edge added, one re-pointed.
  The prose count in `DESIGN.md` ("120 edges") happens to be right again. The other prose counts
  were already stale and are not edited here.
- The non-Python half (Rust, the TS apps, the bridge) is still unchecked. It is skipped by name,
  so the gap is a printed number, not a silence.
