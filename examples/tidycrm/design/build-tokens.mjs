#!/usr/bin/env node
/**
 * Token build for the tidycrm design variants.
 *
 * RETIRED (2026-09), and this is the first thing to know about it. All three of its inputs belong
 * to directions that were reviewed out - `signal` and `broadsheet` were never built at all,
 * `token` was cut in `f9664e6` - so nothing here reaches a rendered page: there is no
 * `components/signal/`, `components/broadsheet/` or `components/token/` tree (`ls components` is
 * `blocks/ shell/`), no npm script that runs this file, nothing in CI, and no emitted CSS anywhere
 * in the repo. Nothing regresses if it is run; nothing is produced that anything reads.
 *
 * THE LIVE VALUE AUTHORITY IS NOT THIS PIPELINE. The one direction that ships hand-writes its
 * tokens in `components/blocks/style/base/tokens.css`, under `[data-variant="blocks"]`, pulled in
 * first by `components/blocks/style/index.css`. That is the file `DESIGN.md` §2 names and the file
 * to change a value in; changing one here changes nothing. There is no `blocks.tokens.json` and
 * there is not meant to be one. `test/tokens.test.ts` fails if any of that stops being true.
 *
 * KEPT, AND NOT DELETED, FOR A REASON OUTSIDE THIS APP. This file is the upstream of record for
 * two vendored copies that each document their divergence from it line by line -
 * `examples/hirelane/design/build-tokens.mjs` and `examples/ledgerbox/design/build-tokens.mjs` -
 * and `examples/ledgerbox/design/pass3-token-brief.md` cites this app's brief by path as the
 * precedent disposition. It is also the only implementation of `--refs`. Deleting it would answer
 * a dead-code finding by breaking four live citations in two other apps, so the same call the
 * siblings made is made here: mark it, do not remove it.
 *
 * This is the `token-build` step of the plugin87/ux-ui-agent-skills method, vendored so the repo
 * does not depend on a clone of that kit at build time. It reads a self-contained DTCG token file
 * (`$type`/`$value`, primitive -> semantic -> component) and emits one CSS custom-property layer.
 *
 * Two deliberate differences from the upstream `scripts/build_tokens.mjs`:
 *
 *  1. Upstream resolves `--in` with `IN.split('/').pop()`, which on Windows returns the whole
 *     absolute path and then joins it onto its own directory. `basename()` is used here instead.
 *  2. Upstream emits `:root { … }`. These variants were mounted as sibling routes under one app, so
 *     each one is scoped to its own `[data-variant="…"]` wrapper instead. The adapter protocol
 *     asks for exactly this: map the token layer onto the target's theming primitive.
 *
 * Usage. The out-path is deliberately unnamed: the `../components/<slug>/<slug>.tokens.css` this
 * block used to spell out is a directory that does not exist, and `mkdirSync(..., {recursive:true})`
 * below would have created it rather than updated anything. Build to a scratch path and read the
 * output; that is the only thing there is to do with it.
 *
 *   node design/build-tokens.mjs signal     <any-out-path>.css
 *   node design/build-tokens.mjs broadsheet <any-out-path>.css
 *   node design/build-tokens.mjs token      <any-out-path>.css --refs
 *
 * `--refs` (pass 3, added for the `token` direction) changes ONE thing: when a token's `$value` is
 * exactly `{some.path}` and that path is itself emitted as a custom property, the output keeps the
 * reference as `var(--that-property)` instead of flattening it to the literal. Without the flag the
 * emitter behaves exactly as before, byte for byte, so `signal` and `broadsheet` are untouched.
 *
 * Why it matters: with literals, `--text-body: 1.0625rem` and `--text-lead: 1.1875rem` are two
 * unrelated facts. With references into a numbered ladder, `--text-body: var(--step-2)` and
 * `--text-lead: var(--step-3)` are neighbours, and "shift the whole reading ramp one rung" or
 * "these two are two rungs apart" become operations a stylesheet — or an agent — can perform.
 *
 * The flag also reports what it could NOT preserve, which is the interesting half. See the
 * `--refs` summary line and `design/pass3-token-brief.md`.
 *
 * THE OTHER COPY, AND WHEN NOT TO VENDOR THIS ONE. `examples/ledgerbox/design/build-tokens.mjs`
 * was vendored from this file and REMOVED `--refs` (about ninety lines: `USE_REFS`, `nameOfPath`,
 * `aliasTarget`, the `asVar` closure, the two-pass `build(useRefs, emitted)` and this summary
 * block). It asks the token file to write `var(--ladder-type-06)` as the literal `$value`
 * instead. The constraint that decided it: `--refs` cannot support a runtime mode switch. A DTCG
 * alias is resolved before the CSS exists, so a `[data-density="compact"]` block has nothing to
 * re-point — a `var()` written into the source survives into the output and can be. If the next
 * copy needs modes, vendor ledgerbox's; if it needs only a static ramp, this one is simpler.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const USE_REFS = argv.includes("--refs");
const [variant, outArg] = argv.filter((a) => !a.startsWith("--"));
if (!variant || !outArg) {
  console.error("usage: node design/build-tokens.mjs <variant> <out.css>");
  process.exit(2);
}

const IN = join(HERE, "tokens", `${variant}.tokens.json`);
const OUT = resolve(HERE, outArg);

// 1) load the token file into a global path -> value map, both bare and file-namespaced.
const all = {};
const doc = JSON.parse(readFileSync(IN, "utf8"));
const stem = basename(IN).replace(/\.json$/, "");
(function walk(o, p) {
  if (o && typeof o === "object") {
    if ("$value" in o) {
      all[p] = o.$value;
      all[`${stem}.${p}`] = o.$value;
    }
    for (const k of Object.keys(o)) if (!k.startsWith("$")) walk(o[k], p ? `${p}.${k}` : k);
  }
})(doc, "");

// 2) resolve a value, following {ref} chains.
function res(v, depth = 0) {
  if (depth > 16 || typeof v !== "string") return v;
  const m = v.match(/^\{(.+)\}$/);
  if (!m) return v;
  let ref = m[1].trim();
  while (ref.startsWith("../") || ref.startsWith("./")) {
    ref = ref.startsWith("../") ? ref.slice(3) : ref.slice(2);
  }
  let val = all[ref];
  if (val === undefined) val = all[ref.split(".").slice(1).join(".")];
  return val === undefined ? v : res(val, depth + 1);
}

/*
 * The token groups, and the map from a DTCG path to the CSS custom property it becomes. The map is
 * what `--refs` needs: to keep `{step.2}` as a reference it must know that `step.2` will be emitted
 * as `--step-2`. Entries added in pass 3 (`step`, `gap`, `shape`, `motion.pace`) are inert for
 * `signal` and `broadsheet`, whose token files contain no such node.
 */
