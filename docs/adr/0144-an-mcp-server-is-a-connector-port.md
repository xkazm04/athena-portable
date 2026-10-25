# 0144. An MCP server is a connector port

Date: 2026-10-24

Builds on [0004](0004-the-gate-is-the-policy.md) (the class is derived from the flags),
[0021](0021-connectors-are-data-behind-one-vault-and-enter-the-catalog-like-a-page.md)
(connectors under `connector:<id>`, policy rule 4) and
[0063](0063-a-page-is-gated-on-first-sight-and-the-users-pins-reach-the-gate.md) (first-sight
gating). README section 4.

## Context

Athena should be able to use a service that already speaks MCP (Gravitone's `POST /api/mcp`, four
tools `gt_read`, `gt_launch`, `gt_job`, `gt_spend`) without a spec and a provider module written
for it in this repository. The catalog already has a seam for tools executed in the daemon's
process: `ConnectorPort` (`list_tools`, `call`), merged with `Catalog.merge_connector` under
`connector:<id>`. What an MCP server adds is a way to list its tools, a way to call them, and a
class for each tool that MCP states as annotations rather than as `reversible` and `side_effects`.

## Decision

**Configuration.** `ATHENA_HOME/mcp.json` (or `athena serve --mcp-config <path>`) lists servers:
`{"servers": [{"id", "url", "token_env"}]}`. `id` matches `^[a-z][a-z0-9_-]{0,31}$` and may not
be a built-in connector's id; `url` is `https`, or `http` only on `localhost`, `127.0.0.1` or
`[::1]`, with no credentials in it; `token_env` names an environment variable read at each request.
Any other key is refused, so a pasted token is never accepted as configuration. An absent default
file is no servers; a present, wrong one (or a named one that is absent) stops `athena serve` on
its failure line, naming the field and never its value.

**No new origin kind.** Each server is an `McpService`, a `ConnectorPort`, merged as
`connector:<id>`; its tools are `connector.<id>.<tool>`. The registry's origin kinds stay `core`,
`host` and `connector`: everything that reads an origin (rule 2's switch, rule 4, the ledger, the
panel) already handles `connector:`, and a fourth kind would have to be taught to every one of them
for no difference in what the gate does.

**The class mapping.** The annotations become the two manifest flags and the catalog derives the
class from those, as for any page or connector:

| annotations | flags | class |
| --- | --- | --- |
| `readOnlyHint: true` | reversible, `none` | AUTO |
| `readOnlyHint` false or absent, `destructiveHint: false` and `openWorldHint: false` | reversible, `internal` | AUTO |
| `destructiveHint: true`, `openWorldHint: true`, either absent, or no annotations | irreversible, `external` | GATED |

Only JSON booleans count. MCP's own defaults (`destructiveHint` and `openWorldHint` true) are the
fail-closed ones, so an omitted hint reads as the dangerous answer. `idempotentHint` never loosens.
`readOnlyHint: true` wins over the other two: MCP says `destructiveHint` means nothing for a
read-only tool, and an open-world read changes nothing either. A family tool whose ops are mixed
carries the most severe of its ops' annotations (Gravitone's do), so it is classed by its worst op.

**Liveness.** Rule 4 asks `ConnectorStates`: each MCP server answers for its own id alone (live
while its token variable is set), and every other id goes to the vault exactly as before. The
wrapper is installed whenever an MCP server is configured, with or without `--no-connectors`; no
owner can answer for a vault connector's id.

**Listing.** Tools are listed at daemon start (initialize, `notifications/initialized`,
`tools/list`). A server that was unreachable, refused, or whose listing the catalog refused holds
no tools, and is listed again when a turn starts, inside the writer lock, at most once every 30 s;
a server holding tools is not listed again (Athena asks for no `listChanged`). A listing the
catalog refuses (a tool name with a dot, an array without `maxItems`) is refused whole, as a page's
manifest is.

**Results and errors.** A call's result reaches the model as the server's `structuredContent` as
JSON, or its text content when there is none, capped at the connector cap (1,600) with `(showing N
of M)`, inside the nonce fence labelled with the server id. `isError: true` is a failed result
carrying that fenced text. A failure to get an answer (unreachable, non-2xx, a JSON-RPC error) is
`engine_error` naming the server id and the HTTP status; a JSON-RPC error's own message is foreign
text and is fenced after the sentence. `GET /connectors` lists the servers under `mcp_servers` with
health `unknown` (not yet reached, or no token), `healthy` (it answered) or `broken` (with the
reason). This health is the server's state, not a verdict on a credential in the sense of ADR 0108.

**The token** is read at each request and goes only into the `Authorization` header. Every error
sentence, log record and view is passed through `redact` with it; the view says the variable's name
and whether it is set. No redirect is followed (the vault's transport), replies are capped at
1 MiB, every request times out at 20 s.

**First sight.** ADR 0063's first-sight `GATED` is about host origins (a page the person has not
trusted yet) and does not apply to connector origins. An MCP server's `AUTO` tools run without a
card from the first turn. The trust decision is the configuration itself: a person who writes a
server into `mcp.json` and sets its token has connected it, as pasting a token connects a vault
connector.

## Consequences

- With Gravitone's default projection, `gt_read` and `gt_spend` are `AUTO`; `gt_job` is `GATED`
  (its `cancel` op is destructive); and `gt_launch` is `GATED` too, because its family carries
  `openWorldHint: true` from its launch ops and `destructiveHint: true` from one op. A
  per-operation projection (`GRAVITONE_MCP_PROJECTION=operation`) would class each op on its own.
- A server's own hints decide `AUTO`, as a page's flags do. A server that marks a delete
  `readOnlyHint: true` runs it without a card; switching the origin off (rule 2) or removing it
  from `mcp.json` is the remedy, and a per-server first-sight rule is a later decision.
- A write whose call timed out is `engine_error`, not ADR 0101's `outcome_unknown`; that is a
  follow-up for when an MCP server's writes matter.
- No vault writes switch or egress allow-list applies to MCP tools: a `GATED` call is a card, and
  the card is the only stop.
