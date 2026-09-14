/**
 * The plane the L0 picture flattens into, and the camera that looks at it.
 *
 * Six numbers and two functions, and they are the whole hand-off between the
 * levels. The picture reads them to decide where a table's cluster comes to
 * rest; the DOM reads them to work out where on screen that cluster ended up, so
 * the cell it draws can start life exactly on top of it. They live on their own
 * because the moment the two sides disagree about any of them, a followable move
 * becomes a cut.
 *
 * ROUND 2 MADE THE PLANE AN ELEMENT. There used to be exactly one L0 — a WebGL
 * cube — so "where the plane is on screen" could be derived from the canvas box
 * and the camera. There are now three prototype L0s and one of them draws no
 * canvas at all, so instead every variant PUBLISHES the plane: it renders an
 * empty, inert `.bk-l0-plane` box at the place its own picture flattens into,
 * and `field/useLanding.ts` measures that one element whichever variant is
 * mounted. The WebGL variants size theirs from the camera arithmetic below; the
 * plate sizes its by laying its opened tile onto it. One rectangle, one reader.
 */

/**
 * Columns the L1 tile grid uses, and the flatten targets copy.
 *
 * Declared once and read by both, because the whole point of the transition is
 * that the clusters the picture forms land where the tiles are about to be. It
 * went from four to three with the nine databases: a database holds five or six
 * tables, which is two neat rows of three and not a row of four with a ragged
 * two under it.
 */
export const FLAT_COLS = 3;

/**
 * The flattened plane, and the camera looking at it.
 *
 * `CLUSTER_FILL` is the share of its cell a cluster's dots occupy, and it is
 * what makes the two drawings the same size: the scene spreads dot centres
 * across `cellWidth * CLUSTER_FILL`, and the DOM cluster spreads its own dot
 * centres across its full box, so that product is the box the cell must be
 * scaled to.
 */
export const FLAT_W = 4.6;
export const FLAT_H = 3.0;
export const CAMERA_Z = 9.5;
export const CAMERA_FOV = 30;
export const CLUSTER_FILL = 0.66;

/** The plane's own proportions, which every variant's `.bk-l0-plane` wears. */
export const PLANE_ASPECT = FLAT_W / FLAT_H;

/**
 * What share of a canvas's HEIGHT the plane covers, for a canvas drawn by this
 * camera.
 *
 * A perspective camera at `CAMERA_Z` looking through `CAMERA_FOV` degrees sees a
 * known number of world units across the canvas's height; the plane is `FLAT_H`
 * of them. The WebGL variants set their plane box from this rather than from a
 * percentage somebody measured, so the box and the dots cannot drift.
 */
export function planeHeightFraction(): number {
  const unitsAcrossHeight = 2 * Math.tan(((CAMERA_FOV / 2) * Math.PI) / 180) * CAMERA_Z;
  return FLAT_H / unitsAcrossHeight;
}

/** Where one table's cluster sits on the flattened plane, in world units. */
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
