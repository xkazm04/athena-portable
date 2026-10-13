/**
 * Telling Rust which shape the window is in — README section 3.5, ADR 0088.
 *
 * The depth path decides the shape (`shapeOf`); Rust owns the rectangles. This is the one seam:
 * when the shape changes, the shell is sent `layout_select` with the shape's id, and Rust re-lays
 * the window and hides or shows the focused page. The ids are Rust's (`layout.rs` `PAGE_SHAPE` and
 * `SCENE_SHAPE`), and a test reads that file to keep the two spellings equal.
 *
 * Started by the app root once the stage replaces the module bar. With no shell it does nothing.
 */
import { hasShell, layoutSelect } from "@/lib/ipc";

import { shapeOf, type Shape } from "./model";
import { useDepth } from "./store";

export const SHAPE_ID: Readonly<Record<Shape, string>> = { page: "page", scene: "scene" };

let last: Shape | null = null;

/** Send the shape whenever it changes, and once at the start. Returns the stop function. */
export function startShapeSync(send: (id: string) => Promise<void> = layoutSelect): () => void {
  if (send === layoutSelect && !hasShell()) return () => {};
  const push = (shape: Shape) => {
    if (shape === last) return;
    last = shape;
    // A refusal is logged, not thrown: the stage must not break because a re-lay did not land.
    void send(SHAPE_ID[shape]).catch((e: unknown) => console.error("[athena] layout_select", e));
  };
  push(shapeOf(useDepth.getState().path));
  const stop = useDepth.subscribe((s, prev) => {
    const shape = shapeOf(s.path);
    if (shape !== shapeOf(prev.path)) push(shape);
  });
  return () => {
    stop();
    last = null;
  };
}
