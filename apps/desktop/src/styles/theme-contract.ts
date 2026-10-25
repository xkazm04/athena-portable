/**
 * The theme contract — README section 3.1, ADR 0023 (contrast) and 0142 (skins).
 *
 * One place reads the colour contract off the real sheets. The binding sets are derived, not
 * listed: every theme in `THEMES` times every skin in `SKINS`, checked against the sheets that sit
 * in `styles/skins/`. Each set is resolved through the cascade the webview applies (the base sheet,
 * then the skin's, a later rule winning a tie of specificity, `var()` chains followed), and three
 * things are judged on what comes out:
 *
 *   1. **The floor.** Every text pair reads at 4.5:1 and every graphic pair at 3:1, from one list.
 *   2. **Completeness.** Every role the base dark block declares resolves in every set.
 *   3. **Both states.** A role a skin binds in one theme only is reported: the skin's light block
 *      sits over its dark block, so a role it omits paints the skin's dark value in light, silently.
 *
 * Pure: it takes the sheets' text, so a test can hand it a fixture and watch it go red. It never
 * returns an empty, green answer for nothing — no theme block, no set, is a thrown error.
 */
import { DEFAULT_SKIN, SKINS, THEMES } from "@/stores/shell";

export interface BindingSet {
  skin: string;
  theme: string;
  /** `skin/theme`, the name a finding uses. */
  id: string;
}

/** A pair of roles and the ratio it must clear: ink on ground. */
export type Pair = readonly [ink: string, ground: string, floor: number];

const TEXT = 4.5;
const GRAPHIC = 3;

function pairs(inks: string[], grounds: string[], floor: number): Pair[] {
  return inks.flatMap((ink) => grounds.map((ground) => [ink, ground, floor] as const));
}

const STATUS = ["--status-success", "--status-warning", "--status-error", "--status-info", "--status-pending", "--status-neutral"];

/**
 * The one pair list. A status word is read at prose contrast on a card, the hue a second channel
 * (app.css says so beside the light statuses; this is where it is held); a status dot or the focus
 * ring is a shape, 3:1, on the card and the recessed rung.
 */
export const PAIRS: readonly Pair[] = [
  ...pairs(["--foreground", "--muted-foreground"], ["--background", "--card-bg", "--card-raised", "--recessed"], TEXT),
  ...pairs(["--accent-text", "--primary"], ["--background", "--card-bg", "--recessed"], TEXT),
  ["--muted", "--background", TEXT],
  ["--primary-fg", "--primary", TEXT],
  ["--on-primary", "--btn-primary", TEXT],
  ...pairs(STATUS, ["--card-bg"], TEXT),
  ...pairs([...STATUS, "--focus"], ["--card-bg", "--recessed"], GRAPHIC),
];

/**
 * Every theme times every skin, against the sheets on disk (their ids, without `.css`). The default
 * skin is the product's own and is bound by app.css, so it needs no sheet; every other skin does,
 * and every sheet needs its skin. Either gap throws, naming it.
 */
export function bindingSets(
  sheets: readonly string[],
  shell: { themes?: readonly string[]; skins?: readonly string[]; defaultSkin?: string } = {},
): BindingSet[] {
  const themes = shell.themes ?? THEMES;
  const skins = shell.skins ?? SKINS;
  const defaultSkin = shell.defaultSkin ?? DEFAULT_SKIN;
  const gaps = [
    ...skins.filter((s) => s !== defaultSkin && !sheets.includes(s)).map((s) => `SKINS entry "${s}" has no styles/skins/${s}.css`),
    ...sheets.filter((s) => !skins.includes(s)).map((s) => `styles/skins/${s}.css has no SKINS entry`),
  ];
  if (gaps.length > 0) throw new Error(gaps.join("; "));
  const sets = skins.flatMap((skin) => themes.map((theme) => ({ skin, theme, id: `${skin}/${theme}` })));
  if (sets.length === 0) throw new Error("no binding set");
  return sets;
}

interface Decl {
  prop: string;
  value: string;
  /** Specificity of the selector that matched, as one number (attributes and `:root` count alike). */
  weight: number;
  order: number;
}

interface RootRule {
  /** The attributes each selector of the rule requires of the root, one map per selector. */
  selectors: Map<string, string>[];
  decls: [string, string][];
  order: number;
}

const ROOT_SELECTOR = /^(:root)?((?:\[data-[a-z-]+="[^"]*"\])*)$/;

/** The top-level rules whose every selector targets the root element alone. At-rules are skipped. */
function rootRules(css: string, start: number): RootRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: RootRule[] = [];
  let i = 0;
  let order = start;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open === -1) break;
    const head = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    const body = text.slice(open + 1, j - 1);
    i = j;
    if (head.startsWith("@")) continue;
    const selectors: Map<string, string>[] = [];
    for (const s of head.split(",").map((x) => x.trim())) {
      const m = ROOT_SELECTOR.exec(s);
      if (!m || s === "") continue;
      const attrs = new Map<string, string>();
      if (m[1]) attrs.set(":root", "");
      for (const a of m[2]!.matchAll(/\[(data-[a-z-]+)="([^"]*)"\]/g)) attrs.set(a[1]!, a[2]!);
      selectors.push(attrs);
    }
    if (selectors.length === 0) continue;
    const decls = body
      .split(";")
      .map((d) => d.trim())
      .filter((d) => d.startsWith("--"))
      .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()] as [string, string]);
    out.push({ selectors, decls, order: order++ });
  }
  return out;
}

