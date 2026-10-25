# 0207. A manifest flag is read by its type, and an omitted side effect is refused

Date: 2026-10-25

Tightens ADR 0004 at the parser. Registry: authorization (failure-direction),
invariant-placement (repairing-check-erases-its-evidence).

## Context

ADR 0004 decides a tool is `AUTO` only when `reversible` is exactly `True` and its `side_effects`
are not `external`. `src/athena/contracts/manifest.py` refuses an omitted `reversible` for that
reason: an omission read permissively is a tool that executes without a card. The wire reader,
`HostManifest.from_dict`, broke the rule twice before `validate()` ever saw the manifest:

- `reversible=None if raw is None else bool(raw)`: `"reversible": "false"` became `True`, so a
  corrupt flag resolved MORE permissive than an absent one (absent: `GATED` and refused;
  `"false"`: `AUTO` and accepted).
- An absent `side_effects` became `"internal"`, so a tool that said nothing about its reach was
  `AUTO`.

It also raised `AttributeError` on a `tools` that was not a list of objects and `TypeError` on a
readable schema that was not an object, and took a readable's `max_chars` as given, so `"lots"`
satisfied "bounded at the source". The bridge's half of the same rule (`packages/athena-bridge/
gate.js`) already reads flags only when they are booleans and otherwise falls to
irreversible/external; the Python and JavaScript halves disagreed on exactly the inputs that
matter. The shell's bridge always sends booleans, so no page exploits it today; what reaches
`from_dict` without the bridge (another surface's POST, a connector spec) has no such protection.

## Decision

1. **The wire reader reads each gate-relevant field by its JSON type and never coerces.**
   `reversible` is kept only when it is a boolean; anything else is `None` plus the problem
   `tool 'x': reversible must be true or false`. A non-string `side_effects` is a problem too.
2. **An omitted `side_effects` is refused, like an omitted `reversible`**
   (`tool 'x' must declare side_effects`).
3. **A refused field resolves to its strict reading**: `reversible` unknown, `side_effects`
   `external` (what `gate.js` gives the same input), and `default_class()` is `GATED` for any tool
   with a parse problem. Corrupt input can never class a tool looser than absent input.
4. **Shape errors are named problems, not exceptions.** `tools` and `state_readables` must be lists
   of objects, a readable's `schema` an object, `max_chars`/`max_items` positive integers (a
   boolean is not one). The problems live in a private `_parse_problems` list (not compared, not
   in the repr) on the manifest and on each tool, and `validate()` returns them first, so the
   manifest is refused whole with the rest of its problems.
5. **Only the wire reader tightens.** A `HostTool` built in code keeps its dataclass defaults
   (`side_effects="internal"`), so the hands, the MCP annotations and every test that constructs
   tools directly are unchanged. The daemon's and the spec loader's `except` clauses stay as a
   belt; they no longer fire for these shapes.

## Consequences

- A page or connector that omits `side_effects` is refused at merge and at spec load. The builtin
  specs, the proving manifests and the shipped apps' bridge already declare it on every tool.
- A refused manifest names the tool and field instead of a Python exception name.
- One daemon test fixture that omitted `side_effects` now declares it.
