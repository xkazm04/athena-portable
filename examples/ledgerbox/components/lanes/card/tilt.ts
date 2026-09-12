"use client";

/**
 * The card's slight tilt toward the pointer.
 *
 * The ref is OWNED BY THE CALLER and handed in, not created here and returned.
 * The React Compiler's `immutability` rule forbids writing to a ref a hook
 * returned, which is what an earlier version did — and the rule is right: a ref
 * that two places write to has no single owner.
 */
import { useCallback, type RefObject } from "react";

/** How far the card leans, in degrees, at the edge of its own box. */
const TILT = 3.4;

/**
 * The card follows the pointer, gently.
 *
 * The element ref is owned by the component and handed in, rather than created
 * here and handed back: a hook that returns a ref makes every read of its
 * result a ref read during render, which the React compiler's rules forbid —
 * and the component needs this same node for its focus trap anyway.
 */
export function usePointerTilt(target: RefObject<HTMLDivElement | null>, enabled: boolean) {
  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const el = target.current;
      if (!enabled || !el) return;
      const box = el.getBoundingClientRect();
      const dx = (event.clientX - box.left) / box.width - 0.5;
      const dy = (event.clientY - box.top) / box.height - 0.5;
      el.style.setProperty("--ry", `${dx * TILT * 2}deg`);
      el.style.setProperty("--rx", `${-dy * TILT}deg`);
    },
    [enabled, target],
  );

  const onPointerLeave = useCallback(() => {
    const el = target.current;
    if (!el) return;
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--rx", "0deg");
  }, [target]);

  return { onPointerMove, onPointerLeave };
}
