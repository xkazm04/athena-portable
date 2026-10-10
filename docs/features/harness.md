# Harness: engines, the round loop, the OP grammar, hooks and policy

`src/athena/harness/`. The harness runs one turn on an engine and puts every tool call through the
gate.

## Engines

Engines are configuration, not code paths (ADR 0007). All three share one round loop
(`harness/rounds.py`): up to eight provider rounds make one turn and one ledger row. The row is written on every exit, a raise and a closed stream included. A ledger write that fails is retried once, and the turn still ends with `turn.error`.

| Engine | How it runs | Use |
|---|---|---|
| `claude_code` | the person's signed-in `claude` CLI through a `Transport`, `--resume` between turns | daily use, the bench |
| `codex` | the person's signed-in `codex` CLI | daily use |
| `nebius` | NVIDIA Nemotron on Nebius Token Factory, stdlib `urllib`, one non-streamed request per round (ADR 0031) | testing and measuring Athena; reasoning on by default, `--no-nebius-thinking` turns it off (ADR 0035) |

`GET /engines` reports which engines the machine can run; the `nebius` probe only checks that
`NEBIUS_API_KEY` exists. Model ids and prices for Nemotron come from Token Factory's live catalog.

## The round loop

- Each round's text is parsed for `OP:` lines; each op is dispatched through the hooks.
- A refused op (wrong origin, unknown name, switched-off app) and a dropped op (bad envelope) are
  told to the model in the same turn, once per reason, with the calls already in flight named, so
  she never promises a result that cannot come (ADR 0041).
- Call ids carry their round, so a core result in one round never answers a page call in another.
- Host tools have no executor here: the gate allows them, the lane emits `tool.call`, and the
  page's answer comes back fenced in the next request.

## The OP grammar

A CLI engine has no tool-call API, so Athena is taught one line format:

```
OP: {"op":"propose_action","action":"host.invoices.mark_paid","params":{"id":7},"rationale":"..."}
```

`harness/op_grammar.py` repairs only what has exactly one reading, records each repair on the op,
and refuses the rest with the one shape that works. The repairs are a closed list of six:
a trailing comma, an unquoted key, missing closing braces, the tool named in `op` (ADR 0046), the
tool named in `name` or `tool`, and parameters written outside `params` (ADR 0050). The repaired
name must still be in the catalog.

## Hooks

`harness/hooks.py`: `PolicyHook` (structural policy) in front of `GateHook` (validator before
class; a replay proves the grant), `LedgerHook` (one row per invocation) and `TruncationHook`
(block sizes). The gate is the policy (invariant 3): a model never decides whether something is
gated.

## Structural policy

`harness/policy.py`: a per-lane allow-list; an origin must be enabled; a turn is pinned to one
origin (`origin_pinning`), and the refusal tells her to use `core.recall` for what she read in
another tab or ask the person to switch; a `connector:` call is allowed only while the vault says
the connection is live; an app the person switched off is refused (`foreign_origin`).
