/**
 * A chore's topic page lays out cold in one budgeted task — README section 3.1 and 3.5, ADR 0089.
 *
 * Opening a chore from its row ("press Enter" in `perf:chores`) lays the page out in the same task
 * as the stage's focus move. A character the system UI face does not carry (a symbol like U+2922)
 * sends the engine through the system font-fallback search on its first use, which measured 25-30 ms
 * of that task on Windows; an inline SVG mark costs none of it. So every word the page draws keeps
 * to the scripts and punctuation the UI face holds, for every shipped playbook, and a mark is drawn.
 *
 * The rest of that task was the cold layout of the sections under the hero (about 27 ms). A page
 * opened afresh says so (`data-fresh`) and the sheet defers those sections' layout until they near
 * the view (`content-visibility: auto`); a page drawn back at a saved scroll is laid out whole, so
 * the offset it is put back to lands on the same words.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { fixtures as moduleFixtures } from "@/modules/playbooks/fixtures";

import { forgetChores, scrolls } from "./memory";
import { chorePath } from "./model";
import ChoresView from "./view";

const shipped = moduleFixtures.shipped!;

/**
 * What the system UI faces (Segoe UI, San Francisco, Roboto) all carry: Latin with its supplements,
 * general punctuation (dashes, quotes, the ellipsis) and the four plain arrows. Anything past it is
 * a glyph the engine may have to go looking for.
 */
const RANGES: [number, number][] = [
  [0x20, 0x24f], // Basic Latin through Latin Extended-B
  [0x2000, 0x206f], // General Punctuation
  [0x20ac, 0x20ac], // the euro sign
  [0x2190, 0x2193], // the four plain arrows
];
const covered = (c: string) => {
  const n = c.codePointAt(0)!;
  return n === 0x09 || n === 0x0a || RANGES.some(([lo, hi]) => n >= lo && n <= hi);
};

const textOf = (html: string) =>
  html
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ");

describe("the topic page draws nothing the UI face lacks", () => {
  it.each(shipped.items.map((v) => [v.id] as const))("%s keeps to the face's characters", (id) => {
    const html = renderToStaticMarkup(<ChoresView model={shipped} path={chorePath(id)} go={() => {}} />);
    const stray = [...new Set(textOf(html))].filter((c) => !covered(c));
    expect(stray.map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase()}`)).toEqual([]);
  });

  it("the hero's Enlarge badge draws its mark as an inline SVG, not a text glyph", () => {
    const first = shipped.items.find((v) => (v.playbook.bench?.trace ?? []).length > 0)!;
    const html = renderToStaticMarkup(<ChoresView model={shipped} path={chorePath(first.id)} go={() => {}} />);
    const badge = /<span class="pa-shot__enlarge"[^>]*>([\s\S]*?)<\/span>/.exec(html);
    expect(badge).not.toBeNull();
    expect(badge![1]).toContain("<svg");
    expect(textOf(badge![1]).trim()).toBe("Enlarge");
  });
});

describe("a page opened afresh lays out its hero first", () => {
  afterEach(() => forgetChores());
  const id = shipped.items[0]!.id;
  const page = () => /<div class="pa-page"[^>]*>/.exec(renderToStaticMarkup(<ChoresView model={shipped} path={chorePath(id)} go={() => {}} />))![0];

  it("opened from its row (no saved scroll), the page is marked fresh", () => {
    expect(page()).toContain("data-fresh");
  });

  it("drawn back at a saved scroll, the page is laid out whole", () => {
    scrolls.set(id, 640);
    expect(page()).not.toContain("data-fresh");
  });

  it("the sheet defers the sections under the hero on a fresh page, never the hero", () => {
    const css = readFileSync(new URL("./chores.css", import.meta.url), "utf8");
    const at = css.indexOf("\n.pa-page[data-fresh] .pa-topic > section:not(.pa-hero) {");
    expect(at).toBeGreaterThan(-1);
    const body = css.slice(at, css.indexOf("\n}", at));
    expect(body).toMatch(/content-visibility:\s*auto/);
    expect(body).toMatch(/contain-intrinsic-size:\s*auto \d+px/);
  });
});
