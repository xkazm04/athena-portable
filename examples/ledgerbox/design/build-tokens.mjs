#!/usr/bin/env node
/**
 * Token build for the ledgerbox `token` direction.
 *
 * RETIRED (2026-09), and this is the first thing to know about it. The `token` direction was
 * reviewed out with the other cut variants, so nothing here reaches a rendered page: there is no
 * `app/v/token/` route, no `components/token/` tree, no npm script that runs this file, nothing in
 * CI, and no emitted CSS anywhere in the repo. `[data-variant="token"]` and `[data-density]` are
 * emitted by this file and mounted by nothing.
 *
 * THE LIVE VALUE AUTHORITY IS NOT THIS PIPELINE. The two directions that ship hand-write their
 * tokens: `components/edge/edge.css` (the `[data-variant="edge"]` block, `--e-*`) for the Strip,
 * and `components/lanes/style/base/tokens.css`, pulled in by `components/lanes/style/index.css`,
 * for the Lanes. The variant index at `/v` gets its own set in `app/globals.css`. Change a value
 * there; changing one here changes nothing. Same call the sibling apps made for their own cut
 * `token` direction - see `examples/hirelane/design/build-tokens.mjs` and
 * `examples/tidycrm/design/SITE.md` - so the three copies read the same way.
 *
 * VENDORED from `examples/tidycrm/design/build-tokens.mjs` (which is itself the `token-build` step
 * of the plugin87/ux-ui-agent-skills method, vendored so the repo does not depend on a clone of
 * that kit at build time). It reads a self-contained DTCG token file (`$type`/`$value`, primitive
 * -> semantic -> component) and emits CSS custom properties scoped to one `[data-variant]`.
 *
 * The two differences the tidycrm copy already carries are kept: `basename()` instead of
 * `split('/').pop()` (the upstream Windows path bug), and a `[data-variant="…"]` selector instead
 * of `:root`.
 *
 * TWO ADDITIONS MADE HERE, both required by the measured defect in the pipeline as it ships.
 * See `design/pass3-token-brief.md` §3.2 for the measurement.
 *
 *   (A) `ladder` is in GROUPS.  The shipped type ramp is nine unrelated role names
 *       (micro/caption/body/feature/sub/section/display/hero/nano) with no ordering — `nano` is
 *       smaller than `micro` but sorts last — so "one rung up from body" is inexpressible. This
 *       build emits a dense numeric ladder (`--ladder-space-01 … 12`, `--ladder-type-01 … 12`)
 *       that role tokens point at, so rungs have neighbours and relational operations are
 *       writable. Role tokens carry the literal string `var(--ladder-type-06)` rather than a DTCG
 *       alias `{primitive.ladder.type.06}`, deliberately: DTCG aliases are resolved at BUILD time,
 *       which turns the reference into a literal and erases the relationship from the output. A
 *       `var()` survives into CSS and can be re-pointed at runtime. An alias cannot.
 *
 *   (B) `$modes` is supported.  Upstream emits exactly one block and has no concept of a mode, so
 *       a density switch — the entire reason to have a ladder — had to be hand-written CSS in
 *       every prior pass in this repo. A top-level `$modes` object of the shape
 *
 *         "$modes": { "density": { "compact": { <any subtree of the main doc> } } }
 *
 *       emits one extra block per value, selected as
 *       `[data-variant="<variant>"][data-density="compact"]`, using the same emitters. Only the
 *       properties named in the mode are re-declared; everything else inherits.
 *
 * ONE SUBTRACTION MADE HERE, and it is the price of (B).
 *
 *   (C) `--refs` is REMOVED — about ninety lines: `USE_REFS`, `nameOfPath`, `aliasTarget`, the
 *       `asVar` closure, the two-pass `build(useRefs, emitted)` structure and the
 *       `references preserved / flattened to literals` summary. The tidycrm copy preserves a DTCG
 *       alias as `var(--target)` at build time; this copy asks the token file to write
 *       `var(--ladder-NN)` as the literal `$value` instead. That literal is what makes `$modes`
 *       work: an alias is resolved before the CSS exists and has no runtime reference a
 *       `[data-density]` block could re-point, so (B) requires this trade. The two copies are two
 *       answers to one question, not drift — pick this one when the variant needs a runtime mode,
 *       and tidycrm's when a static ramp is enough.
 *
 * WHY IT IS KEPT RATHER THAN DELETED. It produced `design/pass3-token-brief.md` and is that pass's
 * record; it is also the only `$modes`-capable copy of the emitter in the repo, and
 * `examples/tidycrm/design/build-tokens.mjs` sends the next app that needs a runtime mode switch
 * here to vendor it. Do not add a `tokens` script without also adding an importer: a build whose
 * output nothing consumes is a maintenance contract the repo does not hold.
 *
 * It is still runnable, and it still checks itself — step (5) exits non-zero if a declared token
 * produced no property, so a change here can be verified by running it:
 *
 *   node design/build-tokens.mjs token <any-out-path>.css
 *
 * The first argument names `design/tokens/<variant>.tokens.json`; `token` is the only one present.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const [variant, outArg] = process.argv.slice(2);
if (!variant || !outArg) {
  console.error("usage: node design/build-tokens.mjs <variant> <out.css>");
  process.exit(2);
}

const IN = join(HERE, "tokens", `${variant}.tokens.json`);
const OUT = resolve(HERE, outArg);

// 1) load the token file into a global path -> value map, both bare and file-namespaced.
//    `declared` is the same walk's census of every node carrying a `$value`: the
//    author's contract is that each of those becomes a custom property, and
//    step (5) checks it instead of assuming it.
const all = {};
const declared = new Set();
const doc = JSON.parse(readFileSync(IN, "utf8"));
const stem = basename(IN).replace(/\.json$/, "");
(function walk(o, p) {
  if (o && typeof o === "object") {
    if ("$value" in o) {
      all[p] = o.$value;
      all[`${stem}.${p}`] = o.$value;
      declared.add(p);
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

// 3) the colour tiers become --color-*. Primitives are deliberately NOT emitted: the three-tier
//    rule is that a component may never reference one, and the easiest way to enforce that is to
//    give it no name to reference.
function emitColor(obj, prefix, push, base) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (k.startsWith("$")) continue;
    const path = base ? `${base}.${k}` : k;
    if (v && typeof v === "object" && "$value" in v) {
      const hex = res(v.$value);
      if (typeof hex === "string" && /^(#|rgb|hsl|oklch|color-mix|var|transparent)/.test(hex)) {
        push(`--color-${prefix}${k}`, hex, path);
      }
    } else if (v && typeof v === "object") {
      emitColor(v, `${prefix}${k}-`, push, path);
    }
  }
}

// 4) the rest of the system. Colour alone is not a theme.
//    `ladder` is first: it is the numeric spine the role tokens point at. See addition (A).
const GROUPS = [
  ["primitive.ladder", "ladder-"],
  ["font.family", "font-"],
  ["font.size", "text-"],
  ["font.weight", "weight-"],
  ["font.leading", "leading-"],
  ["font.tracking", "tracking-"],
  ["space", "space-"],
  ["radius", "radius-"],
  ["border-width", "bw-"],
  ["shadow", "shadow-"],
  ["motion.duration", "duration-"],
  ["motion.easing", "ease-"],
  // Narrow on purpose. A bare `["motion", "motion-"]` would also catch duration
  // and easing and rename every property they already emit.
  ["motion.stagger", "stagger-"],
  ["size", "size-"],
  ["z", "z-"],
];
const at = (root, path) =>
  path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), root);

function cssValue(v) {
  if (Array.isArray(v)) return `cubic-bezier(${v.join(", ")})`;
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return null;
  return v.replace(/\{([^}]+)\}/g, (_, ref) => {
    const out = res(`{${ref}}`);
    return typeof out === "string" ? out : `{${ref}}`;
  });
}

function emitGroup(node, prefix, push, base) {
  // A GROUPS path may name a leaf token rather than a container — `motion.stagger`
  // is one. Then the prefix, minus its trailing separator, IS the property name.
  if (node && typeof node === "object" && "$value" in node) {
    const out = cssValue(node.$value);
    if (out !== null && !/\{[^}]+\}/.test(String(out))) push(`--${prefix.replace(/-$/, "")}`, out, base);
    return;
  }
  for (const [k, v] of Object.entries(node || {})) {
    if (k.startsWith("$")) continue;
    const path = base ? `${base}.${k}` : k;
    if (v && typeof v === "object" && "$value" in v) {
      const out = cssValue(v.$value);
      if (out !== null && !/\{[^}]+\}/.test(String(out))) push(`--${prefix}${k}`, out, path);
    } else if (v && typeof v === "object") {
      emitGroup(v, `${prefix}${k}-`, push, path);
    }
  }
}

/**
 * Render one selector's worth of declarations from any subtree shaped like the
 * main doc. `emitted` collects the source path behind every property written,
 * so step (5) can say which declared tokens produced nothing.
 */
