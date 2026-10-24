#!/usr/bin/env node
/**
 * catalog-check: a WebMCP catalogue measured against Athena's acceptance rules, without Athena.
 *
 *   node catalog-check.mjs <tools.json> [--app <slug>] [--budget 5000] [--json]
 *
 * <tools.json> is an array of tools as `document.modelContext` holds them, or the relay's `list`
 * answer (`{ page, tools }`), or `pnpm -C apps/desktop drive tools <tab>` output. Each tool needs
 * `name`, `description` and `inputSchema`; `annotations` and `athena` are checked when present.
 * A survey can feed it a hand-written draft of the same shape.
 *
 * It reports, per tool, the capability-block line exactly as Athena renders it (a port of
 * `_capability_line`, `_params_line(foreign=True)`, `_foreign_enum` and `neutralise_text` in
 * athena-portable src/athena/core/catalog.py) and the total footprint (each line plus one), and the
 * problems her manifest validator would refuse the WHOLE catalogue for (src/athena/contracts/
 * manifest.py HostManifest.validate), plus the house rules of the /open standard.
 *
 * Exit codes: 0 clean, 2 a problem or a warning over budget, 1 the input could not be read.
 * Re-read the Python when Athena changes: the constants below are dated.
 */
import { readFileSync } from "node:fs";

// ---- Athena's rules, as of athena-portable 5c1a449d (2026-10-24) -------------------------------
const DESCRIPTION_CAP = 240; // catalog.py:79
const PARAM_TEXT_CAP = 40; // catalog.py:80
const ENUM_SHOWN = 12; // catalog.py:81
const PLAIN = /^[A-Za-z0-9_-]{1,40}$/; // catalog.py:82 _PLAIN_NAME
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/; // catalog.py:74 _TOOL_NAME
const MAX_TOOLS = 96; // manifest.py:50, the shell's hands included
const SHELL_HANDS = 10; // apps/desktop/src-tauri hands.rs HANDS
const MAX_PROPERTIES = 24; // manifest.py:51
const BLOCK = 12_000; // core/prompt.py:137

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const VALUED = new Set(["--app", "--budget"]);
let file;
for (let i = 0; i < args.length; i += 1) {
  if (VALUED.has(args[i])) i += 1;
  else if (!args[i].startsWith("--")) {
    file = args[i];
    break;
  }
}
if (!file) {
  console.error("usage: node catalog-check.mjs <tools.json> [--app <slug>] [--budget 5000] [--json]");
  process.exit(1);
}

let raw;
try {
  raw = JSON.parse(readFileSync(file, "utf-8"));
} catch (e) {
  console.error(`cannot read ${file}: ${e.message}`);
  process.exit(1);
}
const tools = Array.isArray(raw) ? raw : (raw.tools ?? raw.result?.tools ?? []);
const app = flag("--app", raw.page?.app_id ?? "app");
const budget = Number(flag("--budget", "5000"));

// ---- the renderer port ---------------------------------------------------------------------------
/** neutralise_text: whitespace runs to one space, trimmed, cut to `cap` with an ellipsis. */
const neutralise = (text, cap) => {
  const kept = String(text).replace(/\s+/g, " ").trim();
  return kept.length <= cap ? kept : `${kept.slice(0, cap - 1).trimEnd()}…`;
};
const quoted = (v) => JSON.stringify(neutralise(typeof v === "string" ? v : JSON.stringify(v), PARAM_TEXT_CAP));
const foreignEnum = (values) => {
  const shown = values.slice(0, ENUM_SHOWN).map(quoted).join(", ");
  return values.length > ENUM_SHOWN ? `[${shown}, +${values.length - ENUM_SHOWN} more]` : `[${shown}]`;
};
const paramsLine = (schema) => {
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  return Object.entries(props)
    .map(([name, sub]) => {
      const kind = sub?.type ?? "any";
      const kindText = typeof kind === "string" && PLAIN.test(kind) ? kind : quoted(kind);
      const e = sub?.enum;
      const value = Array.isArray(e) && e.length > 0 ? foreignEnum(e) : kindText;
      return `${PLAIN.test(name) ? name : quoted(name)}${required.has(name) ? "" : "?"}: ${value}`;
    })
    .join(", ");
};
const capabilityLine = (t) =>
  `- \`host.${app}.${t.name}\`(${paramsLine(t.inputSchema ?? t.input_schema ?? {})}) — ${JSON.stringify(neutralise(t.description || "(no description)", DESCRIPTION_CAP))}`;

// ---- checks --------------------------------------------------------------------------------------
const problems = []; // Athena refuses the whole manifest
const warnings = []; // the /open standard
const classOf = (t) => {
  const a = t.athena;
  if (a && typeof a.reversible === "boolean") return a.reversible && a.side_effects !== "external" ? "AUTO" : "GATED";
  const h = t.annotations ?? {};
  if (h.consequentialHint === true) return "GATED";
  if (h.readOnlyHint === true) return "AUTO";
  if (h.readOnlyHint === false && h.consequentialHint === false) return "AUTO";
  return "GATED";
};

