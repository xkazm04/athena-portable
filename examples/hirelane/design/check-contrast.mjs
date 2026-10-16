/**
 * The contrast floor, decided by a machine.
 *
 *   node design/check-contrast.mjs
 *
 * WHY THIS EXISTS. `design/check-law.mjs` made §9.1, §9.2 and §4.2 executable, and the note at the
 * top of it holds here too: the laws with no instrument are the ones that rot. Contrast is the
 * fourth rule in this app that is fully decidable by reading files and had nothing reading them,
 * and the cost of that was legible in the tree. `--bd-ink-4` was #6b6b77 - 3.27:1 on the panels it
 * was set on, a WCAG AA failure carrying 12px text at eighteen sites - through two reviews that
 * both named readability as THE complaint. It was then raised to #83838f and recorded as "5.3:1",
 * which was true of `--bd-void` and not of any surface the text was actually on.
 *
 * That second part is the whole design of this file. A contrast number is meaningless without the
 * background it was taken against, and a dark direction's backgrounds are mostly TRANSLUCENT - a
 * white glass plane at 4% over the ground, another at 7%, a card gradient topping out at 8% over
 * the void. Measuring against the darkest thing in the file flatters every token by roughly a
 * fifth. So this composites the planes first and scores every token against the WORST surface it
 * could land on, which is the only number that can be promised.
 *
 * WHAT IT CHECKS, per direction (a `components/<slug>/style/` tree with a `base/tokens.css`):
 *
 *   1. Every token in FLOORS is at or above its floor against the worst composited surface of the
 *      ground it is set on: the room's glass, or the inverted gated panel's sheet and fire.
 *   2. Every token in FLOORS still exists in the token block. A floor for a token somebody deleted
 *      is a check that passes by not looking, which §9.2's post-mortem is about.
 *   3. Every token in a text-carrying family (TEXT_TOKEN) has a floor in FLOORS. The mirror of 2:
 *      a token somebody added with no floor is never scored at all.
 *
 * WHAT IT DOES NOT CHECK, deliberately: which token is used where. That needs the cascade, and a
 * static reader that guessed at it would be wrong in both directions - it would miss a token used
 * on a surface it did not model, and it would fail a token used somewhere no text ever lands. The
 * floors below encode the ROLE each rung is given in `base/tokens.css`, and the role is enforced by
 * review. What this file promises is narrower and true: whatever you set in these tokens is legible
 * on every surface this direction paints.
 *
 * No value is typed here. Both the tokens and the surfaces are read out of the direction's own
 * `base/tokens.css`, so the check cannot drift from the thing it checks.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* The app root, or a fixture tree in its shape (`test/contrast-gate.test.ts` seeds one). */
const APP = process.argv[2] ? resolve(process.argv[2]) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMPONENTS = join(APP, "components");

/**
 * The floor each token has to clear, and why it has that one rather than another.
 *
 * WCAG 2.2 sets 4.5:1 for normal text and 3:1 for large text and UI components. AAA is 7:1. The
 * split below is not "AAA where we can" - it is by the size the token is set at:
 *
 *   - `ink`, `ink-2`, `ink-3` carry text at or under 15px, including the 12px `--bd-label`, so
 *     they take AAA. A 12px label at 4.6:1 is the readability complaint this app has now had
 *     three times.
 *   - `ink-4` is the quietest rung - disabled controls, a denominator, a keyboard hint. Every one
 *     of those is subordinate by design and none of them is the only copy of a fact. AA.
 *   - The four locked hues are signals before they are text (§4.2), and two of them - `auto` and
 *     `gate` - also have to survive being printed in black and white (§7.1), which is a stronger
 *     constraint than contrast. AA is the floor; all four clear 9:1 today.
 *
 * A token added here with no floor is a token nobody decided about, so the check fails on an
 * unknown token rather than skipping it.
 */
