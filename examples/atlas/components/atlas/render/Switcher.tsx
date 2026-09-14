"use client";

/**
 * Which of the three renderings is on the page, and where that choice is kept.
 *
 * The same shape tidycrm's L0 switcher took in round 2, for the same reason and with the same
 * expiry date: the owner asked to see three prototypes LIVE rather than read three descriptions,
 * so `/` mounts one at a time and this is how they change it. Two of the three go after the
 * review, and this control goes with them.
 *
 * WHERE THE CHOICE LIVES, in this order. The URL wins (`?render=webgl`), because a link is how
 * one of these gets sent to somebody else; `localStorage` is the fallback, because a reader who
 * picked one should not pick it again on reload. The default is `css3d` — the one that needs no
 * GPU at all, so a machine that cannot run WebGL still shows the machine.
 *
 * READ AS THE EXTERNAL STATE IT IS. Neither the search string nor storage is React's, and an
 * effect that copies them into component state is a `setState` in an effect and a second render
 * behind the first. `useSyncExternalStore` answers the truth on the client and the default on the
 * server, which is also the hydration-safe pair. `replaceState`, not `push`: switching prototypes
 * is which drawing of one place you are looking at, not a place you navigated to.
 */
import { useCallback, useRef, useSyncExternalStore } from "react";

import {
  RENDER_LABEL,
  RENDER_NOTE,
  RENDER_VARIANTS,
  isRenderVariant,
  type RenderVariant,
} from "./contract";

const KEY = "atlas.render";
const PARAM = "render";
const DEFAULT: RenderVariant = "css3d";

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("popstate", onChange);
  };
}

function snapshot(): RenderVariant {
  const fromUrl = new URLSearchParams(window.location.search).get(PARAM);
  if (isRenderVariant(fromUrl)) return fromUrl;
  try {
    const stored = window.localStorage.getItem(KEY);
    if (isRenderVariant(stored)) return stored;
  } catch {
    /* Storage denied is not a reason to refuse to draw. */
  }
  return DEFAULT;
}

const onServer = (): RenderVariant => DEFAULT;

export function useRenderVariant(): [RenderVariant, (next: RenderVariant) => void] {
  const variant = useSyncExternalStore(subscribe, snapshot, onServer);
  const choose = useCallback((next: RenderVariant) => {
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* see above */
    }
    const url = new URL(window.location.href);
    url.searchParams.set(PARAM, next);
    window.history.replaceState(window.history.state, "", url);
    for (const l of listeners) l();
  }, []);
  return [variant, choose];
}

/**
 * The control. A `radiogroup`, not three buttons: it is one choice with three answers, and the
 * role brings the keyboard behaviour a segmented control is expected to have — one tab stop for
 * the group, arrows to move inside it, roving `tabindex` so only the chosen one is tabbable.
 */
export function RenderSwitcher({
  variant,
  onChoose,
}: {
  variant: RenderVariant;
  onChoose: (next: RenderVariant) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const at = RENDER_VARIANTS.indexOf(variant);
    let next = at;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (at + 1) % RENDER_VARIANTS.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (at - 1 + RENDER_VARIANTS.length) % RENDER_VARIANTS.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = RENDER_VARIANTS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const chosen = RENDER_VARIANTS[next];
    if (!chosen) return;
    onChoose(chosen);
    ref.current?.querySelector<HTMLElement>(`[data-render-id="${chosen}"]`)?.focus();
  };

  return (
    <div className="at-render-switch">
      <span className="at-render-label" id="at-render-label">
        Rendering
      </span>
      <div
        className="at-seg"
        role="radiogroup"
        aria-labelledby="at-render-label"
        aria-describedby="at-render-note"
        ref={ref}
        onKeyDown={onKeyDown}
      >
        {RENDER_VARIANTS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={id === variant}
            data-render-id={id}
            className="at-seg-option"
            tabIndex={id === variant ? 0 : -1}
            title={RENDER_NOTE[id]}
            onClick={() => onChoose(id)}
          >
            {RENDER_LABEL[id]}
          </button>
        ))}
      </div>
      <p className="at-render-note" id="at-render-note">
        {RENDER_NOTE[variant]}
      </p>
    </div>
  );
}
