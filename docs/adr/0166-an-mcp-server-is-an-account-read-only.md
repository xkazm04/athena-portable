# 0166. An MCP server is an account in Accounts, read only

Date: 2026-10-25

Builds on ADR 0144 (an MCP server is a connector port), 0021 (connectors), 0090 (the Accounts
depth) and 0095 (the first frame). Governing standards: connector-catalog (adapter-normalization:
one internal view over two providers) and mcp-tools (client-integration: a tool's class is the
host's, never re-derived by a surface).

## Context

Since ADR 0144 a server written into `mcp.json` is a connector: its `AUTO` tools run without a
card from the first turn, and `GET /connectors` lists it under `mcp_servers` with its URL, the
name of its token variable and whether it is set, its health and each tool's class. The desktop
dropped that list on arrival. Accounts, the one place a person looks to see what Athena may use,
showed the vault's connectors only, and a `--no-connectors` daemon with a server configured said
"The daemon lists no connectors." while Athena was calling one. The way to stop a server was
written only in ADR 0144.

## Decision

1. **Each MCP server is a card in the Accounts field and a level at `accounts/<id>`.** The card
   carries the same standing vocabulary as a vault row (`Standing`, drawn by shape and word), and
   the field's count includes it. The level shows the URL, `token from <VAR>: set|not set` (never a
   value: the daemon sends none), the health with its detail verbatim, the tools that run without
   a card and the ones that are `GATED`, and the stop sentence: remove the server from `mcp.json`
   or unset its token variable.
2. **No switch, allow-list or Disconnect is drawn for a server.** ADR 0144 says none applies;
   drawing an inert one would claim a control that does not exist. The level says so in words.
3. **A tool's class is the daemon's.** `AUTO` and `READ` are listed as running without a card,
   `GATED` as gated. Nothing here classifies a server tool, so no second policy is born (README
   invariant 3). A class outside those three reads as `GATED`: nothing unknown is shown as
   unattended.
4. **The store mirrors `mcp_servers` unparsed; the depth parses it.** `useConnectors.servers` is
   the list's field as sent. `modules/connectors/depth.ts`, imported only by the Accounts depth's
   lazy chunk, parses it defensively (a malformed entry keeps its id with no tools and `unknown`
   health; anything but a list reads as no servers; a failed parse never fails the list) and
   derives the rows. `model.ts` and the store are first-frame code, and the first-paint ceiling
   had seven bytes of headroom; for the same reason `paragraphsOf` moved to `depth.ts` and the
   fixtures' `INERT_ACTIONS` to `fixtures.ts`. The first frame measured 49 B smaller after the
   change than before it.

## Consequences

- A person sees every service Athena may call, which of its tools act without asking, whether its
  token is present and whether it answered, without reading `mcp.json` or an ADR.
- The ids cannot collide: ADR 0144 refuses an MCP id equal to a built-in connector's. Should that
  rule go, the vault's row wins the shared path and the server becomes unreachable in Accounts.
- The breadcrumb names a server by its id (`gravitone`), the depth model's default; a label would
  be first-frame code in `live.tsx`.
- An off switch for a server (an origins row for `connector:<id>`, forwarded to the gate's rule 2)
  is a later decision and a policy-tighten; this read-only level is its prerequisite.
