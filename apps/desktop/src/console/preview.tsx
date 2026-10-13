/**
 * The depth scenes in a plain browser — README section 3.5, ADR 0087.
 *
 * `preview.html?scene=surface&fixture=asking` and `?scene=waking&fixture=engine-missing` draw one
 * scene's own fixture inside the real stage, with the water and the chrome around it and the
 * actions inert. `?scene=console` is the whole console on the live stores (which, with no shell,
 * answer as an empty machine does). `&calm=1` renders under Calm; `&theme=light` flips the theme.
 */
import { useEffect, useMemo, useReducer } from "react";

import { INITIAL, reduce, type Path } from "@/depth/model";
import { applyMotion } from "@/lib/motion";
import type { ModuleEntry } from "@/modules/types";
import Stage from "@/stage/Stage";
import { applyTheme, isTheme } from "@/stores/shell";
import { entry as surface } from "@/scenes/surface";
import { entry as waking } from "@/scenes/waking";

const SCENES: Record<string, ModuleEntry> = { surface, waking };

export const isSceneName = (name: string | null): name is string => name !== null && name in SCENES;

export function ScenePreview({ name }: { name: string }) {
  const q = useMemo(() => new URLSearchParams(window.location.search), []);
  const entry = SCENES[name]!;
  const fixture = q.get("fixture") ?? entry.fixtureIds[0]!;
  const calm = q.get("calm") === "1";
  const theme = q.get("theme");
  const [state, dispatch] = useReducer(reduce, INITIAL);

  useEffect(() => applyMotion(calm ? "calm" : "full"), [calm]);
  useEffect(() => applyTheme(isTheme(theme) ? theme : "dark"), [theme]);

  const go = (to: Path) => dispatch({ type: "go", to });
  return (
    <div style={{ height: "100vh" }}>
      <Stage
        state={state}
        calm={calm}
        renderScene={() => entry.preview(fixture)}
        presence={{ pose: "resting", text: "resting", waiting: 0 }}
        onGo={go}
        onRise={() => dispatch({ type: "rise" })}
        onSurface={() => dispatch({ type: "surface" })}
        onSettle={(seq) => dispatch({ type: "settle", seq })}
      />
    </div>
  );
}
