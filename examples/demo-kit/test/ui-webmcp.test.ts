// demo-kit-ui-webmcp: the page's tool door (webmcp/), the UI primitives (ui/), the activity log
// and the database handle, pinned where a scan-sweep round found one rule with two readings.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import { validateArgs } from "../src/webmcp/door.ts";
import { classifyTool, parametersToJsonSchema, type SideEffects } from "../src/webmcp/types.ts";

// The modules under test import their siblings without an extension (Next resolves those), the
// server half imports the `server-only` build marker, and the UI is `.tsx`, which node's type
// stripping does not take. Supply those three - the JSX through the TypeScript the kit already
// depends on - and nothing else, so the code under test is the source the apps ship. Registered
// before any dynamic import below.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    try {
      return next(specifier, context);
    } catch (err) {
      if ((err as { code?: string }).code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".")) throw err;
      try {
        return next(`${specifier}.ts`, context);
      } catch {
        return next(`${specifier}.tsx`, context);
      }
    }
  },
  load(url, context, next) {
    if (!url.endsWith(".tsx")) return next(url, context);
    const { outputText } = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  },
});

const { annotationsFor, athenaFor } = await import("../src/webmcp/hooks.ts");
// The consumer the `athena` block and the annotations are written for (README section 3.3).
const gate = (await import(new URL("../../../packages/athena-bridge/gate.js", import.meta.url).href)) as {
  flagsOf: (tool: unknown) => { reversible: boolean; side_effects: string; basis: string };
  classify: (flags: unknown) => "AUTO" | "GATED";
  SIDE_EFFECTS: readonly string[];
};

test("every object the door closes to unknown arguments is published closed", () => {
  // The door refuses a key the schema does not name, at the top and inside any object that lists
  // its properties. JSON Schema's default is the opposite, so a schema that does not say
  // `additionalProperties: false` tells the model (and the core's validator) extras are fine.
  const schema = parametersToJsonSchema([
    { name: "id" },
    { name: "row", type: "object", attributes: [{ name: "x" }] },
    { name: "rows", type: "object[]", attributes: [{ name: "y" }] },
  ]);
  const ok = { id: "a", row: { x: "1" }, rows: [{ y: "2" }] };
  assert.equal(validateArgs(ok, schema), null);
  assert.match(validateArgs({ ...ok, extra: 1 }, schema) ?? "", /unknown argument "extra"/);
  assert.match(validateArgs({ ...ok, row: { x: "1", z: 2 } }, schema) ?? "", /unknown argument "row\.z"/);
  assert.match(validateArgs({ ...ok, rows: [{ y: "2", z: 2 }] }, schema) ?? "", /unknown argument "rows\[0\]\.z"/);

  const open: string[] = [];
  const walk = (node: unknown, at: string): void => {
    if (!node || typeof node !== "object") return;
    const n = node as { properties?: Record<string, unknown>; items?: unknown; additionalProperties?: unknown };
    if (n.properties && n.additionalProperties !== false) open.push(at || "(top)");
    for (const [k, v] of Object.entries(n.properties ?? {})) walk(v, at ? `${at}.${k}` : k);
    walk(n.items, `${at}[]`);
  };
  walk(schema, "");
  assert.deepEqual(open, []);
  assert.deepEqual(parametersToJsonSchema([]).additionalProperties, false, "a tool with no arguments takes none");
});

/* ------------------------------------------------------- the page's own claim -- */

const CLAIMS: { reversible: boolean; sideEffects: SideEffects }[] = [true, false].flatMap((reversible) =>
  (["none", "data", "external"] as const).map((sideEffects) => ({ reversible, sideEffects })),
);

test("the athena block speaks the contract's side_effects vocabulary, so the gate reads it first", () => {
  for (const claim of CLAIMS) {
    const block = athenaFor(claim);
    const label = `${claim.reversible ? "reversible" : "irreversible"} ${claim.sideEffects}`;
    assert.ok(gate.SIDE_EFFECTS.includes(block.side_effects), `${label}: ${block.side_effects} is not a contract value`);
    const flags = gate.flagsOf({ name: "t", athena: block, annotations: annotationsFor(claim) });
    assert.equal(flags.basis, "athena", label);
    assert.equal(flags.reversible, claim.reversible, label);
  }
});