const GROUPS = [
  ["font.family", "font-"],
  ["font.size", "text-"],
  ["font.weight", "weight-"],
  ["font.leading", "leading-"],
  ["font.tracking", "tracking-"],
  ["step", "step-"],
  ["space", "space-"],
  ["gap", "gap-"],
  ["radius", "radius-"],
  ["shape", "shape-"],
  ["border-width", "bw-"],
  ["shadow", "shadow-"],
  ["motion.duration", "duration-"],
  ["motion.easing", "ease-"],
  ["motion.pace", "pace-"],
  ["size", "size-"],
  ["z", "z-"],
];

const at = (path) => path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), doc);

/** The DTCG path -> custom-property name map. Returns null for a path this emitter does not name. */
function nameOfPath(path) {
  if (path.startsWith("semantic.")) return `--color-${path.slice(9).replace(/\./g, "-")}`;
  if (path.startsWith("component.")) return `--color-${path.slice(10).replace(/\./g, "-")}`;
  for (const [prefix, css] of GROUPS) {
    if (path.startsWith(`${prefix}.`)) {
      return `--${css}${path.slice(prefix.length + 1).replace(/\./g, "-")}`;
    }
  }
  return null;
}

/** One hop only: the path a `{ref}` points at, normalised, or null if it is not a bare reference. */
function aliasTarget(v) {
  if (typeof v !== "string") return null;
  const m = v.match(/^\{(.+)\}$/);
  if (!m) return null;
  let ref = m[1].trim();
  while (ref.startsWith("../") || ref.startsWith("./")) {
    ref = ref.startsWith("../") ? ref.slice(3) : ref.slice(2);
  }
  if (all[ref] !== undefined) return ref;
  const stripped = ref.split(".").slice(1).join(".");
  return all[stripped] !== undefined ? stripped : null;
}

/**
 * One emit pass. `emitted` is the set of property names a previous literal pass produced; a
 * reference is only preserved when its target is in that set, because `var(--x)` to a property
 * nobody declares is a silently broken stylesheet.
 */
