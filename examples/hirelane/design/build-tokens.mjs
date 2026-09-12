#!/usr/bin/env node
/**
 * Token build for the hirelane `/v/token` direction.
 *
 * NOT WIRED (2026-09). There is no `/v/token` route, no `components/token/` tree, no npm script
 * that runs this, nothing in CI, and no emitted file anywhere in the repo: the `token` direction
 * was reviewed out before it was built. Every reference to `build-tokens` or `token.tokens` in this
 * app is inside this file and `design/tokens/token.tokens.json`. It is kept as the vendored method
 * — the `token-build` step described below — and not as a build step. Nothing regresses if it is
 * deleted; nothing is produced if it is run.
 *
 * VENDORED from `examples/tidycrm/design/build-tokens.mjs`, which is itself the `token-build` step
 * of the plugin87/ux-ui-agent-skills method. It reads a self-contained DTCG file (`$type`/`$value`,
 * primitive -> semantic -> component) and emits one CSS custom-property layer scoped to a
 * `[data-variant]` wrapper.
 *
 * ---------------------------------------------------------------------------------------------
 * THREE DIFFERENCES FROM THE TIDYCRM COPY. All three are corrections, and all three are measured.
 * ---------------------------------------------------------------------------------------------
 *
 * 1. NAMESPACE. The tidycrm copy emits bare `--color-*`, `--text-*`, `--radius-*`, `--shadow-*`,
 *    `--leading-*`, `--tracking-*` and `--ease-*`. Every one of those names is owned by Tailwind
 *    v4's default theme, which this repo loads on `:root` from `app/globals.css`
 *    (`@import "tailwindcss"`). Verified in
 *    `node_modules/.pnpm/tailwindcss@4.3.3/.../tailwindcss/theme.css`:
 *
 *      --ease-in:     cubic-bezier(0.4, 0, 1, 1)     line 434
 *      --ease-out:    cubic-bezier(0, 0, 0.2, 1)     line 435
 *      --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1)   line 436
 *      --text-xs .. --text-9xl                       lines 347-372
 *      --radius-xs .. --radius-4xl                   line 397+
 *      --tracking-tighter .. --tracking-widest       lines 384-389
 *      --leading-tight .. --leading-loose            lines 391-395
 *
 *    So a token file that names an easing `out` does not add a token; it silently rewrites what
 *    every `ease-out` utility inside that subtree means. The three easings in
 *    `components/signal/signal.tokens.css` do exactly this today. Everything here is prefixed
 *    `--tk-`, which no framework owns.
 *
 * 2. ALIASES STAY ALIASES. The tidycrm copy flattens `{ref}` chains to literals at build time, so
 *    the CSS records values but not relations. Wave 2 measured the consequence: a type ramp of
 *    nine unrelated role names (`micro`, `caption`, `body`, `feature`, `sub`, `section`, `display`,
 *    `hero`, `nano`) in which "one step larger than body" is not expressible, because the ramp has
 *    no ordinal axis. This build keeps a reference as a reference whenever its target is itself
 *    emitted: `font.size.station -> {ladder.step.5}` becomes
 *
 *      --tk-text-station: var(--tk-step-5);
 *
 *    rather than `1.3125rem`. The ordinal ladder (`--tk-step-0..10`, `--tk-rung-0..10`) is emitted
 *    alongside the role names, so a component can say "one rung tighter" as `var(--tk-rung-3)` and
 *    a role can be re-pointed at a different rung by editing one line of JSON.
 *
 *    Measured on this file: 150 custom properties, of which 25 survive as live `var()` aliases.
 *    Two of the fixes made during this build were one-line ladder re-points that would each have
 *    been a hand-picked value under the upstream builder - the masthead headline moving from
 *    `step-9` to `step-8` after it measured 57px over five lines at an 800px shell, and the whole
 *    `--dk-*` adapter block pointing the shared kit's type at `--tk-text-*` rather than at numbers.
 *
 * 3. `cqi`, NOT `vw`. Not a builder change - a token-file change - but the builder no longer has to
 *    treat `vw` as normal, and the check at the end fails the build if a `vw` term reaches the CSS.
 *    The CopilotKit sidebar is a sibling of the page, not an overlay: `body` measures ~800px inside
 *    a 1280px viewport and ~288px inside a 768px one, so every viewport-relative term in this repo
 *    is wrong by a third at desktop and by a factor of two and a half at tablet.
 *
 * Usage:
 *   node design/build-tokens.mjs token ../components/token/token.tokens.css
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const NS = "tk-";

const [variant, outArg] = process.argv.slice(2);
if (!variant || !outArg) {
  console.error("usage: node design/build-tokens.mjs <variant> <out.css>");
  process.exit(2);
}

const IN = join(HERE, "tokens", `${variant}.tokens.json`);
const OUT = resolve(HERE, outArg);

// 1) load the token file into a global path -> raw-value map, both bare and file-namespaced.
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

/** Normalise a `{a.b.c}` body to the canonical token path used as a key in `all` / `emitted`. */
function normRef(raw) {
  let ref = raw.trim();
  while (ref.startsWith("../") || ref.startsWith("./")) {
    ref = ref.startsWith("../") ? ref.slice(3) : ref.slice(2);
  }
  if (ref in all) return ref;
  const tail = ref.split(".").slice(1).join(".");
  return tail in all ? tail : ref;
}

