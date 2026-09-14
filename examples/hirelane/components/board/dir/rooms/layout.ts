/**
 * Where the rooms, the tables and the seats are. Pure arithmetic, no React.
 *
 * THE SET. Five rooms in a row, one per stage, drawn as a cutaway seen from
 * above: the floor plane is pitched back under `perspective` so the near edge
 * of each room is closer to the reader than the far one, and the whole row is
 * one scene the camera pans and zooms over. A room is a place with a fixed
 * address, which is the entire concept under test — a reader who opens Backend
 * screening and comes back out has not watched a level re-mount, they have
 * walked out of a room that is still where they left it.
 *
 * WHY EVERY NUMBER IS HERE. `design/check-law.mjs` reads the stylesheets for
 * raw lengths and the TypeScript for raw motion; the geometry of a stage set is
 * neither a spacing step nor a duration, and `carousel/pose.ts` already set the
 * precedent that such numbers live in one named module that the surface reads
 * from. Nothing below is a scale value and nothing below is typed twice.
 *
 * THE COORDINATE SYSTEM. Scene units, which are px at zoom 1, origin at the
 * centre of the row of rooms, x to the right and y DOWN the floor (away from
 * the reader after the pitch). That is the same handedness the DOM uses, so a
 * pose translates to `translate3d` without a sign flip anywhere.
 */

/**
 * A room's floor, in scene units. Solved from the frame, not chosen.
 *
 * Five rooms have to be on screen AT ONCE or the concept is not being tested:
 * the claim is that a reader can see where they are about to go and where they
 * have just been, and a set whose first and last rooms are off the edge at rest
 * is a set with no such property. So the pitch — a room plus its wall — times
 * five is inside the widest frame this app is designed for, and `ZOOM_REST`
 * below trims what is left.
 *
 * The first cut was 520 wide and produced exactly that failure: three rooms
 * visible out of five, with Applied and Rejected off both edges.
 */
export const ROOM_W = 300;
export const ROOM_D = 330;
/** The cutaway wall between two rooms: you can see over it, which is the point. */
export const WALL = 28;

/** How far apart two tables stand on one floor, centre to centre. */
const TABLE_PITCH = 168;
/** Floor left clear beyond the outermost table, so a room has walls. */
const FLOOR_MARGIN = 46;
/** The table top itself: an ellipse, wider than it is deep, seen from above. */
export const TABLE_RX = 92;
export const TABLE_RY = 48;
/** How far a seated token sits outside the table's edge. Exported because the
 *  test asserts the seats lie on exactly that ring, and a second copy of the
 *  number in the test would be a test of the copy. */
export const SEAT_OUT = 26;

/**
 * Seats drawn before the table stops and counts the rest.
 *
 * The same argument `columns/stacking.ts` makes about the pile: twelve whole
 * monograms around a table is a group you can count, and twenty overlapping
 * ones is a texture. The thirteenth person onward is a `+N` on the table top,
 * which is an exact statement rather than a smear.
 */
export const SEAT_CAP = 12;

export interface Point {
  x: number;
  y: number;
}

/**
 * The centre of room `index` of `count`, in scene units.
 *
 * Stage order left to right, because that is the direction the pipeline runs
 * and the shipped board already spends the horizontal axis on it. Centred on
 * the origin so a camera at pan 0/0 frames the middle of the process rather
 * than its first room.
 */
export function roomOrigin(index: number, count: number): Point {
  const pitch = ROOM_W + WALL;
  return { x: (index - (count - 1) / 2) * pitch, y: 0 };
}

/**
 * How deep a room has to be to hold `tables` tables.
 *
 * A ROOM GROWS WITH WHAT IS IN IT rather than the tables being squeezed into a
 * fixed floor, and the first cut of this file got it the other way round: four
 * open roles in one stage put two tables through the back wall. A pipeline with
 * more roles open at a stage is a bigger room, which is also the true reading —
 * and because it is the FLOOR that changes and not the pitch, `tableAt()` stays
 * the exact inverse of `tablePose()` at every count.
 */
export function roomDepth(tables: number): number {
  const needed = Math.max(0, tables - 1) * TABLE_PITCH + 2 * (TABLE_RY + FLOOR_MARGIN);
  return Math.max(ROOM_D, needed);
}

/** The whole set's extent, which is what the camera's pan bounds are cut from. */
export function setExtent(count: number, deepest = 1): { w: number; h: number } {
  const pitch = ROOM_W + WALL;
  return { w: count > 0 ? (count - 1) * pitch + ROOM_W : 0, h: roomDepth(deepest) };
}