const FLOORS = {
  "--bd-ink": { floor: 7.0, role: "the primary voice" },
  "--bd-ink-2": { floor: 7.0, role: "prose and values" },
  "--bd-ink-3": { floor: 7.0, role: "labels, captions, the stage fact" },
  "--bd-ink-4": { floor: 4.5, role: "the quietest rung: disabled, denominators, hints" },
  "--bd-auto": { floor: 4.5, role: "AUTO, a reversible act" },
  "--bd-gate": { floor: 4.5, role: "GATED, an act that reaches a person" },
  "--bd-accent": { floor: 4.5, role: "structure: the level rail, a region title" },
  "--bd-mark": { floor: 4.5, role: "the borderline flag and the named gap" },
  /*
   * The inverted panel (§7.1): the one light surface in the room, holding the irreversible acts.
   * Its inks are scored against its own sheet and fire, not the room's glass - `on` names the
   * ground a token is set on, and the room is the default.
   *
   * `--bd-gate-ink-2` carries the panel's 12px class sentence and labels, and the rule above gives
   * 12px text AAA. It measures 4.76:1 on the sheet's foot stop, so its floor is AA until it is
   * retuned in `base/tokens.css` (a recorded gap in the stabilize backlog, not a decision that AA
   * is enough here). Raising this number to 7.0 is how the retune is checked.
   */
  "--bd-gate-ink": { floor: 7.0, role: "the panel's voice: button and select text", on: "gated" },
  "--bd-gate-ink-2": { floor: 4.5, role: "the panel's labels and class sentence (AAA owed)", on: "gated" },
  "--bd-gate-lit": { floor: 7.0, role: "the fire button's label", on: "fire" },
};

/**
 * The families whose every member carries text: the ink ladder and the locked hues.
 *
 * This is what makes "fails on an unknown token" true. The loop below reads FLOORS, so on its own
 * it could only ever score the tokens somebody had already listed - a fifth rung at 2:1 went
 * unscored and `lint` stayed green. Every declared token matching this is asked for its floor.
 */
const TEXT_TOKEN = /^--bd-(?:ink(?:-\d+)?|auto|gate|accent|mark|gate-ink(?:-\d+)?|gate-lit)$/;

/**
 * The grounds, and the translucent planes laid over them.
 *
 * `over` is the plane's own token; `on` is what it is composited against. This is the model, and
 * it is the one thing in this file that is knowledge rather than measurement - it says which
 * backgrounds the direction actually paints. When a direction adds a surface, it is added here.
 */
const SURFACES = [
  { name: "void", solid: "--bd-void" },
  { name: "ground", solid: "--bd-ground" },
  { name: "sheet", solid: "--bd-sheet" },
  { name: "glass on ground", over: "--bd-glass", on: "--bd-ground" },
  { name: "glass-2 on ground", over: "--bd-glass-2", on: "--bd-ground" },
  /* A slide's own gradient, at its lightest stop. `level1/l1-carousel.css` paints it from
     `--bd-slide-top` and `--bd-slide-foot`; the top stop is the lighter one and therefore the
     unkind one, and it is read by name like every other plane here. It used to be `alpha: 0.08`,
     typed in this file beside a comment saying it was read from the stylesheet. */
  { name: "card top on void", over: "--bd-slide-top", on: "--bd-void" },
  /* The inverted panel's ground: every stop of `--bd-gate-sheet`, read out of the gradient. The
     washes laid on it are lighter still, so a dark ink's worst case is the darker stop. */
  { name: "gated sheet", stops: "--bd-gate-sheet", ground: "gated" },
  /* The fire button, armed and hovered. */
  { name: "fire", solid: "--bd-gate-fire", ground: "fire" },
  { name: "fire, hovered", solid: "--bd-gate-fire-2", ground: "fire" },
];

const parseHex = (hex) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
};

const channel = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (rgb) => {
  const [r, g, b] = rgb.map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = luminance(a) >= luminance(b) ? [luminance(a), luminance(b)] : [luminance(b), luminance(a)];
  return (hi + 0.05) / (lo + 0.05);
};
/** Source-over: a plane of `rgb` at `alpha` laid on `bg`. */
const composite = (rgb, alpha, bg) => rgb.map((v, i) => v * alpha + bg[i] * (1 - alpha));

/** `--bd-glass: rgb(255 255 255 / 4%)` -> { rgb, alpha }. Also accepts a plain hex. */
function parsePlane(value) {
  const rgba = /rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\/\s*([\d.]+)%\s*\)/.exec(value);
  if (rgba) {
    return {
      rgb: [rgba[1], rgba[2], rgba[3]].map((n) => Number(n) / 255),
      alpha: Number(rgba[4]) / 100,
    };
  }
  if (/^#[0-9a-fA-F]{3,8}$/.test(value.trim())) return { rgb: parseHex(value.trim()), alpha: 1 };
  return null;
}

/** Blank comment bodies so a token quoted in prose is not read as a declaration. */
const blankComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

