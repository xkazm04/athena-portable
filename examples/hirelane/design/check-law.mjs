/**
 * The three DESIGN-LAW rules a machine can decide, decided by a machine.
 *
 *   node design/check-law.mjs
 *
 * WHY THIS EXISTS. CI binds `typecheck`, `lint` and `build` for this app, so TypeScript and
 * JavaScript are genuinely gated. Nothing read a stylesheet. The two laws this repo wrote down most
 * precisely - §9.1 (zero raw pixel values outside the token block) and §4.2 (the palette is locked;
 * no new colour in a component file) - had no instrument at all, which is how 27 raw values and 9
 * off-lock colours accumulated without a single red run. The third, §9.2, had a written command
 * that could not match its own violations. All three are decidable by reading files in the repo,
 * which is the property that makes a check safe to block on.
 *
 * WHAT IT CHECKS, per direction (a `components/<slug>/style/` tree with a `base/tokens.css`):
 *
 *   1. §9.1  raw px   - a literal px length outside the direction's token block. Comments are
 *                       blanked before matching, and a line may be exempted by writing
 *                       `§9.4 exception: <reason>` on it or within the two lines above it - which
 *                       is the escape §9.4 already grants, made executable.
 *   2. §9.2  .dk-*    - a `.dk-*` CLASS selector redefined in a variant stylesheet (§1.6). The
 *                       match requires the opening brace, so a stylesheet may still explain the
 *                       rule it obeys in a comment.
 *   3. §4.2  colours  - a hex or rgb() literal outside the token block. #000 and #fff inside a
 *                       mask-image or a box-shadow are alpha stops and ring geometry rather than
 *                       palette, and are exempt.
 *   4. §9.1  motion   - a raw duration, delay or spring constant typed into a `.ts`/`.tsx` file
 *                       under the direction. §1.3 is a scale exactly as §1.1 is, and until this
 *                       pass nothing read a TypeScript file: five hand-tuned spring constants and
 *                       two durations sat in `components/board/motion.ts` for three rounds without
 *                       a red run, because the instrument only opened stylesheets. A direction's
 *                       motion token block - `components/<slug>/motion.ts` - is the one file a
 *                       number may be typed in, exactly as `style/base/tokens.css` is for CSS, and
 *                       the same `§9.4 exception:` marker exempts a line anywhere else.
 *
 * The tree is clean on all three today, so every count is an absolute zero rather than a baseline
 * to ratchet down. If a direction ever lands with debt, give it a `design/law-baseline.json` of
 * `{ "<slug>": { "rawPx": n, "dkOverrides": 0, "offLockColours": n } }` and this will compare
 * against that instead - but `dkOverrides` is never allowed above zero, because §1.6 admits no
 * exception.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMPONENTS = join(APP, "components");
const BASELINE_FILE = join(APP, "design", "law-baseline.json");

const EXEMPTION = "§9.4 exception";
/**
 * A px literal that is a length.
 *
 * The leading class excludes letters, digits and `-` so the match cannot start inside an
 * identifier or a custom-property name. It deliberately does NOT exclude `(`: a number written
 * inside `min()`, `clamp()` or `blur()` is still a number somebody typed.
 */
const RAW_PX = /[^-a-z0-9]\d+(\.\d+)?px/;
/** A `.dk-*` class selector opening a rule. The brace is what separates a selector from prose. */
const DK_RULE = /(^|[^-a-zA-Z0-9_`])\.dk-[a-zA-Z0-9_-]+[^{]*\{/;
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/;
/** Alpha stops and ring geometry, not palette. */
const NOT_PALETTE = /mask-image|box-shadow|\brgba?\(\s*255\s+255\s+255\s*\/|\brgba?\(\s*0\s+0\s+0\s*\//;

/**
 * A motion value typed as a literal in TypeScript.
 *
 * The keys are the ones `motion/react` reads a time or a curve from, and the match requires a
 * NUMERIC literal after them, so `duration: secs(DUR[3])`, `delay: HOLD` and
 * `transition={zoom}` all pass while `duration: 0.18` and `stiffness: 260` do not. `ms` and
 * `s`-suffixed literals inside a `setTimeout` are not motion and are not matched: the key list is
 * the whole of the rule.
 */
const RAW_MOTION =
  /\b(duration|delay|delayChildren|staggerChildren|repeatDelay|stiffness|damping|mass|velocity|bounce)\s*:\s*-?\d/;
/** A named curve is a token; a bezier typed at a call site is four numbers somebody guessed. */
const RAW_EASE = /\bease\s*:\s*\[/;

function walk(dir, ext = ".css") {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path, ext));
    else if (Array.isArray(ext) ? ext.some((e) => path.endsWith(e)) : path.endsWith(ext)) {
      out.push(path);
    }
  }
  return out;
}

/** Blank comment bodies while keeping every line number and column intact. */
const blankComments = (css) =>
  css.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));

function directions() {
  if (!existsSync(COMPONENTS)) return [];
  return readdirSync(COMPONENTS)
    .filter((slug) => existsSync(join(COMPONENTS, slug, "style", "base", "tokens.css")))
    .sort();
}

/**
 * §9.1 for motion: the direction's `.ts`/`.tsx`, minus its own motion token block.
 *
 * Comments are blanked the same way the stylesheets' are, so the file that explains why
 * `stiffness: 260` was wrong may go on saying so.
 */
function checkMotion(slug) {
  const root = join(COMPONENTS, slug);
  const tokenModule = join(root, "motion.ts");
  const failures = [];
  let rawMotion = 0;

  for (const file of walk(root, [".ts", ".tsx"]).sort()) {
    if (file === tokenModule) continue;
    const source = readFileSync(file, "utf8");
    const raw = source.split("\n");
    /* `//` as well as `/* *\/`: a TypeScript file explains itself in both. */
    const code = blankComments(source)
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""));
    const where = (i) => `${relative(APP, file).replace(/\\/g, "/")}:${i + 1}`;
    const exempt = (i) => raw.slice(Math.max(0, i - 2), i + 1).some((l) => l.includes(EXEMPTION));

    code.forEach((line, i) => {
      if (exempt(i)) return;
      if (RAW_MOTION.test(line) || RAW_EASE.test(line)) {
        rawMotion += 1;
        failures.push(`  §9.1  ${where(i)}  raw motion value: ${line.trim()}`);
      }
    });
  }
  return { rawMotion, failures };
}

