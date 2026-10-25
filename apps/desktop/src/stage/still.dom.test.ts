// @vitest-environment jsdom
/** Tests for a leaving layer's still — README section 3.1, ADR 0193. */
import { afterEach, expect, it, vi } from "vitest";

import { captureStill, showStill } from "./still";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function layer(html: string): HTMLElement {
  const el = document.createElement("section");
  el.innerHTML = html;
  document.body.append(el);
  return el;
}

it("copies the markup and leaves the source untouched", () => {
  const src = layer(`<div class="scene"><h2 id="title">Apps</h2><button autofocus>Open</button></div>`);
  const before = src.innerHTML;
  const still = captureStill(src);
  expect(src.innerHTML).toBe(before);
  const into = layer("");
  showStill(into, still);
  expect(into.querySelector("h2")!.textContent).toBe("Apps");
  expect(into.querySelector("h2")).not.toBe(src.querySelector("h2"));
});

it("strips HTML ids, autofocus and autoplay, so the copy cannot collide with the arriving scene", () => {
  const src = layer(`<div id="a"><input id="b" autofocus><video autoplay></video><svg><defs><linearGradient id="g"/></defs></svg></div>`);
  const into = layer("");
  showStill(into, captureStill(src));
  expect(into.querySelector("[id]:not(linearGradient)")).toBeNull();
  expect(into.querySelector("[autofocus], [autoplay]")).toBeNull();
  // An SVG keeps its ids: its fills reference them.
  expect(into.querySelector("linearGradient")!.getAttribute("id")).toBe("g");
});

it("carries no listener: a click on the copy reaches nothing the scene registered", () => {
  const src = layer(`<button>Go</button>`);
  const onClick = vi.fn();
  src.querySelector("button")!.addEventListener("click", onClick);
  const into = layer("");
  showStill(into, captureStill(src));
  into.querySelector("button")!.click();
  expect(onClick).not.toHaveBeenCalled();
});

it("keeps what a field holds and where a scroller was", () => {
  const src = layer(`<input value="a"><div class="list" style="overflow:auto"><p>row</p></div>`);
  src.querySelector("input")!.value = "typed";
  src.querySelector<HTMLElement>(".list")!.scrollTop = 120;
  const into = layer("");
  showStill(into, captureStill(src));
  expect(into.querySelector("input")!.value).toBe("typed");
  expect(into.querySelector<HTMLElement>(".list")!.scrollTop).toBe(120);
});

it("draws each canvas into its copy, and a canvas that cannot be drawn leaves a blank copy", () => {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  const src = layer(`<canvas width="4" height="4"></canvas>`);
  const into = layer("");
  showStill(into, captureStill(src));
  expect(drawImage).toHaveBeenCalledWith(src.querySelector("canvas"), 0, 0);
  drawImage.mockImplementation(() => {
    throw new Error("tainted");
  });
  expect(() => captureStill(src)).not.toThrow();
});