/**
 * Where table `index` of `count` stands on a room's floor, relative to the
 * room's own centre.
 *
 * A column down the room, not a grid: a stage holds one table per open role and
 * a real pipeline has more roles than rooms, so the axis that has to scale is
 * the one the floor can be lengthened along. Two roles is the seeded case and
 * it reads as two tables in a room rather than as a row of anything.
 */
export function tablePose(index: number, count: number): Point {
  return { x: 0, y: (index - (count - 1) / 2) * TABLE_PITCH };
}

/**
 * Where seat `index` of `count` sits around a table, relative to the table's
 * own centre.
 *
 * The first seat is at the TOP of the ellipse and they run clockwise, so the
 * strongest candidate — the array arrives `byScoreDesc` — sits at the head of
 * the table facing the reader. The ellipse is the table's own radii plus a
 * constant reach, so a token sits outside the top rather than on it, which is
 * what makes the arrangement read as seating rather than as a pie chart.
 */
export function seatPose(index: number, count: number): Point {
  if (count <= 0) return { x: 0, y: 0 };
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  return {
    x: Math.cos(angle) * (TABLE_RX + SEAT_OUT),
    y: Math.sin(angle) * (TABLE_RY + SEAT_OUT),
  };
}

/** How many of a group are seated, and how many are counted instead. */
export function seatingFor(total: number): { seated: number; hidden: number } {
  const seated = Math.min(total, SEAT_CAP);
  return { seated, hidden: total - seated };
}

/* ------------------------------------------------------------- the camera */

/**
 * The zoom the set rests at, the zoom a room is read at, and the zoom one
 * table's candidates are read at.
 *
 * They are the semantic-zoom bands as well: crossing REST→ROOM with the wheel
 * IS opening the group under the camera, and crossing ROOM→TABLE is opening the
 * candidate under it. One number, two jobs, which is the concept — camera
 * distance is the level, and there is no second definition of what level you
 * are on.
 */
/**
 * `ZOOM_REST` is BELOW 1 on purpose: it is the last of the fit, after the
 * geometry has done its part. Five rooms at their own pitch are 1612 units
 * across and the frame this app is designed for is 1440 minus its gutters, so
 * the set rests a little further back than its own scale.
 */
export const ZOOM_REST = 0.82;
export const ZOOM_ROOM = 1.7;
export const ZOOM_TABLE = 2.9;

/** The rig's bounds. Out to half a room past either end, in at the table. */
export function roomsBounds(
  count: number,
  deepest = 1,
): {
  zoom: [number, number];
  pan: { x: [number, number]; y: [number, number] };
} {
  const extent = setExtent(count, deepest);
  const x = extent.w / 2 + ROOM_W / 2;
  const y = extent.h;
  return { zoom: [ZOOM_REST * 0.7, ZOOM_TABLE * 1.2], pan: { x: [-x, x], y: [-y, y] } };
}

/**
 * Where the camera stands to look at one room — or at the whole set, when no
 * room is named.
 *
 * The pan is the NEGATIVE of the room's origin because the pan translates the
 * scene under a fixed camera, which is what a CSS transform on the scene root
 * does. Getting that sign wrong flies away from the room you clicked, which
 * looks like a state bug and is a coordinate one.
 */
export function roomPose(
  index: number | null,
  count: number,
  table: number | null = null,
  tables = 1,
): { zoom: number; pan: Point } {
  if (index === null) return { zoom: ZOOM_REST, pan: { x: 0, y: 0 } };
  const room = roomOrigin(index, count);
  const seat = table === null ? { x: 0, y: 0 } : tablePose(table, tables);
  return {
    zoom: table === null ? ZOOM_ROOM : ZOOM_TABLE,
    pan: { x: -(room.x + seat.x), y: -(room.y + seat.y) },
  };
}

/**
 * Which room the camera is standing over, given its pan.
 *
 * The inverse of `roomPose`, and it has to be exactly that or the wheel and the
 * click disagree about which group is open. Nearest centre wins; there is no
 * dead zone, because the hysteresis that stops a wheel flapping between two
 * levels belongs to the kit's `useSemanticZoom` and not to a second copy here.
 */
export function roomAt(pan: Point, count: number): number | null {
  if (count <= 0) return null;
  const pitch = ROOM_W + WALL;
  const raw = -pan.x / pitch + (count - 1) / 2;
  return Math.max(0, Math.min(count - 1, Math.round(raw)));
}

/** Which table on that room's floor, by the same arithmetic down the y axis. */
export function tableAt(pan: Point, tables: number): number | null {
  if (tables <= 0) return null;
  const raw = -pan.y / TABLE_PITCH + (tables - 1) / 2;
  return Math.max(0, Math.min(tables - 1, Math.round(raw)));
}
