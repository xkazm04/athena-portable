// @vitest-environment jsdom
/**
 * The dev inspector's DOM half — README section 3.1, ADR 0086.
 *
 * `buildChain` is what a hover and a right-click read, and `isTypingTarget` is what keeps the `;`
 * `i` chord from stealing keys a person is typing; both need a DOM, so they live apart from the
 * pure tests in `locate.test.ts`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { buildChain, isTypingTarget, pickDefaultIndex } from "./locate";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("buildChain", () => {
  it("walks the stamped ancestors innermost first, skipping unstamped ones and bad stamps", () => {
    document.body.innerHTML = `
      <section data-loc="src/scenes/apps/view.tsx:40:3">
        <div>
          <span data-loc="not a stamp">
            <button data-loc="src/components/Button.tsx:12:5"><b id="hit">go</b></button>
          </span>
        </div>
      </section>`;
    const chain = buildChain(document.getElementById("hit"));
    expect(chain.map((c) => c.loc)).toEqual(["src/components/Button.tsx:12", "src/scenes/apps/view.tsx:40"]);
    expect(chain[0]?.el.tagName).toBe("BUTTON");
    expect(pickDefaultIndex(chain)).toBe(1);
  });

  it("is empty off any stamp and for no target", () => {
    document.body.innerHTML = `<div id="bare"><p>text</p></div>`;
    expect(buildChain(document.getElementById("bare"))).toEqual([]);
    expect(buildChain(null)).toEqual([]);
  });
});

describe("isTypingTarget", () => {
  it("is true for the fields a person types in and false elsewhere", () => {
    document.body.innerHTML = `<input id="i"><textarea id="t"></textarea><select id="s"></select><button id="b"></button>`;
    for (const id of ["i", "t", "s"]) expect(isTypingTarget(document.getElementById(id)), id).toBe(true);
    expect(isTypingTarget(document.getElementById("b"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(document)).toBe(false);
  });
});