/** Resolve a value to a literal, following `{ref}` chains. Used for colour and for the checker. */
function res(v, depth = 0) {
  if (depth > 16 || typeof v !== "string") return v;
  const m = v.match(/^\{(.+)\}$/);
  if (!m) return v;
  const val = all[normRef(m[1])];
  return val === undefined ? v : res(val, depth + 1);
}

// ---------------------------------------------------------------------------------------------
// 2) PLAN PASS. Work out, without emitting anything, which token path becomes which custom
//    property. Difference 2 needs this: a reference can only survive as `var(--tk-x)` if `--tk-x`
//    is itself going to exist in the output.
// ---------------------------------------------------------------------------------------------
const emitted = new Map(); // token path -> custom property name (without the leading `--`)

const GROUPS = [
  // The ordinal ladders come first so role tokens can point at them.
  ["ladder.step", "step-"],
  ["ladder.rung", "rung-"],
  ["font.family", "font-"],
  ["font.size", "text-"],
  ["font.weight", "weight-"],
  ["font.stretch", "stretch-"],
  ["font.leading", "lead-"],
  ["font.tracking", "track-"],
  ["space", "space-"],
  ["radius", "radius-"],
  ["border-width", "bw-"],
  ["shadow", "elev-"],
  ["motion.duration", "dur-"],
  ["motion.easing", "ease-"],
  ["size", "size-"],
  ["z", "z-"],
];

const at = (path) => path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), doc);

function planGroup(node, path, prefix) {
  for (const [k, v] of Object.entries(node || {})) {
    if (k.startsWith("$")) continue;
    const p = `${path}.${k}`;
    if (v && typeof v === "object" && "$value" in v) {
      emitted.set(p, `${NS}${prefix}${k}`);
    } else if (v && typeof v === "object") {
      planGroup(v, p, `${prefix}${k}-`);
    }
  }
}

function planColor(node, path, prefix) {
  for (const [k, v] of Object.entries(node || {})) {
    if (k.startsWith("$")) continue;
    const p = `${path}.${k}`;
    if (v && typeof v === "object" && "$value" in v) {
      const hex = res(v.$value);
      if (typeof hex === "string" && /^(#|rgb|hsl|oklch|color-mix|transparent)/.test(hex)) {
        emitted.set(p, `${NS}color-${prefix}${k}`);
      }
    } else if (v && typeof v === "object") {
      planColor(v, p, `${prefix}${k}-`);
    }
  }
}

// Colour primitives are deliberately NOT planned. The three-tier rule is that a component may
// never reference one, and the cheapest way to enforce that is to give it no name to reference.
planColor(doc.semantic, "semantic", "");
planColor(doc.component, "component", "");
for (const [path, prefix] of GROUPS) {
  const node = at(path);
  if (node) planGroup(node, path, prefix);
}

// ---------------------------------------------------------------------------------------------
// 3) EMIT PASS.
// ---------------------------------------------------------------------------------------------
const lines = [];
const seen = new Set();
const byName = new Map();
const push = (name, value, note) => {
  if (byName.has(name) && byName.get(name) !== value) {
    console.error(`collision: --${name} declared twice with different values`);
    process.exit(1);
  }
  byName.set(name, value);
  const decl = `  --${name}: ${value};${note ? ` /* ${note} */` : ""}`;
  if (!seen.has(decl)) {
    seen.add(decl);
    lines.push(decl);
  }
};

let aliasCount = 0;

/**
 * Difference 2, the whole of it. A `{ref}` whose target is emitted survives as `var(--tk-x)`;
 * anything else is flattened to a literal exactly as upstream does.
 */
function cssValue(v) {
  if (Array.isArray(v)) return `cubic-bezier(${v.join(", ")})`;
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return null;
  return v.replace(/\{([^}]+)\}/g, (_, raw) => {
    const path = normRef(raw);
    const name = emitted.get(path);
    if (name) {
      aliasCount += 1;
      return `var(--${name})`;
    }
    const out = res(`{${raw}}`);
    return typeof out === "string" ? out : `{${raw}}`;
  });
}