function renderBlock(root, emitted = new Set()) {
  const lines = [];
  const seen = new Set();
  const push = (name, value, path) => {
    const decl = `  ${name}: ${value};`;
    if (path) emitted.add(path);
    if (!seen.has(decl)) {
      seen.add(decl);
      lines.push(decl);
    }
  };
  emitColor(root.semantic, "", push, "semantic");
  emitColor(root.component, "", push, "component");
  for (const [path, prefix] of GROUPS) {
    const node = at(root, path);
    if (node) emitGroup(node, prefix, push, path);
  }
  return lines;
}

const emitted = new Set();
const base = renderBlock(doc, emitted);
const blocks = [`[data-variant="${variant}"] {\n${base.join("\n")}\n}`];
let total = base.length;

// (B) modes. One extra block per attribute value, re-declaring only what the mode names.
for (const [attr, values] of Object.entries(doc.$modes || {})) {
  for (const [value, subtree] of Object.entries(values)) {
    if (value.startsWith("$")) continue;
    const lines = renderBlock(subtree);
    if (!lines.length) continue;
    total += lines.length;
    const note = subtree.$description ? `/* ${subtree.$description} */\n` : "";
    blocks.push(
      `${note}[data-variant="${variant}"][data-${attr}="${value}"] {\n${lines.join("\n")}\n}`,
    );
  }
}