/** The weight of the most specific selector of `rule` that matches the root of `set`, or -1. */
function match(rule: RootRule, set: BindingSet): number {
  let best = -1;
  for (const attrs of rule.selectors) {
    let ok = true;
    for (const [name, value] of attrs) {
      if (name === "data-theme" && value !== set.theme) ok = false;
      else if (name === "data-skin" && value !== set.skin) ok = false;
      else if (name !== ":root" && name !== "data-theme" && name !== "data-skin") ok = false;
    }
    if (ok) best = Math.max(best, attrs.size);
  }
  return best;
}

/** The winning declaration of every custom property in `set`. */
function cascade(rules: RootRule[], set: BindingSet): Map<string, Decl> {
  const won = new Map<string, Decl>();
  for (const rule of rules) {
    const weight = match(rule, set);
    if (weight < 0) continue;
    for (const [prop, value] of rule.decls) {
      const prev = won.get(prop);
      if (!prev || weight > prev.weight || (weight === prev.weight && rule.order >= prev.order)) {
        won.set(prop, { prop, value, weight, order: rule.order });
      }
    }
  }
  return won;
}

const VAR = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/;

/** A role's value with every `var()` followed, or null when a chain ends nowhere or loops. */
function resolve(won: Map<string, Decl>, prop: string, seen: Set<string> = new Set()): string | null {
  const decl = won.get(prop);
  if (!decl || seen.has(prop)) return null;
  const next = new Set(seen).add(prop);
  let value = decl.value;
  for (let m = VAR.exec(value); m; m = VAR.exec(value)) {
    const inner = resolve(won, m[1]!, next) ?? (m[2] !== undefined ? m[2].trim() : null);
    if (inner === null) return null;
    value = value.slice(0, m.index) + inner + value.slice(m.index + m[0].length);
  }
  return value;
}

/** An opaque colour as [r, g, b], or null. */
function rgb(value: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join("") : hex[1]!;
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(1|1\.0+))?\s*\)$/i.exec(value);
  return fn ? [Number(fn[1]), Number(fn[2]), Number(fn[3])] : null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** The WCAG contrast ratio of two opaque colours. */
export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Roles a skin binds in one theme only. The first theme is the one its unnamed block stands for. */
function oneState(rules: RootRule[], skin: string, themes: readonly string[]): string[] {
  const own = new Map<string, Set<string>>(themes.map((t) => [t, new Set()]));
  for (const rule of rules) {
    for (const attrs of rule.selectors) {
      if (attrs.get("data-skin") !== skin) continue;
      const theme = attrs.get("data-theme") ?? themes[0]!;
      for (const [prop] of rule.decls) own.get(theme)?.add(prop);
    }
  }
  const all = new Set([...own.values()].flatMap((s) => [...s]));
  const out: string[] = [];
  for (const theme of themes) {
    for (const prop of all) {
      if (own.get(theme)!.has(prop)) continue;
      const from = theme !== themes[0] && own.get(themes[0]!)!.has(prop) ? `the skin's ${themes[0]} value` : `the base ${theme} value`;
      out.push(`${skin}/${theme}: ${prop} takes ${from}`);
    }
  }
  return out;
}

/** One decimal, rounded down, so a failing ratio is never printed at the floor it missed. */
const shown = (r: number) => (Math.floor(r * 10) / 10).toFixed(1);

/**
 * Judge every set over the base sheet and the skin sheets (by skin id). Returns the findings, each a
 * sentence naming the set and the roles; an empty list is a pass. A base sheet with no theme block
 * throws `no binding set`.
 */
export function checkThemeContract(input: { base: string; skins: Record<string, string>; sets: readonly BindingSet[] }): string[] {
  const base = rootRules(input.base, 0);
  const darkBlock = base.find((r) => r.selectors.some((a) => a.get("data-theme") === "dark"));
  if (!darkBlock || input.sets.length === 0) throw new Error("no binding set");
  const themes = [...new Set(input.sets.map((s) => s.theme))];
  const rules = [...base];
  const findings: string[] = [];
  for (const [skin, css] of Object.entries(input.skins)) {
    const own = rootRules(css, rules.length);
    rules.push(...own);
    findings.push(...oneState(own, skin, themes));
  }
  const roles = darkBlock.decls.map(([prop]) => prop);
  for (const set of input.sets) {
    const won = cascade(rules, set);
    for (const role of roles) {
      if (resolve(won, role) === null) findings.push(`${role} unresolved in ${set.id}`);
    }
    for (const [ink, ground, floor] of PAIRS) {
      const a = resolve(won, ink);
      const b = resolve(won, ground);
      const ca = a === null ? null : rgb(a);
      const cb = b === null ? null : rgb(b);
      if (!ca || !cb) {
        findings.push(`${set.id} ${ca ? ground : ink} is not an opaque colour (${(ca ? b : a) ?? "unresolved"})`);
        continue;
      }
      const r = contrast(ca, cb);
      if (r < floor) findings.push(`${set.id} ${ink} on ${ground} ${shown(r)} < ${floor}`);
    }
  }
  return findings;
}
