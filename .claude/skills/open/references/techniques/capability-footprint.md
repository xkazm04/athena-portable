# capability-footprint

**When** a catalogue is sized, **render every tool's line with a port of Athena's own renderer and hold
the app's total to 5,000 chars**, **because** her capability block holds 12,000 chars, packs foreign
entries greedily in GATED, READ, AUTO then name order, and cuts the first entry that does not fit
together with every entry after it.

## The block

- Bound: `CAPABILITIES_CHARS = BUDGETS["capabilities"]` = 12,000 (`src/athena/core/catalog.py:89`,
  `core/prompt.py:137`; ADR 0070).
- Fixed parts: a header, class headings, a footer (~1,160 chars), and her core entries, which are always
  kept (790 to 1,662 chars depending on the build; ADR 0070 counted 1,662).
- The shell appends its DOM hands and `tabs_read` to every page's manifest (~1,900 chars, 10 hands).
- Order: `_CLASS_ORDER = (GATED, READ, AUTO)` then name (`catalog.py:91`). Page tools are only GATED or
  AUTO, so an app's GATED tools are packed first and its reads last. **A cut therefore removes reads,
  and `where_am_i` sorts late.**
- A cut is announced: "<k> more names from pages and connectors did not fit in this block and are not
  listed" plus "(showing N of M)". A cut name keeps its class and its registration, but a name she cannot
  see is a name she says she does not have.
- Each line is charged its length plus one.

So about 8,150 chars are left for apps; 5,000 for one app leaves room for core growth and a second app
(measured 2026-10-23 with her renderer on the desktop shell).

## The renderer port

Port `_capability_line`, `_params_line(foreign=True)`, `_foreign_enum` and `neutralise_text` into the
app's test suite (Shadowrunr: `apps/console/src/app/agent/catalog.test.ts`, "the capability block's
footprint"):

```ts
const PLAIN = /^[A-Za-z0-9_-]{1,40}$/;
const neutralise = (t: string, cap: number) => { const k = t.replace(/\s+/g, " ").trim(); return k.length <= cap ? k : `${k.slice(0, cap - 1).trimEnd()}…`; };
const quoted = (v: unknown) => JSON.stringify(neutralise(typeof v === "string" ? v : JSON.stringify(v), 40));
const foreignEnum = (vs: readonly unknown[]) => { const s = vs.slice(0, 12).map(quoted).join(", "); return vs.length > 12 ? `[${s}, +${vs.length - 12} more]` : `[${s}]`; };
const paramsLine = (schema) => Object.entries(schema.properties ?? {}).map(([n, sub]) => {
  const kind = sub.type ?? "any"; const kt = typeof kind === "string" && PLAIN.test(kind) ? kind : quoted(kind);
  const v = Array.isArray(sub.enum) && sub.enum.length > 0 ? foreignEnum(sub.enum) : kt;
  return `${PLAIN.test(n) ? n : quoted(n)}${(schema.required ?? []).includes(n) ? "" : "?"}: ${v}`; }).join(", ");
const line = (app, name, description, schema) => `- \`host.${app}.${name}\`(${paramsLine(schema)}) — ${JSON.stringify(neutralise(description, 240))}`;
// footprint = sum(line.length + 1)
```

Pin the port with one golden line taken from her code (the Shadowrunr test pins
`- \`host.shadowrunr.x\`(minutes: ["5", "10", "30"], tone?: string) — "Says \"hi\"."`), and re-read the
Python when `/open` starts a run: if her renderer moved, the port moves first.

## Getting under the budget

In order, cheapest first:
1. shorten descriptions (most lines are mostly description);
2. drop parameters the handler never reads;
3. fold rarely used reads into the allowlisted read router (`query`) and publish its methods in an
   `app_map` topic (Shadowrunr folded `ranks_table`, `ledger_summary` and `validate_character`);
4. merge tools that differ only by a mode argument, when every axis (class, reversibility) is equal;
5. last, cut scope, and say what is out of reach.

## Checks

- `footprint <= 5000` over every tool, printed with the tool count.
- A golden-line test of the port.
- Optional, at the seam: the harness posts the real manifest to a real `athena serve` and reads the
  rendered block's "(showing N of M)"; N must equal M.

## Evidence

Real desktop, 2026-10-23: a 28-tool catalogue rendering 8,099 chars cut `where_am_i` ("40 of 41"
entries in her block, core and hands included). The fix took it to 25 tools and 4,801 chars
(overlord `dfff8f0`), and the e2e passed 6/6.

## Registry

`mcp-tools/catalog-projection-modes`: the publisher limit is "the smallest host ceiling it must run
under, minus a share reserved for the other servers", and "compress a catalog because a ceiling outside
your control forbids it, never because its face value looks large". Agrees; this technique supplies the
ceiling, the share and the renderer.