const css = `/*
 * GENERATED by design/build-tokens.mjs from design/tokens/${variant}.tokens.json.
 * Do not edit by hand. Edit the DTCG source and rebuild:
 *   node design/build-tokens.mjs ${variant} <out.css>
 */
${blocks.join("\n\n")}
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, css);
console.log(
  `${variant}: wrote ${total} custom properties in ${blocks.length} block(s) -> ${outArg}`,
);

// 5) the census. GROUPS is a hand-maintained allowlist, so a source that grows a
//    node the emitter has not been taught produces nothing and the build says
//    `wrote N properties` exactly as if it had — a fail-closed allowlist with no
//    diagnostic, which is the worst combination for a token pipeline. The
//    author's contract is that a `$value` becomes a property, so the build now
//    checks it and refuses to exit 0 on a silent drop. `primitive.*` is the one
//    deliberate suppression (see step 3): the three-tier rule is enforced by
//    giving primitives no name a component could reference.
const unexplained = [...declared]
  .filter((p) => !emitted.has(p) && !p.startsWith("primitive."))
  .sort();
if (unexplained.length > 0) {
  console.error(
    `${variant}: ${unexplained.length} node(s) with a $value produced no property: ${unexplained.join(", ")}`,
  );
  console.error(
    `${variant}: add the path to GROUPS in design/build-tokens.mjs, or move it under primitive.* if it is meant to be suppressed.`,
  );
  process.exit(1);
}
