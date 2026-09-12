/**
 * Where every record sits, in the cube and on the plate it flattens into.
 *
 * Pure arithmetic, no `three` components and no React: two Float32Arrays per
 * zone and a list of points along a quadrant's edges. Separated from the pieces
 * that draw them because this is the half that has to agree with the DOM — the
 * flat targets come from `clusterCentre`, the same function `Field.tsx` uses to
 * work out where the canvas left each cluster. If the two ever disagree the
 * hand-off between the levels becomes a cut, so the arithmetic lives on its own
 * where it can be read in one sitting.
 */

import * as THREE from "three";

import { CLUSTER_FILL, ZONE_QUADRANT, clusterCentre, type BkZone } from "../model";
import { rng } from "./palette";

/** Half-extent of the whole cube. */
export const R = 2.1;
/** Gap between quadrants, so four blocks read as four. */
export const GAP = 0.09;

/** Where each zone's quadrant sits: A and B on top, C and D beneath.
    The signs live in `model.ts`, because the DOM draws the same fact. */
export const QUADRANT = ZONE_QUADRANT;

export function quadrantBox(zoneId: string) {
  const q = QUADRANT[zoneId] ?? { sx: -1, sy: 1 };
  const half = R - GAP;
  const w = half - GAP;
  return {
    w,
    depth: 2 * half,
    x0: q.sx < 0 ? -half + GAP : GAP,
    y0: q.sy < 0 ? -half + GAP : GAP,
    z0: -half + GAP,
    cx: q.sx < 0 ? -(GAP + w / 2) : GAP + w / 2,
    cy: q.sy < 0 ? -(GAP + w / 2) : GAP + w / 2,
  };
}

/**
 * Two positions for every record in a zone: where it sits inside the cube, and
 * where it lands once the zone is opened.
 *
 * The flat target is the whole point of the transition. Records are grouped
 * into one cluster per block, and the clusters run in the SAME order and the
 * same number of columns the DOM tile grid uses — so when the tiles fade in
 * they land on the clusters the dots just formed.
 */
export function positionsOf(zone: BkZone): {
  solid: Float32Array;
  flat: Float32Array;
  mark: Uint8Array;
  count: number;
} {
  const box = quadrantBox(zone.id);
  const marks: number[] = [];
  for (const table of zone.tables) marks.push(...table.marks);
  const count = marks.length;

  const solid = new Float32Array(count * 3);
  const flat = new Float32Array(count * 3);
  const mark = new Uint8Array(count);
  const next = rng(0xb10c + zone.id.charCodeAt(0));

  // --- inside the cube: an even lattice through the quadrant's volume.
  const side = Math.max(1, Math.ceil(Math.cbrt(count)));
  const nz = Math.max(1, Math.ceil(count / (side * side)));
  for (let i = 0; i < count; i += 1) {
    const ix = i % side;
    const iy = Math.floor(i / side) % side;
    const iz = Math.floor(i / (side * side));
    solid[i * 3] = box.x0 + ((ix + 0.5) / side) * box.w + ((next() - 0.5) * 0.34 * box.w) / side;
    solid[i * 3 + 1] =
      box.y0 + ((iy + 0.5) / side) * box.w + ((next() - 0.5) * 0.34 * box.w) / side;
    solid[i * 3 + 2] =
      box.z0 + ((iz + 0.5) / nz) * box.depth + ((next() - 0.5) * 0.34 * box.depth) / nz;
    mark[i] = marks[i] ?? 0;
  }

  // --- once opened: one cluster per block, laid out as the cell grid will be.
  //
  // `clusterCentre` is the shared function the DOM also calls, so the cluster a
  // record lands in and the cell about to be drawn on top of it are reading the
  // same arithmetic rather than two copies of it. The cluster is SQUARE — both
  // axes spread across `w`, not `w` by `h` — because the cell draws it into a
  // square box, and a cluster that is square in one medium and oblong in the
  // other cannot be handed from one to the other.
  const tiles = zone.tables.length;
  let cursor = 0;
  zone.tables.forEach((table, tileIndex) => {
    const cell = clusterCentre(tileIndex, tiles);
    const n = table.marks.length;
    const s = Math.max(1, Math.ceil(Math.sqrt(n)));
    for (let r = 0; r < n; r += 1) {
      const ix = r % s;
      const iy = Math.floor(r / s);
      const k = (cursor + r) * 3;
      flat[k] = cell.x + ((ix + 0.5) / s - 0.5) * cell.w * CLUSTER_FILL;
      flat[k + 1] = cell.y + ((iy + 0.5) / s - 0.5) * cell.w * CLUSTER_FILL;
      flat[k + 2] = 0;
    }
    cursor += n;
  });

  return { solid, flat, mark, count };
}

/** Points spread along the twelve edges of one quadrant box. */
export function edgePoints(zoneId: string, samples: number): THREE.Vector3[] {
  const q = QUADRANT[zoneId] ?? { sx: -1, sy: 1 };
  const half = R - GAP;
  const x0 = q.sx < 0 ? -half : GAP;
  const x1 = q.sx < 0 ? -GAP : half;
  const y0 = q.sy < 0 ? -half : GAP;
  const y1 = q.sy < 0 ? -GAP : half;

  const corner = [
    new THREE.Vector3(x0, y0, -half),
    new THREE.Vector3(x1, y0, -half),
    new THREE.Vector3(x1, y1, -half),
    new THREE.Vector3(x0, y1, -half),
    new THREE.Vector3(x0, y0, half),
    new THREE.Vector3(x1, y0, half),
    new THREE.Vector3(x1, y1, half),
    new THREE.Vector3(x0, y1, half),
  ];
  const origin = new THREE.Vector3();
  const at = (i: number) => corner[i] ?? origin;

  const edges: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];

  const out: THREE.Vector3[] = [];
  const per = Math.max(2, Math.round(samples / edges.length));
  for (const [a, b] of edges) {
    const pa = at(a);
    const pb = at(b);
    for (let i = 0; i < per; i += 1) out.push(pa.clone().lerp(pb, i / (per - 1 || 1)));
  }
  return out;
}