test("the block, the annotations alone and classifyTool give every claim one class", () => {
  for (const claim of CLAIMS) {
    const label = `${claim.reversible ? "reversible" : "irreversible"} ${claim.sideEffects}`;
    const expected = classifyTool({ reversible: claim.reversible, side_effects: claim.sideEffects });
    assert.equal(gate.classify(gate.flagsOf({ name: "t", athena: athenaFor(claim) })), expected, `${label}, block`);
    // A native document.modelContext drops the non-standard block; the hints must say the same.
    assert.equal(gate.classify(gate.flagsOf({ name: "t", annotations: annotationsFor(claim) })), expected, `${label}, hints`);
  }
});

/* ------------------------------------------------------------- the execute door -- */

test("an array over the maxItems its schema publishes is refused at the door, naming the cap", () => {
  // mcp-tools/tool-schema-design: the schema published is the schema enforced. types.ts publishes
  // `maxItems` on every capped array; a native browser agent reaches the door without the bridge's
  // own check, so the cap has to hold here too or an over-long list is sliced by the handler.
  const schema = parametersToJsonSchema([{ name: "ids", type: "string[]", maxItems: 2 }]);
  assert.equal(validateArgs({ ids: ["a", "b"] }, schema), null);
  assert.match(validateArgs({ ids: ["a", "b", "c"] }, schema) ?? "", /"ids" has 3 items; at most 2/);
  const nested = parametersToJsonSchema([
    { name: "rows", type: "object[]", attributes: [{ name: "tags", type: "string[]", maxItems: 1 }] },
  ]);
  assert.match(validateArgs({ rows: [{ tags: ["x", "y"] }] }, nested) ?? "", /"rows\[0\]\.tags" has 2 items/);
});

/* ------------------------------------------------------------ the UI primitives -- */

const { DataTable } = await import("../src/ui/DataTable.tsx");

test("a sortable header's accessible name is the header a reader sees, not the column key", () => {
  // WCAG 2.5.3 (label in name): a voice user says what is on screen. The sort button used to be
  // named `Sort by updated_at` over a header that reads "Updated".
  type Row = { id: string; updated_at: string };
  const html = renderToStaticMarkup(
    createElement(DataTable<Row>, {
      rows: [{ id: "r1", updated_at: "2026-09-01" }],
      rowId: (r: Row) => r.id,
      columns: [
        { key: "updated_at", header: "Updated", render: (r: Row) => r.updated_at, sortValue: (r: Row) => r.updated_at },
        { key: "id", header: "Id", render: (r: Row) => r.id },
      ],
    }),
  );
  const buttons = [...html.matchAll(/<button[^>]*class="dk-table-sort"[^>]*>([\s\S]*?)<\/button>/g)];
  assert.equal(buttons.length, 1, "one sortable column, one sort control");
  const [tag, body] = [buttons[0]![0].slice(0, buttons[0]![0].indexOf(">") + 1), buttons[0]![1]!];
  const label = /aria-label="([^"]*)"/.exec(tag)?.[1];
  const visible = body.replace(/<span aria-hidden="true">[\s\S]*?<\/span>/g, "").replace(/<[^>]+>/g, "").trim();
  assert.equal(visible, "Updated");
  if (label !== undefined) assert.ok(label.includes(visible), `accessible name "${label}" does not contain "${visible}"`);
  // The unsorted header claims no order; the sorted one says which (aria-sort, set on click).
  assert.doesNotMatch(html, /aria-sort=/);
});

/* -------------------------------------------------------------- the database -- */