function build(useRefs, emitted) {
  const lines = [];
  const seen = new Set();
  const names = new Set();
  const stats = { preserved: 0, flattened: [] };

  const push = (name, value) => {
    const decl = `  ${name}: ${value};`;
    if (!seen.has(decl)) {
      seen.add(decl);
      names.add(name);
      lines.push(decl);
    }
  };

  /** `{path}` -> `var(--name)`, or null when this emitter gives that path no name to point at. */
  const asVar = (path) => {
    const n = nameOfPath(path);
    if (n && emitted && emitted.has(n)) {
      stats.preserved += 1;
      return `var(${n})`;
    }
    if (emitted) stats.flattened.push(path);
    return null;
  };

  // The colour tiers become --color-*. Primitives are deliberately NOT emitted: the three-tier rule
  // is that a component may never reference one, and the easiest way to enforce that is to give it
  // no name to reference. That enforcement is exactly why `--refs` cannot preserve a
  // semantic -> primitive reference: there is no property on the other end. It is a real trade, not
  // a bug, and the summary line at the bottom counts it.
  function emitColor(obj, prefix) {
    for (const [k, v] of Object.entries(obj || {})) {
      if (k.startsWith("$")) continue;
      if (v && typeof v === "object" && "$value" in v) {
        const hex = res(v.$value);
        if (typeof hex === "string" && /^(#|rgb|hsl|transparent)/.test(hex)) {
          let out = hex;
          if (useRefs) {
            const target = aliasTarget(v.$value);
            if (target) out = asVar(target) ?? hex;
          }
          push(`--color-${prefix}${k}`, out);
        }
      } else if (v && typeof v === "object") {
        emitColor(v, `${prefix}${k}-`);
      }
    }
  }

  function cssValue(v) {
    if (Array.isArray(v)) return `cubic-bezier(${v.join(", ")})`;
    if (typeof v === "number") return String(v);
    if (typeof v !== "string") return null;
    return v.replace(/\{([^}]+)\}/g, (_, ref) => {
      if (useRefs) {
        const target = aliasTarget(`{${ref}}`);
        if (target) {
          const asRef = asVar(target);
          if (asRef) return asRef;
        }
      }
      const out = res(`{${ref}}`);
      return typeof out === "string" ? out : `{${ref}}`;
    });
  }

  function emitGroup(node, prefix) {
    for (const [k, v] of Object.entries(node || {})) {
      if (k.startsWith("$")) continue;
      if (v && typeof v === "object" && "$value" in v) {
        const out = cssValue(v.$value);
        if (out !== null && !/\{[^}]+\}/.test(String(out))) push(`--${prefix}${k}`, out);
      } else if (v && typeof v === "object") {
        emitGroup(v, `${prefix}${k}-`);
      }
    }
  }

  emitColor(doc.semantic, "");
  emitColor(doc.component, "");
  for (const [path, prefix] of GROUPS) {
    const node = at(path);
    if (node) emitGroup(node, prefix);
  }
  return { lines, names, stats };
}

// Pass 1 is always literal, and its job is to answer "which names exist?". Pass 2 is the output.
const first = build(false, null);
const final = USE_REFS ? build(true, first.names) : first;
const lines = final.lines;


const css = `/*
 * GENERATED by design/build-tokens.mjs from design/tokens/${variant}.tokens.json.
 * Do not edit by hand. Edit the DTCG source and rebuild:
 *   node design/build-tokens.mjs ${variant} <this-path>.css${USE_REFS ? " --refs" : ""}
 *
 * RETIRED: no direction in this app mounts [data-variant="${variant}"]. The live value authority
 * is components/blocks/style/base/tokens.css. See the header of design/build-tokens.mjs.
 */
[data-variant="${variant}"] {
${lines.join("\n")}
}
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, css);
console.log(`${variant}: wrote ${lines.length} custom properties -> ${outArg}`);

if (USE_REFS) {
  // The interesting half of the experiment is what could NOT stay a reference, and why.
  const tiers = {};
  for (const p of final.stats.flattened) {
    const tier = p.split(".")[0];
    tiers[tier] = (tiers[tier] ?? 0) + 1;
  }
  const breakdown = Object.entries(tiers)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${n} -> ${t}.*`)
    .join(", ");
  console.log(
    `  --refs: ${final.stats.preserved} references preserved as var(); ` +
      `${final.stats.flattened.length} flattened to literals (${breakdown || "none"}).`,
  );
  console.log(
    "  A flattened reference points at a path this emitter gives no name to. " +
      "`primitive.*` is that by design — suppressing it is how the three-tier rule is enforced.",
  );
}
