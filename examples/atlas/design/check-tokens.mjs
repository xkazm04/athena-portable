/**
 * The design law, made executable: no raw `px` and no raw `ms` outside the token block.
 *
 * DESIGN.md §9 bans them and §8 says "no JavaScript in this app types a millisecond". A ban
 * nobody runs is a preference, so this runs: `pnpm --filter atlas lint` is `eslint .` AND this.
 * It is the same move tidycrm made with `design/check-contrast.mjs` (ADR 0023) — the check that
 * enforces a design rule belongs beside the design file, chained into the gate.
 *
 * WHAT IT CHECKS
 *
 *   1. every `<n>px` and `<n>ms` literal in a stylesheet or a .ts/.tsx file, except in
 *      `style/base/tokens.css`, which is the one authority;
 *   2. that every `--at-*` custom property a file USES is declared in that token file, so a
 *      typo'd token (which CSS silently resolves to nothing) fails the build instead of the eye;
 *   3. that the four duration tokens the formula's clock is made of are all declared;
 *   4. that every literal in an `@container` / `@media` CONDITION equals one of the declared
 *      `--at-bp-*` breakpoints. A query condition cannot read a custom property — that is a CSS
 *      limitation, not a choice — so the literal is allowed there and only there, and only when
 *      the token file already names it. Two breakpoints, written down once, still holds.
 *
 * Exit 1 with a list, exit 0 with a count. No dependencies.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TOKEN_FILE = join(ROOT, "components/atlas/style/base/tokens.css");
const SKIP_DIRS = new Set(["node_modules", ".next", "data", "design", "test"]);

/**
 * THE ONE EXEMPTION FROM THE `px` BAN, and it is about a coordinate system rather than a
 * preference.
 *
 * Inside `.at-c3-world` the CSS 3D renderer applies `scale3d(unit)` (see `scene/project.ts`,
 * `cssView`), so every length below that element is a SCENE UNIT and not a pixel: a block nine
 * units tall is written `height: 9px` and measures nine units. Banning `px` there would be
 * banning the scene's own unit of measurement, and replacing each one with a token would put
 * the machine's geometry in the token file, where it does not belong — the geometry is computed
 * in `scene/layout.ts` and tested.
 *
 * The exemption is `px` only. Every `ms` in the file is still a token, and every `--at-*` it
 * uses must still be declared.
 */
const SCENE_UNIT_FILES = new Set(["components/atlas/style/scene/css3d.css"]);
const EXTS = [".css", ".ts", ".tsx"];

/** `0px` and `0ms` are the same value in any unit and read as "none"; they are not a clock. */
const RAW = /(?<![\w-])(\d*\.?\d+)(px|ms)\b/g;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (EXTS.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

const tokenSource = readFileSync(TOKEN_FILE, "utf8");
const declared = new Set([...tokenSource.matchAll(/(--at-[\w-]+)\s*:/g)].map((m) => m[1]));
/** The declared breakpoint VALUES, e.g. "720px" — the only literals a query condition may use. */
const breakpoints = new Set(
  [...tokenSource.matchAll(/--at-bp-[\w-]+\s*:\s*([^;]+);/g)].map((m) => m[1].trim()),
);

const problems = [];
let scanned = 0;

for (const file of walk(ROOT)) {
  if (file === TOKEN_FILE) continue;
  scanned += 1;
  const text = readFileSync(file, "utf8");
  const where = relative(ROOT, file).replaceAll("\\", "/");

  for (const m of text.matchAll(RAW)) {
    if (Number(m[1]) === 0) continue;
    const line = text.slice(0, m.index).split("\n").length;
    const source = text.split("\n")[line - 1] ?? "";
    /* A query CONDITION cannot read a custom property — a CSS limitation, not a choice — so the
       literal is allowed there, and only when the token file already names it as a breakpoint. */
    if (/^\s*@(container|media)\b/.test(source)) {
      if (breakpoints.has(m[0])) continue;
      problems.push(
        `${where}:${line}  breakpoint "${m[0]}" is not a declared --at-bp-* value (${[...breakpoints].join(", ")})`,
      );
      continue;
    }
    if (m[2] === "px" && SCENE_UNIT_FILES.has(where)) continue;
    problems.push(`${where}:${line}  raw "${m[0]}" — use an --at-* token (DESIGN.md §9)`);
  }

  for (const m of text.matchAll(/var\((--at-[\w-]+)/g)) {
    if (declared.has(m[1])) continue;
    const line = text.slice(0, m.index).split("\n").length;
    problems.push(`${where}:${line}  undeclared token ${m[1]} — not in style/base/tokens.css`);
  }
}

/* The clock itself: the durations the layered-UI formula's rule 4 is made of, plus round 3's
   beat — the turn's own unit, and the only clock in this app that is content rather than chrome. */
for (const name of ["--at-dur-hair", "--at-dur-ink", "--at-dur-lens", "--at-dur-move", "--at-dur-beat"]) {
  if (!declared.has(name)) problems.push(`tokens.css  missing ${name} — the clock is incomplete`);
}

/*
 * Check 5: the ONE number `motion.ts` is allowed to hold — the beat's pre-cascade fallback —
 * must equal the token it stands in for. `useTokens` answers 0 during the server render, and a
 * turn on a zero clock is a turn nobody can watch, so the fallback exists; a fallback that has
 * drifted from the token is two clocks, which is precisely what rule 4 forbids.
 */
{
  const token = /--at-dur-beat\s*:\s*(\d+)ms/.exec(tokenSource)?.[1];
  const motion = readFileSync(join(ROOT, "components/atlas/motion.ts"), "utf8");
  const fallback = /FALLBACK_BEAT\s*=\s*(\d+)/.exec(motion)?.[1];
  if (token && fallback && token !== fallback) {
    problems.push(
      `motion.ts  FALLBACK_BEAT is ${fallback} but --at-dur-beat is ${token}ms — one clock, rule 4`,
    );
  }
}

if (problems.length > 0) {
  console.error(`design/check-tokens: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}

console.log(
  `design/check-tokens: ok — ${scanned} files, ${declared.size} tokens declared, no raw px/ms outside the token block.`,
);
