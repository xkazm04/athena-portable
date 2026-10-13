/**
 * The depth scenes in a plain browser — README section 3.5, ADR 0087 and 0090.
 *
 * `preview.html?scene=surface&fixture=asking` and `?scene=waking&fixture=engine-missing` draw the
 * surface's scenes, and `?scene=apps&fixture=heavy&at=%23/apps/host-1` draws a depth scene (any
 * root with a port) at a place, inside the real stage with the water and the chrome around it and
 * the actions inert. Moving works: the stage's own depth reducer runs, so a scene's links dive.
 * `?scene=console` is the whole console on the live stores (which, with no shell, answer as an
 * empty machine does). `&calm=1` renders under Calm; `&theme=light` flips the theme.
 */
import { useEffect, useMemo, useReducer } from "react";

import { INITIAL, SURFACE, parseHash, reduce, shapeOf, type DepthState, type Path } from "@/depth/model";
import { applyMotion } from "@/lib/motion";
import type { ModuleEntry } from "@/modules/types";
import { entry as surface } from "@/scenes/surface";
import { entry as waking } from "@/scenes/waking";
import Stage from "@/stage/Stage";
import { applyTheme, isTheme } from "@/stores/shell";

import { DEPTH_SCENES } from "./scenes";

const FIRST_ACT: Record<string, ModuleEntry> = { surface, waking };

export const isSceneName = (name: string | null): name is string =>
  name !== null && (name in FIRST_ACT || name in DEPTH_SCENES);

export function ScenePreview({ name }: { name: string }) {
  const q = useMemo(() => new URLSearchParams(window.location.search), []);
  const calm = q.get("calm") === "1";
  const theme = q.get("theme");
  const depth = name in DEPTH_SCENES ? DEPTH_SCENES[name as keyof typeof DEPTH_SCENES]! : null;
  const act = depth ? null : FIRST_ACT[name]!;
  const fixture = q.get("fixture") ?? (depth ?? act!).fixtureIds[0]!;

  const [state, dispatch] = useReducer(reduce, INITIAL, (s): DepthState => {
    const at = q.get("at");
    return at ? { ...s, path: parseHash(at) } : depth ? { ...s, path: { root: depth.root } } : s;
  });

  useEffect(() => applyMotion(calm ? "calm" : "full"), [calm]);
  useEffect(() => applyTheme(isTheme(theme) ? theme : "dark"), [theme]);

  const go = (to: Path) => dispatch({ type: "go", to });
  const render = (path: Path) =>
    depth && path.root === depth.root
      ? depth.preview(fixture, { path, go })
      : act
        ? act.preview(fixture)
        : null;
  const Band = depth && shapeOf(state.path) === "page" ? depth.Band : undefined;

  return (
    <div style={{ height: "100vh" }}>
      <Stage
        state={state}
        calm={calm}
        renderScene={render}
        label={depth?.previewLabeller?.(fixture)}
        band={Band ? <Band /> : undefined}
        presence={{ pose: "resting", text: "resting", waiting: 0 }}
        onGo={go}
        onRise={() => dispatch({ type: "rise" })}
        onSurface={() => dispatch({ type: "go", to: SURFACE })}
        onSettle={(seq) => dispatch({ type: "settle", seq })}
      />
    </div>
  );
}
