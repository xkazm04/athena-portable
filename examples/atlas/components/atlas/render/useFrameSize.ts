"use client";

/**
 * The frame the scene is drawn into, in pixels, measured rather than guessed.
 *
 * All three renderers need it: the projection's aspect and its `K` both come out of the frame's
 * height, so a hard-coded size is a picture that is right on one monitor. `ResizeObserver` and
 * not a `resize` listener, because the frame is a flex child of a page that has a mast and a
 * transport, and the window can stay exactly the same size while this element does not.
 *
 * Zero is the pre-measure answer and every consumer treats it as "do not draw yet" rather than
 * dividing by it.
 */
import { useEffect, useRef, useState, type RefObject } from "react";

export interface Size {
  w: number;
  h: number;
}

export function useFrameSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (!box) return;
      setSize((s) =>
        Math.abs(s.w - box.width) < 1 && Math.abs(s.h - box.height) < 1
          ? s
          : { w: box.width, h: box.height },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * A tap that is not the end of a drag.
 *
 * The camera rig owns pointer-down on the scene root, so every click on a block is also the
 * start of an orbit. The distinction a reader means is distance: a press that travelled less
 * than a few pixels was a click on the thing under it; anything further was a camera move and
 * must not open a level. Two refs and a threshold — cheaper and more predictable than asking
 * the rig whether it happens to be moving on the frame the click lands.
 */
export interface Tap {
  handlers: {
    onPointerDownCapture: (e: React.PointerEvent) => void;
    onPointerUpCapture: (e: React.PointerEvent) => void;
  };
  /** True only when the press that just ended never travelled far enough to be a camera move. */
  wasTap: () => boolean;
}

/** Pixels of travel a press may have and still count as a click on what was under it. */
const TAP_SLOP = 5;

export function useTap(): Tap {
  const start = useRef({ x: 0, y: 0 });
  const tap = useRef(false);
  return {
    handlers: {
      onPointerDownCapture: (e) => {
        start.current = { x: e.clientX, y: e.clientY };
        tap.current = false;
      },
      onPointerUpCapture: (e) => {
        tap.current =
          Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) < TAP_SLOP;
      },
    },
    wasTap: () => tap.current,
  };
}

/**
 * Two refs on one element.
 *
 * The kit's `rig.bind` carries a `ref` of its own — it attaches a NON-PASSIVE wheel listener,
 * which is the only way a wheel over the scene can stop the page scrolling, and React's `onWheel`
 * is passive. Spreading `bind` over a JSX `ref` silently drops one of them (the later prop wins),
 * and which one is lost depends on the order somebody typed the attributes in. So both are
 * composed here instead, and the scene's own measuring ref and the rig's listener ref both get
 * the element.
 *
 * Logged in KIT-GAPS round 3: `bind.ref` is a deviation from the contract, and it is the kind of
 * deviation that fails silently.
 */
export function composeRefs<T extends HTMLElement>(
  ...refs: (((el: T | null) => void) | RefObject<T | null> | undefined)[]
): (el: T | null) => void {
  return (el) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") ref(el);
      else ref.current = el;
    }
  };
}
