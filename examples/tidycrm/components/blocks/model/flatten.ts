/**
 * The plane the cube flattens into, and the camera that looks at it.
 *
 * Six numbers and one function, and they are the whole hand-off between the
 * levels. The scene reads them to decide where a block's cluster of records
 * comes to rest; the DOM reads them to work out where on screen that cluster
 * ended up, so the cell it draws can start life exactly on top of it. They live
 * on their own because the moment the two sides disagree about any of them, a
 * three-second move becomes a cut.
 */

/**
 * Columns the L1 tile grid uses, and the cube's flatten targets copy.
 *
 * Declared once and read by both, because the whole point of the transition is
 * that the record clusters the cube forms land where the tiles are about to be.
 * Two numbers that must agree, in one place.
 */
export const FLAT_COLS = 4;

/**
 * The flattened plane, and the camera looking at it.
 *
 * These five numbers are the whole hand-off. The scene uses them to decide
 * where a block's cluster of records comes to rest; the DOM uses them to work
 * out where on screen that cluster ended up, so the cell it draws can start
 * life exactly on top of it and travel from there. Held here rather than in
 * either component, because the moment the two disagree the move stops being
 * one move.
 *
 * `CLUSTER_FILL` is the share of its cell a cluster's dots occupy, and it is
 * what makes the two drawings the same size: the scene spreads dot centres
 * across `cellWidth * CLUSTER_FILL`, and the DOM cluster spreads its own dot
 * centres across its full box, so that product is the box the cell must be
 * scaled to.
 */
export const FLAT_W = 4.6;
export const FLAT_H = 3.0;
export const CAMERA_Z = 12;
export const CAMERA_FOV = 30;
export const CLUSTER_FILL = 0.66;

/** Where one block's cluster sits on the flattened plane, in world units. */
export function clusterCentre(index: number, tiles: number): { x: number; y: number; w: number; h: number } {
  const cols = Math.min(FLAT_COLS, Math.max(1, tiles));
  const rows = Math.max(1, Math.ceil(tiles / cols));
  const w = FLAT_W / cols;
  const h = FLAT_H / rows;
  return {
    x: -FLAT_W / 2 + ((index % cols) + 0.5) * w,
    y: FLAT_H / 2 - (Math.floor(index / cols) + 0.5) * h,
    w,
    h,
  };
}