if (tools.length + SHELL_HANDS > MAX_TOOLS) problems.push(`${tools.length} tools plus ~${SHELL_HANDS} shell hands is over the cap of ${MAX_TOOLS} per manifest`);
const seen = new Set();
const rows = tools.map((t) => {
  const name = String(t.name ?? "");
  const schema = t.inputSchema ?? t.input_schema ?? {};
  const props = schema.properties ?? {};
  if (!TOOL_NAME.test(name)) problems.push(`${name || "(empty)"}: the name is not [A-Za-z0-9_-]{1,64}`);
  if (seen.has(name)) problems.push(`${name}: duplicate name`);
  seen.add(name);
  if (Object.keys(props).length > MAX_PROPERTIES) problems.push(`${name}: ${Object.keys(props).length} properties, over ${MAX_PROPERTIES}`);
  for (const [p, ps] of Object.entries(props)) {
    if (ps?.type === "array" && typeof ps.maxItems !== "number") problems.push(`${name}.${p}: an array parameter needs maxItems`);
    if (ps?.enum !== undefined && !Array.isArray(ps.enum)) problems.push(`${name}.${p}: enum is not a list`);
    if (Array.isArray(ps?.enum) && ps.enum.length > ENUM_SHOWN) warnings.push(`${name}.${p}: ${ps.enum.length} enum values; Athena shows ${ENUM_SHOWN}`);
    if (ps?.type === "array" && Array.isArray(ps.items?.enum)) {
      const missingValues = ps.items.enum.filter((v) => !String(t.description ?? "").includes(String(v)));
      if (missingValues.length > 0) warnings.push(`${name}.${p}: its items enum is invisible in the block, and the description does not name ${missingValues.slice(0, 4).join(", ")}${missingValues.length > 4 ? ", ..." : ""}`);
    }
    if (p.length > PARAM_TEXT_CAP) warnings.push(`${name}.${p}: a parameter name over ${PARAM_TEXT_CAP} chars`);
  }
  for (const r of schema.required ?? []) if (!(r in props)) problems.push(`${name}: required "${r}" is not a property`);
  if (schema.type !== "object") warnings.push(`${name}: inputSchema.type is not "object"`);
  if (schema.additionalProperties !== false) warnings.push(`${name}: the schema is not closed (additionalProperties: false)`);
  const d = String(t.description ?? "");
  if (d.length > DESCRIPTION_CAP) warnings.push(`${name}: description is ${d.length} chars; Athena cuts at ${DESCRIPTION_CAP}`);
  if (d.length < 40) warnings.push(`${name}: description is ${d.length} chars; say what it returns`);
  if (!t.athena && !t.annotations) warnings.push(`${name}: no athena block and no annotations; Athena reads it as GATED`);
  else if (!t.athena) warnings.push(`${name}: no athena block (a native registry drops it, but the polyfill carries it)`);
  const line = capabilityLine(t);
  return { name, class: classOf(t), chars: line.length + 1, line };
});

// Athena packs GATED, then READ (core only), then AUTO, each by name.
const order = { GATED: 0, AUTO: 2 };
rows.sort((a, b) => order[a.class] - order[b.class] || a.name.localeCompare(b.name));
const footprint = rows.reduce((n, r) => n + r.chars, 0);
if (footprint > budget) warnings.push(`footprint ${footprint} chars is over the ${budget}-char per-app budget (block ${BLOCK}, shared with her core and the shell's hands)`);
const orient = ["where_am_i", "app_map", "go_to"].filter((n) => !seen.has(n));
if (orient.length > 0) warnings.push(`no orient tool named ${orient.join(", ")}`);

const report = { app, tools: rows.length, gated: rows.filter((r) => r.class === "GATED").length, auto: rows.filter((r) => r.class === "AUTO").length, footprint, budget, problems, warnings, rows };
if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`${app}: ${report.tools} tools (${report.gated} GATED, ${report.auto} AUTO in Athena's gate), footprint ${footprint} of ${budget} chars`);
  for (const r of rows) console.log(`  ${String(r.chars).padStart(4)}  ${r.class.padEnd(5)}  ${r.name}`);
  if (problems.length > 0) console.log(`\nREFUSED WHOLE by Athena's validator (${problems.length}):\n  ${problems.join("\n  ")}`);
  if (warnings.length > 0) console.log(`\nAgainst the /open standard (${warnings.length}):\n  ${warnings.join("\n  ")}`);
  if (problems.length === 0 && warnings.length === 0) console.log("\nclean");
}
process.exit(problems.length > 0 || warnings.length > 0 ? 2 : 0);