function checkDirection(slug) {
  const root = join(COMPONENTS, slug, "style");
  const tokens = join(root, "base", "tokens.css");
  const failures = [];
  let rawPx = 0;
  let dkOverrides = 0;
  let offLockColours = 0;

  for (const file of walk(root).sort()) {
    const source = readFileSync(file, "utf8");
    const raw = source.split("\n");
    const code = blankComments(source).split("\n");
    const where = (i) => `${relative(APP, file).replace(/\\/g, "/")}:${i + 1}`;
    const exempt = (i) => raw.slice(Math.max(0, i - 2), i + 1).some((l) => l.includes(EXEMPTION));
    const isTokenBlock = file === tokens;

    code.forEach((line, i) => {
      if (DK_RULE.test(line)) {
        dkOverrides += 1;
        failures.push(`  §9.2  ${where(i)}  .dk-* class redefined: ${line.trim()}`);
      }
      if (isTokenBlock || exempt(i)) return;
      if (RAW_PX.test(line)) {
        rawPx += 1;
        failures.push(`  §9.1  ${where(i)}  raw px: ${line.trim()}`);
      }
      if (COLOUR.test(line) && !NOT_PALETTE.test(line)) {
        offLockColours += 1;
        failures.push(`  §4.2  ${where(i)}  colour outside the token block: ${line.trim()}`);
      }
    });
  }
  const motion = checkMotion(slug);
  return {
    slug,
    rawPx,
    dkOverrides,
    offLockColours,
    rawMotion: motion.rawMotion,
    failures: [...failures, ...motion.failures],
  };
}

const baselines = existsSync(BASELINE_FILE)
  ? JSON.parse(readFileSync(BASELINE_FILE, "utf8"))
  : {};

let failed = false;
const found = directions();
if (found.length === 0) {
  console.log("design:check - no direction with a components/<slug>/style/base/tokens.css. Nothing to check.");
  process.exit(0);
}

for (const slug of found) {
  const result = checkDirection(slug);
  const allowed = baselines[slug] ?? { rawPx: 0, dkOverrides: 0, offLockColours: 0, rawMotion: 0 };
  const over = (key) => result[key] > (key === "dkOverrides" ? 0 : (allowed[key] ?? 0));
  const line = (key, law) =>
    `  ${law.padEnd(5)} ${key.padEnd(15)} ${String(result[key]).padStart(3)} (allowed ${
      key === "dkOverrides" ? 0 : (allowed[key] ?? 0)
    })${over(key) ? "  <-- OVER" : ""}`;

  console.log(`design:check  ${slug}`);
  console.log(line("rawPx", "§9.1"));
  console.log(line("rawMotion", "§9.1"));
  console.log(line("dkOverrides", "§9.2"));
  console.log(line("offLockColours", "§4.2"));

  if (over("rawPx") || over("rawMotion") || over("dkOverrides") || over("offLockColours")) {
    failed = true;
    console.log(result.failures.join("\n"));
  }
}

if (failed) {
  console.log("\nDESIGN-LAW §9.1 / §9.2 / §4.2: see ../DESIGN-LAW.md. A value that is genuinely not");
  console.log("a scale value is exempted by writing `§9.4 exception: <reason>` beside it.");
}
process.exit(failed ? 1 : 0);
