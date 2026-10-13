/**
 * The console — README section 3.1 and 3.5, ADR 0026 and 0087.
 *
 * The stage, wired to the stores: where the window is (`depth/store`), how she is (`athena`), and
 * what the settings say (first act or surface, Calm). It starts nothing; `root.tsx` does. It is
 * the one place that turns the stage's callbacks into depth moves and her mirror into a presence.
 */
import { useCallback } from "react";

import { poseOf, POSE_WORDS } from "@/bell/pose";
import WindowControls from "@/components/WindowControls";
import { resolveMotion, systemPrefersReduced } from "@/lib/motion";
import { useDepth } from "@/depth/store";
import Stage from "@/stage/Stage";
import { pillText, useAthena } from "@/stores/athena";
import { useSettings } from "@/stores/settings";

import { sceneFor } from "./scenes";

export default function Console() {
  const path = useDepth((s) => s.path);
  const from = useDepth((s) => s.from);
  const move = useDepth((s) => s.move);
  const seq = useDepth((s) => s.seq);
  const go = useDepth((s) => s.go);
  const rise = useDepth((s) => s.rise);
  const surface = useDepth((s) => s.surface);
  const settle = useDepth((s) => s.settle);

  const athena = useAthena();
  const hydrated = useSettings((s) => s.hydrated);
  const onboarded = useSettings((s) => s.onboarded);
  const motion = useSettings((s) => s.motion);

  const pose = poseOf(athena);
  const render = useCallback(
    (p: Parameters<typeof sceneFor>[0]) => sceneFor(p, { hydrated, onboarded }),
    [hydrated, onboarded],
  );

  return (
    <Stage
      state={{ path, from, move, seq }}
      calm={resolveMotion(motion, systemPrefersReduced()) === "calm"}
      renderScene={render}
      presence={{
        pose,
        text: athena.cards > 0 || pose !== "resting" ? pillText(athena) : POSE_WORDS.resting,
        waiting: athena.cards,
      }}
      onGo={go}
      onRise={rise}
      onSurface={surface}
      onSettle={settle}
      trailing={<WindowControls waiting={athena.cards > 0} />}
    />
  );
}
