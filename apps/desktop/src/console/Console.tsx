/**
 * The console — README section 3.1 and 3.5, ADR 0026, 0087 and 0090.
 *
 * The stage, wired to the stores: where the window is (`depth/store`), how she is (`athena`), and
 * what the settings say (first act or surface, Calm). It starts nothing; `root.tsx` does. It is
 * the one place that turns the stage's callbacks into depth moves and her mirror into a presence,
 * and that gathers the crumb names the scenes know and the band the Apps scene owns.
 */
import { useCallback } from "react";

import { poseOf, POSE_WORDS } from "@/bell/pose";
import WindowControls from "@/components/WindowControls";
import { shapeOf, type Labeller, type Path } from "@/depth/model";
import { useDepth } from "@/depth/store";
import { resolveMotion, systemPrefersReduced } from "@/lib/motion";
import Stage from "@/stage/Stage";
import { pillText, useAthena } from "@/stores/athena";
import { useReopened } from "@/scenes/waking/reopen";
import { readRows, useSettings } from "@/stores/settings";

import { useFollowShell } from "./follow";
import { LIVE_SCENES, sceneFor } from "./scenes";

const SCENES = Object.values(LIVE_SCENES);

const retryRead = () => void readRows();

/**
 * Every scene's crumb names, in one labeller. The hooks are called for every scene on every render
 * and in one fixed order, which is what keeps them legal however the depth changes.
 */
function useLabeller(): Labeller {
  const labellers = SCENES.map((s) => s.useLabeller?.());
  return (path: Path) => {
    for (const l of labellers) {
      const name = l?.(path);
      if (name !== undefined) return name;
    }
    return undefined;
  };
}

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
  const problem = useSettings((s) => s.problem);
  const motion = useSettings((s) => s.motion);
  const reopened = useReopened((s) => s.on);
  const label = useLabeller();
  useFollowShell();

  const pose = poseOf(athena);
  const render = useCallback(
    (p: Path) => sceneFor(p, { hydrated, onboarded, reopened, go, problem, retry: retryRead }),
    [hydrated, onboarded, reopened, go, problem],
  );
  const Band = shapeOf(path) === "page" && path.root !== null ? LIVE_SCENES[path.root].Band : undefined;

  return (
    <Stage
      state={{ path, from, move, seq }}
      calm={resolveMotion(motion, systemPrefersReduced()) === "calm"}
      renderScene={render}
      label={label}
      band={Band ? <Band /> : undefined}
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