function tokensOf(file) {
  const source = blankComments(readFileSync(file, "utf8"));
  const out = new Map();
  for (const [, name, value] of source.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    if (!out.has(name)) out.set(name, value.trim());
  }
  return out;
}

function directions() {
  if (!existsSync(COMPONENTS)) return [];
  return readdirSync(COMPONENTS)
    .filter((slug) => existsSync(join(COMPONENTS, slug, "style", "base", "tokens.css")))
    .sort();
}

let failed = false;
const found = directions();
if (found.length === 0) {
  console.log("check-contrast - no direction with a components/<slug>/style/base/tokens.css.");
  process.exit(0);
}

for (const slug of found) {
  const file = join(COMPONENTS, slug, "style", "base", "tokens.css");
  const tokens = tokensOf(file);
  console.log(`check-contrast  ${slug}  (${relative(APP, file).replace(/\\/g, "/")})`);

  // Build the surface set first: a missing ground is a broken model, not a failing token.
  const surfaces = [];
  for (const surface of SURFACES) {
    const ground = surface.ground ?? "room";
    if (surface.stops) {
      // A gradient is as many surfaces as it has stops; a stop this file cannot read is a broken model.
      const stops = [...(tokens.get(surface.stops) ?? "").matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
      if (stops.length < 2) {
        console.log(`  MODEL  ${surface.name}: ${surface.stops} has no gradient stops this file can read`);
        failed = true;
        continue;
      }
      stops.forEach((hex, i) => surfaces.push({ name: `${surface.name} ${i + 1}/${stops.length}`, rgb: parseHex(hex), ground }));
      continue;
    }
    const base = parsePlane(tokens.get(surface.on ?? surface.solid) ?? "");
    if (!base) {
      console.log(`  MODEL  ${surface.name}: ${surface.on ?? surface.solid} is not a colour this file can read`);
      failed = true;
      continue;
    }
    if (surface.solid) {
      surfaces.push({ name: surface.name, rgb: base.rgb, ground });
      continue;
    }
    const plane = parsePlane(tokens.get(surface.over) ?? "");
    if (!plane) {
      console.log(`  MODEL  ${surface.name}: ${surface.over} is not a colour this file can read`);
      failed = true;
      continue;
    }
    surfaces.push({ name: surface.name, rgb: composite(plane.rgb, plane.alpha, base.rgb), ground });
  }
  if (surfaces.length === 0) {
    failed = true;
    continue;
  }

  const width = Math.max(...Object.keys(FLOORS).map((t) => t.length));
  for (const name of tokens.keys()) {
    if (!TEXT_TOKEN.test(name) || name in FLOORS) continue;
    console.log(`  NOFLOOR ${name.padEnd(width)}  carries text and has no floor here: give it one in FLOORS`);
    failed = true;
  }
  for (const [name, { floor, role, on = "room" }] of Object.entries(FLOORS)) {
    const declared = tokens.get(name);
    if (!declared) {
      console.log(`  GONE   ${name.padEnd(width)}  has a floor here and no declaration in the token block`);
      failed = true;
      continue;
    }
    const rgb = parsePlane(declared)?.rgb;
    if (!rgb) {
      console.log(`  UNREAD ${name.padEnd(width)}  ${declared} is not a colour this file can read`);
      failed = true;
      continue;
    }
    let worst = { ratio: Infinity, on: `no ${on} surface` };
    for (const surface of surfaces.filter((s) => s.ground === on)) {
      const ratio = contrast(rgb, surface.rgb);
      if (ratio < worst.ratio) worst = { ratio, on: surface.name };
    }
    if (worst.ratio === Infinity) {
      console.log(`  MODEL  ${name.padEnd(width)}  is set on "${on}" and no surface in SURFACES is one`);
      failed = true;
      continue;
    }
    const over = worst.ratio < floor;
    if (over) failed = true;
    console.log(
      `  ${over ? "UNDER " : "ok    "} ${name.padEnd(width)} ${declared.padEnd(9)} ` +
        `${worst.ratio.toFixed(2).padStart(6)}:1 on ${worst.on.padEnd(18)} ` +
        `floor ${floor.toFixed(1)}${over ? "  <-- UNDER" : ""}   ${role}`,
    );
  }
}

if (failed) {
  console.log("\nA token below its floor is not a style choice. Raise the value, or - if the token's");
  console.log("role genuinely changed - change its floor in design/check-contrast.mjs and say why.");
}
process.exit(failed ? 1 : 0);
