/**
 * Where she works, in Main's bar — README section 3.5, ADR 0225.
 *
 * The project pill on the spaces store, at the bar's right end before the window buttons: Main is
 * where the person switches Project most, and the list ("All projects") is one press away. A lazy
 * chunk off the first frame, as the due notice is: the bar is drawn before the list has answered
 * anyway, and the pill's menu and rules are not first-paint weight (`scripts/first-paint.mjs`).
 *
 * **It starts Main's spaces store.** The bar is drawn on every scene and every shape, so the pill is
 * mounted for as long as Main is, and the store it starts (the list, the row, the turn signal)
 * comes with it after first paint; the due notice starts its poller the same way. Until then the
 * first frame reads the store's mirror (`stores/spaces-glance.ts`), which says the list has not
 * answered.
 */
import { useEffect } from "react";

import ProjectPill from "@/components/ProjectPill";
import type { Path } from "@/depth/model";
import { startSpaces, useSpaces, type TurnSignal } from "@/stores/spaces";

/**
 * Whether she is working, as Main can know it: the turn lives in her window, and Main sees only
 * what Rust mirrors of her (`athena:status`), which the console reads and hands the pill as
 * `working` (this chunk reading her store itself would split it off the first frame's chunk). A
 * Project switch asked for here while she works is held until she rests; her window, which holds
 * the turn itself, holds it too if a turn is still running when the row arrives, so no turn is
 * ever filed under two Projects.
 */
let working = false;
const rested = new Set<() => void>();
const herTurn: TurnSignal = {
  busy: () => working,
  onIdle: (f) => {
    rested.add(f);
    return () => rested.delete(f);
  },
};

export default function BarPill({ go, working: now }: { go: (to: Path) => void; working: boolean }) {
  // Once per window: `startSpaces` ignores every call after the first.
  useEffect(() => void startSpaces(herTurn), []);
  useEffect(() => {
    const was = working;
    working = now;
    if (was && !now) rested.forEach((f) => f());
  }, [now]);
  const spaces = useSpaces((s) => s.spaces);
  const activeId = useSpaces((s) => s.activeId);
  const pending = useSpaces((s) => s.pending);
  const setActive = useSpaces((s) => s.setActive);
  return (
    <ProjectPill
      spaces={spaces}
      activeId={activeId}
      pending={pending}
      onPick={setActive}
      onAll={() => go({ root: "projects" })}
    />
  );
}
