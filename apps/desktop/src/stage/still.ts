/**
 * A still of a leaving layer — README section 3.1, ADR 0089 and 0193.
 *
 * A move plays the place you left out while the new one plays in. The place you left is not a live
 * scene any more: its React tree is unmounted at the move's start, so its effects, listeners, polls
 * and frame loops end then, and only one scene is ever live. What plays out is this: a static copy
 * of the layer's DOM taken a moment before the unmount. Canvases are copied by `drawImage` so a
 * waveform or a sky does not blank, scroll offsets are put back once the copy is attached, and the
 * copy carries no listener, no HTML id, no autofocus and no autoplay, so it cannot answer for, or
 * collide with, the scene arriving beside it.
 */

export interface Still {
  nodes: Node[];
  /** Elements of the copy that were scrolled, and where: applied once the copy is in the document. */
  scrolls: [Element, number, number][];
}

/** Copy `from`'s children into a still. Pure of `from`: nothing in it is moved or changed. */
export function captureStill(from: Element): Still {
  const nodes: Node[] = [];
  const scrolls: Still["scrolls"] = [];
  for (const child of from.childNodes) {
    const copy = child.cloneNode(true);
    nodes.push(copy);
    if (child instanceof Element && copy instanceof Element) mend(child, copy, scrolls);
  }
  return { nodes, scrolls };
}

/** Walk the source and its copy side by side: they have the same shape, element for element. */
function mend(src: Element, copy: Element, scrolls: Still["scrolls"]) {
  const a = [src, ...src.querySelectorAll("*")];
  const b = [copy, ...copy.querySelectorAll("*")];
  a.forEach((s, i) => {
    const c = b[i]!;
    if (s.scrollTop || s.scrollLeft) scrolls.push([c, s.scrollTop, s.scrollLeft]);
    // An SVG keeps its ids: its gradients and masks are referenced by them, and a still is inert.
    if (!(c instanceof SVGElement)) c.removeAttribute("id");
    c.removeAttribute("autofocus");
    c.removeAttribute("autoplay");
    if (s instanceof HTMLCanvasElement && c instanceof HTMLCanvasElement && s.width && s.height) {
      try {
        c.getContext("2d")?.drawImage(s, 0, 0);
      } catch {
        // A tainted or lost canvas leaves its copy blank; the leave still plays.
      }
    } else if (s instanceof HTMLInputElement || s instanceof HTMLTextAreaElement || s instanceof HTMLSelectElement) {
      (c as typeof s).value = s.value;
    }
  });
}

/**
 * Put a still into `into` (a leaving layer React draws empty), give back its scroll offsets and mark
 * the layer `data-still`.
 */
export function showStill(into: Element, still: Still) {
  into.setAttribute("data-still", "");
  into.append(...still.nodes);
  for (const [el, top, left] of still.scrolls) {
    el.scrollTop = top;
    el.scrollLeft = left;
  }
}
