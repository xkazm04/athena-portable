"use client";

/**
 * Put every cell on top of the cluster the canvas is currently drawing for
 * it, once, before it is allowed to move.
 *
 * PER CELL, not per grid. An earlier cut scaled the whole grid by one factor
 * and called it a hand-off; it could not work, because a cell is a cluster
 * beside a column of text and its proportions are nothing like the square of
 * dots on the canvas, so no single transform puts twelve clusters onto twelve
 * clusters. Each cell is measured and moved on its own instead.
 *
 * The camera does the rest. A perspective camera at `CAMERA_Z` looking
 * through `CAMERA_FOV` degrees sees a known number of world units across the
 * canvas's height, which converts world units to pixels; the cluster's world
 * centre comes from `clusterCentre`, the same function the scene used to
 * place the dots.
 *
 * Written straight onto the nodes as custom properties rather than held in
 * state: this is a measurement of the layout that has just happened, and
 * feeding it back through a render would put a frame between the cells
 * appearing and them being in the right place — which is the frame the whole
 * effect exists to remove. `data-measured` is set last, and the stylesheet
 * keeps the grid invisible until it is there, so no cell is ever painted at
 * an unmeasured position.
 *
 * ONCE, AND ONLY ONCE. `data-measured` is also the guard. This measures the
 * distance from where a cell IS to where the canvas drew it, so a second pass
 * over cells that have already been moved reads a distance of zero and a
 * scale of one — which silently cancels the whole effect. React invokes an
 * effect twice in development on purpose, and that is exactly what it did.
 */
import { useEffect, type RefObject } from "react";

import { CAMERA_FOV, CAMERA_Z, CLUSTER_FILL, clusterCentre } from "../model";
import type { FieldPhase } from "../Field";

export function useLanding(
  cellsRef: RefObject<HTMLDivElement | null>,
  phase: FieldPhase,
  tiles: number,
) {
  useEffect(() => {
    if (phase !== "land") return;
    const root = cellsRef.current;
    const canvas = document.querySelector(".bk-cube-canvas");
    if (!root || !canvas || root.dataset.measured === "true") return;
    const frame = canvas.getBoundingClientRect();
    if (frame.height === 0) return;
    const cells = Array.from(root.querySelectorAll<HTMLElement>(".bk-cell"));
    // Every read first, then every write: interleaving them makes the browser
    // re-layout once per cell.
    const measured = cells.map((cell) => {
      const cluster = cell.querySelector(".bk-cell-cluster");
      return {
        cell,
        cellBox: cell.getBoundingClientRect(),
        clusterBox: (cluster ?? cell).getBoundingClientRect(),
      };
    });
    const unitsAcrossHeight = 2 * Math.tan(((CAMERA_FOV / 2) * Math.PI) / 180) * CAMERA_Z;
    const pxPerUnit = frame.height / unitsAcrossHeight;
    const midX = frame.left + frame.width / 2;
    const midY = frame.top + frame.height / 2;
    measured.forEach(({ cell, cellBox, clusterBox }, i) => {
      if (clusterBox.width === 0) return;
      const world = clusterCentre(i, tiles);
      const wantPx = world.w * CLUSTER_FILL * pxPerUnit;
      const here = { x: clusterBox.left + clusterBox.width / 2, y: clusterBox.top + clusterBox.height / 2 };
      // The origin is the cluster's own centre inside the cell, so scaling
      // pivots on the dots rather than on the cell's corner.
      cell.style.setProperty("--ox", `${(here.x - cellBox.left).toFixed(1)}px`);
      cell.style.setProperty("--oy", `${(here.y - cellBox.top).toFixed(1)}px`);
      cell.style.setProperty("--dx", `${(midX + world.x * pxPerUnit - here.x).toFixed(1)}px`);
      cell.style.setProperty("--dy", `${(midY - world.y * pxPerUnit - here.y).toFixed(1)}px`);
      cell.style.setProperty("--s", (wantPx / clusterBox.width).toFixed(4));
    });
    root.dataset.measured = "true";
    // `cellsRef` is a ref object and never changes identity, so listing it
    // would only widen the array without widening what it watches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, tiles]);
}