const { openDb } = await import("../src/db/index.ts");
const { mkdtempSync, rmSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");

test("a transaction SQLite already ended does not hide the error that ended it", () => {
  // SQLite rolls a transaction back by itself on some errors (a full disk, an I/O error, an
  // interrupt), and `raw` is handed out for what the wrappers do not cover. The unconditional
  // ROLLBACK in withTx's catch then threw "no transaction is active" in place of the real cause.
  const dir = mkdtempSync(join(tmpdir(), "dk-ui-webmcp-"));
  const db = openDb("t", { file: join(dir, "t.sqlite"), seed: (d) => d.exec("CREATE TABLE x (v INTEGER)") });
  try {
    assert.throws(
      () =>
        db.withTx((tx) => {
          tx.run("INSERT INTO x VALUES (1)");
          tx.raw.exec("ROLLBACK");
          throw new Error("the real cause");
        }),
      /the real cause/,
    );
    db.withTx((tx) => tx.run("INSERT INTO x VALUES (2)"));
    assert.deepEqual(db.all("SELECT v FROM x"), [{ v: 2 }], "the handle is usable and nothing leaked");
    assert.throws(() => db.withTx(() => { throw new Error("plain"); }), /plain/, "a live transaction still rolls back");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a seed that throws closes the handle it opened, so the next request starts clean", async () => {
  // openDb is called per request until a seed succeeds. A throwing seed used to leave its
  // connection open: one more handle per request, and on Windows a data file that cannot be
  // deleted to reseed (the apps' READMEs say to delete it) while the dev server runs.
  const { existsSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "dk-ui-webmcp-"));
  const file = join(dir, "s.sqlite");
  try {
    assert.throws(
      () =>
        openDb("s", {
          file,
          seed: () => {
            throw new Error("seed bug");
          },
        }),
      /seed bug/,
    );
    const db = openDb("s", { file, seed: (d) => d.exec("CREATE TABLE y (v INTEGER)") });
    db.close();
    // WAL keeps its side files while any connection is open; the last close removes them.
    assert.equal(existsSync(`${file}-wal`), false, "a connection from the failed seed is still open");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a handler that throws leaves its stack in the page console, not only a sentence for the agent", async (t) => {
  // The door turns a fault into an in-band error so one bad handler cannot break the bridge, and
  // that sentence reaches only the calling agent. The stack was discarded, so the developer of the
  // page had nothing in devtools to say which handler broke or where.
  const { runTool } = await import("../src/webmcp/door.ts");
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => void logged.push(args));
  const boom = new TypeError("cannot read x of undefined");
  const out = await runTool({ type: "object", properties: {} }, {}, () => {
    throw boom;
  });
  assert.deepEqual(JSON.parse(out), { ok: false, error: "tool failed: cannot read x of undefined" });
  assert.equal(logged.length, 1);
  assert.ok(logged[0]!.includes(boom), "the error object itself, with its stack");
  logged.length = 0;
  await runTool({ type: "object", properties: {} }, { x: 1 }, () => "unreached");
  assert.equal(logged.length, 0, "a refused argument is the caller's mistake, not the page's");
});

/* ------------------------------------------------------------- the stylesheet -- */

test("every class the kit's stylesheet styles is drawn by something in the tree", async () => {
  // A rule nobody renders ships to every app that imports the sheet and can only drift: the
  // manifest drawer's eleven rules (a raw 160ms transition among them) had no element since the
  // kit landed. Scaffold vocabulary kept on purpose is named here WITH its reason, and an entry
  // that something does draw fails too, so the list cannot go stale.
  const { readdirSync, statSync } = await import("node:fs");
  const KEPT: Record<string, string> = {
    "dk-btn-primary": "the scaffold's primary action, for the app copied from the template",
    "dk-badge-gated": "the GATED half of the auto/gated pair DetailPane's actions slot is for",
  };
  const examples = fileURLToPath(new URL("../../", import.meta.url));
  const sheetPath = fileURLToPath(new URL("../src/ui/demo-kit.css", import.meta.url));
  const sources: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      // A class only a test names is not drawn; this file names the kept ones itself.
      if (["node_modules", ".next", "data", "test", "e2e"].includes(name) || name.startsWith(".")) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(tsx?|css|mjs|html)$/.test(name) && path !== sheetPath) sources.push(readFileSync(path, "utf8"));
    }
  };
  walk(examples);
  const text = sources.join("\n");
  const dynamic = [...text.matchAll(/(dk-[a-z0-9-]+-)\$\{/g)].map((m) => m[1]!);
  const sheet = readFileSync(sheetPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const classes = [...new Set([...sheet.matchAll(/\.(dk-[a-z0-9-]+)/g)].map((m) => m[1]!))];
  const drawn = (c: string) =>
    new RegExp(`(^|[^a-z0-9-])${c}($|[^a-z0-9-])`).test(text) || dynamic.some((p) => c.startsWith(p));
  assert.deepEqual(classes.filter((c) => !drawn(c) && !(c in KEPT)), [], "styled, never drawn");
  assert.deepEqual(Object.keys(KEPT).filter(drawn), [], "kept as unused, but something draws it now");
});
