"use client";

/**
 * The echo container: the level you just left, drawn once, carrying the camera.
 * `docs/kit-camera-contract.md` §4.
 *
 * Everything about this element is a consequence of rule 1 and rule 2 together:
 *
 *   · `aria-hidden` + `inert` + `pointer-events: none` — it is a PICTURE of where the reader
 *     was. A screen reader that reads it reads the page twice; a Tab that lands in it lands in
 *     the past; a click on it clicks something that is not there any more.
 *   · the consumer renders its children ID-FREE. The live layer owns the shared ids (rule 2) and
 *     two claimants animate neither, which is the bug that had tidycrm's L1→L2 morph silently
 *     never play. This component cannot enforce that; the template shows it.
 *   · `--echo-ox` / `--echo-oy` and `data-direction` are the whole interface to the CSS. The
 *     surface writes its own `transform-origin: var(--echo-ox) var(--echo-oy)` and hangs its
 *     move off `[data-direction="in"]` / `["out"]`, in its own tokens (rule 4). The kit ships no
 *     stylesheet and has no opinion about what the move looks like.
 *   · children are captured once per echo. It is a still of a level that no longer exists; a
 *     re-render of it with newer data would be a picture of the present pretending to be one of
 *     the past.
 *
 * WHEN IT ENDS. `animationend` or `transitionend` ON ITSELF — not on a descendant, which is why
 * the target is checked: a staged move animates several children and the first of them finishing
 * is not the move finishing. Plus a timeout at the flight's own fallback, because the one thing
 * that must not happen is a missing `@keyframes` (a typo, a stylesheet that did not load, a
 * reduced-motion branch that set no animation at all) leaving the flight moving forever, which
 * is the nav believing Escape should abort a move nobody can see.
 */
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

import { echoOriginVars } from "./echo-rule";
import { FLIGHT_FALLBACK_MS } from "./flight";
import type { EchoState } from "./useEcho";

/**
 * Grace on top of the flight's budget before the echo gives up on its own animation.
 *
 * Two frames. The timeout is a NET, not a clock: firing it at exactly the budget would race the
 * `animationend` of a move that ran for exactly as long as it said it would, and the loser of
 * that race is a move cut off one frame from its end.
 */
export const ECHO_GRACE_MS = 34;

export interface EchoProps {
  echo: EchoState;
  children: ReactNode;
  className?: string;
}

export function Echo({ echo, children, className }: EchoProps) {
  /* The still. Re-captured only when the echo itself is a different one, so the component is
     correct whether or not the consumer keyed it. */
  const frozen = useRef<{ key: string; node: ReactNode }>({ key: echo.key, node: children });
  if (frozen.current.key !== echo.key) frozen.current = { key: echo.key, node: children };

  const done = useRef(echo.onDone);
  done.current = echo.onDone;

  useEffect(() => {
    const ms = Math.max(0, echo.fallbackMs ?? FLIGHT_FALLBACK_MS) + ECHO_GRACE_MS;
    const id = window.setTimeout(() => done.current(), ms);
    return () => window.clearTimeout(id);
  }, [echo.key, echo.fallbackMs]);

  const style = {
    pointerEvents: "none",
    ...echoOriginVars(echo.origin, echo.unit),
  } as CSSProperties;

  return (
    <div
      className={className}
      style={style}
      aria-hidden
      inert
      data-echo=""
      data-direction={echo.direction}
      data-from={echo.from.level}
      data-to={echo.to.level}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) done.current();
      }}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget) done.current();
      }}
    >
      {frozen.current.node}
    </div>
  );
}