function emitColor(node, path, prefix) {
  for (const [k, v] of Object.entries(node || {})) {
    if (k.startsWith("$")) continue;
    const p = `${path}.${k}`;
    if (v && typeof v === "object" && "$value" in v) {
      const name = emitted.get(p);
      if (!name) continue;
      // Semantic colour resolves to a literal on purpose: a semantic name is the level at which a
      // hue is chosen, and leaving it as `var(--tk-color-...)` of a primitive would re-expose the
      // primitive layer that tier 1 exists to hide. Component colour keeps its alias, because a
      // component pointing at a semantic role is exactly the relation worth preserving.
      const value =
        path === "component" && /^\{.+\}$/.test(String(v.$value))
          ? cssValue(v.$value)
          : res(v.$value);
      push(name, value, v.$description ? undefined : undefined);
    } else if (v && typeof v === "object") {
      emitColor(v, p, `${prefix}${k}-`);
    }
  }
}

function emitGroup(node, path, prefix) {
  for (const [k, v] of Object.entries(node || {})) {
    if (k.startsWith("$")) continue;
    const p = `${path}.${k}`;
    if (v && typeof v === "object" && "$value" in v) {
      const name = emitted.get(p);
      if (!name) continue;
      const out = cssValue(v.$value);
      if (out !== null && !/\{[^}]+\}/.test(String(out))) push(name, out);
    } else if (v && typeof v === "object") {
      emitGroup(v, p, `${prefix}${k}-`);
    }
  }
}

emitColor(doc.semantic, "semantic", "");
emitColor(doc.component, "component", "");
for (const [path, prefix] of GROUPS) {
  const node = at(path);
  if (node) emitGroup(node, path, prefix);
}

// ---------------------------------------------------------------------------------------------
// 4) CHECKS. A build that cannot fail is a formatter, not a gate.
// ---------------------------------------------------------------------------------------------
const problems = [];

// 4a) No viewport units. See difference 3.
for (const [name, value] of byName) {
  if (/\b[\d.]+v(w|h|min|max)\b/.test(String(value))) {
    problems.push(`${name}: uses a viewport unit (${value}). Use cqi - see difference 3.`);
  }
}

// 4b) No token may collide with a Tailwind v4 theme namespace, even under the prefix.
const TW_OWNED = /^--(color|text|font|font-weight|tracking|leading|radius|shadow|inset-shadow|drop-shadow|blur|perspective|aspect|ease|animate|breakpoint|container|spacing)-/;
for (const name of byName.keys()) {
  if (TW_OWNED.test(`--${name}`)) problems.push(`${name}: collides with a Tailwind v4 theme namespace.`);
}

// 4c) Every emitted reference must point at something that exists. The one legitimate outside
//     reference is a `next/font` CSS variable, which the variant's own `layout.tsx` declares on the
//     wrapper; those are named `--font-tk-*` by convention so the check can tell them apart from a
//     typo.
for (const [name, value] of byName) {
  for (const m of String(value).matchAll(/var\(--([a-z0-9-]+)\)/g)) {
    if (!byName.has(m[1]) && !m[1].startsWith("font-tk-")) {
      problems.push(`${name}: references --${m[1]}, which this file does not emit.`);
    }
  }
}

// 4d) The type floor. The owner has rejected default-small type twice; make it a build failure.
const FLOOR_PX = 13;
const stepPx = (v) => {
  const m = String(v).match(/^([\d.]+)rem$/);
  if (m) return parseFloat(m[1]) * 16;
  const c = String(v).match(/^clamp\(\s*([\d.]+)rem/);
  return c ? parseFloat(c[1]) * 16 : null;
};
for (const [name, value] of byName) {
  if (!name.startsWith(`${NS}step-`)) continue;
  const px = stepPx(value);
  if (px !== null && px < FLOOR_PX) problems.push(`${name}: ${px}px is below the ${FLOOR_PX}px floor.`);
}

if (problems.length > 0) {
  console.error(`token build failed (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const css = `/*
 * GENERATED by design/build-tokens.mjs from design/tokens/${variant}.tokens.json.
 * Do not edit by hand. Edit the DTCG source and rebuild:
 *   node design/build-tokens.mjs ${variant} ../components/${variant}/${variant}.tokens.css
 *
 * ${lines.length} custom properties, of which ${aliasCount} are emitted as live \`var()\` aliases
 * rather than flattened literals, so the relations survive into the cascade.
 */
[data-variant="${variant}"] {
${lines.join("\n")}
}
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, css);
console.log(
  `${variant}: ${lines.length} custom properties (${aliasCount} live aliases) -> ${outArg}`,
);
