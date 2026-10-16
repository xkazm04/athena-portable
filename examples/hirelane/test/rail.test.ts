/**
 * The carousel's rail opens the card under the loupe on Enter, as its own header says it does.
 *
 * `Carousel.tsx` gives the rail focus when a group opens and documents its keyboard as "Left and
 * right move the focus, Enter opens". The handler only knew the arrows: a reader who arrived by
 * keyboard could walk the deck and then had no key that opened anyone - Tab went to whichever
 * slide came first in the DOM, not the one under the loupe. Enter and Space on the rail itself now
 * open the centre card. A key aimed at a slide button is left to that button's own click, so one
 * press never opens twice.
 *
 * The runner cannot render a `.tsx`, so the rail's own `onKey` is lifted out of the source,
 * stripped of its types by Node, and run against stand-ins for the rail and the deck.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const CAROUSEL = readFileSync(
  fileURLToPath(new URL("../components/board/Carousel.tsx", import.meta.url)),
  "utf8",
);

/** `const onKey = (...) => { ... };` from the rail's key effect, braces balanced. */
function onKeySource(): string {
  const start = CAROUSEL.indexOf("const onKey = ");
  assert.ok(start >= 0, "Carousel.tsx has no onKey handler");
  const open = CAROUSEL.indexOf("{", CAROUSEL.indexOf("=>", start));
  let depth = 0;
  let i = open;
  for (; i < CAROUSEL.length; i += 1) {
    if (CAROUSEL[i] === "{") depth += 1;
    else if (CAROUSEL[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return stripTypeScriptTypes(`${CAROUSEL.slice(start, i + 1)};`);
}

interface Pressed {
  moved: number[];
  opened: string[];
  prevented: boolean;
}

function press(key: string, onRail = true): Pressed {
  const out: Pressed = { moved: [], opened: [], prevented: false };
  const el = { id: "rail" };
  const ordered = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const at = 1;
  const make = new Function("el", "ordered", "at", "move", "onOpen", `${onKeySource()}\nreturn onKey;`);
  const onKey = make(el, ordered, at, (d: number) => out.moved.push(d), (id: string) => out.opened.push(id));
  onKey({
    key,
    target: onRail ? el : { id: "slide" },
    preventDefault() {
      out.prevented = true;
    },
  });
  return out;
}

test("the arrows still move the loupe", () => {
  assert.deepEqual(press("ArrowRight").moved, [1]);
  assert.deepEqual(press("ArrowLeft").moved, [-1]);
});

test("Enter on the rail opens the card under the loupe", () => {
  const pressed = press("Enter");
  assert.deepEqual(pressed.opened, ["b"]);
  assert.equal(pressed.prevented, true);
});

test("Space on the rail opens it too, without scrolling the page", () => {
  const pressed = press(" ");
  assert.deepEqual(pressed.opened, ["b"]);
  assert.equal(pressed.prevented, true);
});

test("a key aimed at a slide button is that button's, so nothing opens twice", () => {
  const pressed = press("Enter", false);
  assert.deepEqual(pressed.opened, []);
  assert.equal(pressed.prevented, false);
});
