/**
 * The Projects scene's view-model — README section 3.5, ADR 0087, 0090 and 0225.
 *
 * What the scene draws is three sources joined, and nothing re-derived: the person's projects (the
 * spaces store, `SpaceSummary` as the daemon said it), the apps Athena has been told about (the
 * Browser module's `RegisteredApp`, whose standing is `appOf`'s), and the person's own chores (the
 * saved cases the Adopt studio keeps, ADR 0123). A project's apps are its origins drawn with the
 * registered app's monogram and standing when there is one, and as an app not opened when there
 * is not, so a project paired with an app that was since forgotten still says it has it.
 *
 * **The field is an orrery, and its geometry is here, pure.** Athena's core is the sun; each
 * project is an orbit at its own radius, oldest innermost so a ring never jumps when another is
 * edited; its apps are moons evenly spaced on it; the halo follows how much it remembers on a log
 * scale. Every number is a function of the index and the count, so a test holds the drawing still
 * and the view only places what it is told. Distances are in plane units: the plane is a square
 * 100 units wide, seen tilted, so a ring of radius `r` (a fraction of the half-width) is drawn
 * `50·r` units across and `50·r·TILT` units tall.
 *
 * **Paths name a project by its space id**, and core by the reserved `core` (`CORE_ITEM`), never
 * by the empty string the wire uses for it.
 */
import type { Path } from "@/depth/model";
import { CORE, CORE_ITEM, type SpaceErased, type SpaceInput, type SpaceMemoryKind, type SpaceMemoryPage, type SpacePatch, type SpaceSummary } from "@/lib/spaces";
import { monogramOf, type AppStanding, type RegisteredApp } from "@/modules/browser/model";

// -- places ----------------------------------------------------------------------------------------

export const fieldPath = (): Path => ({ root: "projects" });

/** A project's level, or core's when `id` is `CORE` or `CORE_ITEM`. */
export function projectPath(id: string): Path {
  return { root: "projects", item: id === CORE ? CORE_ITEM : id };
}

/** The memory level of a project or of core. */
export function memoryPath(id: string): Path {
  return { ...projectPath(id), sub: { kind: "memory" } };
}

/** The space id a path item names: `CORE` for `core`, the id otherwise; `null` off a project. */
export function spaceOfItem(item: string | undefined): string | null {
  if (item === undefined || item === "") return null;
  return item === CORE_ITEM ? CORE : item;
}

// -- the model ---------------------------------------------------------------------------------------

/** One app paired into a project, drawn as a moon. */
export interface ProjectApp {
  origin: string;
  host: string;
  monogram: string;
  standing: AppStanding;
  /** Athena has a row for it in her origins table; false for an origin since forgotten. */
  registered: boolean;
}

/** One of the person's saved chores (a case, ADR 0123). */
export interface ChoreRow {
  caseId: string;
  playbookId: string;
  title: string;
  /** The space it is linked to; `CORE` when none. */
  spaceId: string;
}

/** What is known of the person's chores: they are read once per entry, and can fail. */
export interface ChoresState {
  loaded: boolean;
  /** Why they could not be read, verbatim; "" when they could. */
  problem: string;
  rows: readonly ChoreRow[];
  /** "(showing N of M)" when the daemon cut the list, else "". */
  footer: string;
}

export interface Project {
  space: SpaceSummary;
  apps: readonly ProjectApp[];
  /** Its linked chores, as far as the chores have been read. */
  chores: readonly ChoreRow[];
  /** Episodes, facts and procedurals filed under it. */
  memories: number;
  /** Every turn is filed here now. */
  active: boolean;
  /** A switch to it waits for the turn that is running. */
  pending: boolean;
  /** 0..1: how bright its halo is. */
  halo: number;
}

/** What the scene asks of the stores. Each answer is the store's own; a refusal is its error. */
export interface ProjectsActions {
  create: (input: SpaceInput) => Promise<SpaceSummary>;
  update: (id: string, patch: SpacePatch) => Promise<SpaceSummary>;
  erase: (id: string) => Promise<SpaceErased>;
  memory: (id: string, kind?: SpaceMemoryKind) => Promise<SpaceMemoryPage>;
  promote: (id: string, memId: string) => Promise<void>;
  linkCase: (caseId: string, spaceId: string) => Promise<void>;
}

export interface ProjectsModel {
  /** In orbit order: oldest first. */
  projects: readonly Project[];
  loaded: boolean;
  /** Why the projects could not be read, verbatim; "" when they could. */
  problem: string;
  activeId: string;
  pending: string | null;
  /** The apps Athena has been told about, for "Add app". */
  registered: readonly RegisteredApp[];
  chores: ChoresState;
  actions: ProjectsActions;
}

export interface ProjectsSources {
  spaces: readonly SpaceSummary[];
  loaded: boolean;
  problem: string;
  activeId: string;
  pending: string | null;
  registered: readonly RegisteredApp[];
  chores: ChoresState;
  actions: ProjectsActions;
}

export const memoriesOf = (s: SpaceSummary): number => s.counts.episodes + s.counts.facts + s.counts.procedurals;

/** The host of an origin, or the origin itself when it does not parse. */
export function hostOfOrigin(origin: string): string {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
}

/** One paired origin, as the registered app it is, or as an app not opened when it is none. */
export function projectApp(origin: string, registered: readonly RegisteredApp[]): ProjectApp {
  const app = registered.find((a) => a.origin === origin);
  if (app) return { origin, host: app.host, monogram: app.monogram, standing: app.standing, registered: true };
  const host = hostOfOrigin(origin);
  return { origin, host, monogram: monogramOf(host), standing: "closed", registered: false };
}

/** Oldest first, ties by id: a ring's place never depends on which project was edited last. */
export function orbitOrder(spaces: readonly SpaceSummary[]): SpaceSummary[] {
  return [...spaces].sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
}

export function selectProjects(src: ProjectsSources): ProjectsModel {
  const projects = orbitOrder(src.spaces).map((space): Project => {
    const memories = memoriesOf(space);
    return {
      space,
      apps: space.apps.map((origin) => projectApp(origin, src.registered)),
      chores: src.chores.rows.filter((c) => c.spaceId === space.id),
      memories,
      active: src.activeId === space.id,
      pending: src.pending === space.id,
      halo: haloOf(memories),
    };
  });
  return {
    projects,
    loaded: src.loaded,
    problem: src.problem,
    activeId: src.activeId,
    pending: src.pending,
    registered: src.registered,
    chores: src.chores,
    actions: src.actions,
  };
}

export function projectFor(model: ProjectsModel, id: string): Project | null {
  return model.projects.find((p) => p.space.id === id) ?? null;
}

// -- words ---------------------------------------------------------------------------------------------

export const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "3 apps · 4 chores · 212 memories": a project in one line. The chores are the daemon's count. */
export function countsLine(p: Project): string {
  return [plural(p.space.apps.length, "app"), plural(p.space.counts.chores, "chore"), plural(p.memories, "memory", "memories")].join(" · ");
}

/** The first line of a brief, or "" when it has none. */
export function briefLine(brief: string): string {
  return brief.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "") ?? "";
}

// -- the orrery's geometry -------------------------------------------------------------------------------

/**
 * The plane, seen tilted. `tilt` is how tall a ring is for its width; `inner` and `outer` bound
 * the radii (fractions of the half-width) so the innermost ring clears the sun and the outermost
 * stays on the stage; `gap` is the most room two rings get, so three projects do not fly apart.
 */
export const PLANE = { tilt: 0.5, inner: 0.36, outer: 0.97, gap: 0.17 } as const;

/** Past this many rings the orrery is a fingerprint; the rest are listed under it, said as such. */
export const MAX_ORBITS = 12;

/** The most moons one ring carries before the rest are one "+N" moon. */
export const MAX_MOONS = 10;

/** The radius of ring `index` of `count`: evenly from the inside, never further apart than `gap`. */
export function orbitRadius(index: number, count: number): number {
  if (count <= 1) return PLANE.inner + PLANE.gap;
  const gap = Math.min(PLANE.gap, (PLANE.outer - PLANE.inner) / (count - 1));
  return round(PLANE.inner + gap * index);
}

/**
 * How long one turn of ring `index` takes, in seconds: the outer rings are slower, as a real
 * orrery's are, and slow enough that the drift is felt rather than watched.
 */
export function orbitPeriod(index: number): number {
  return 140 + index * 45;
}

/** Every other ring turns the other way, so the field never reads as one wheel. */
export const orbitReverse = (index: number): boolean => index % 2 === 1;

/**
 * Where the name of ring `index` sits, in degrees (0 = east, 90 = south). Its neighbours are on the
 * far side, and the sequence keeps off due north and south, where the tilted rings crowd the sun.
 */
const LABEL_ANGLES = [-28, 152, 28, 208, -58, 122, 58, 238, -8, 172, 8, 188] as const;
export function labelAngle(index: number): number {
  return LABEL_ANGLES[index % LABEL_ANGLES.length]!;
}

/** How many moons ring `radius` carries before it would crowd them: by its length, at most `MAX_MOONS`. */
export function moonCapacity(radius: number): number {
  const length = 2 * Math.PI * radius * 50 * ((1 + PLANE.tilt) / 2);
  return Math.max(3, Math.min(MAX_MOONS, Math.floor(length / 6)));
}

/**
 * The angles of `count` moons on a ring whose name sits at `label`: evenly around it, starting a
 * half step past the name so none is born under it.
 */
export function moonAngles(count: number, label: number): number[] {
  return Array.from({ length: count }, (_, i) => round(label + (360 * (i + 0.5)) / count));
}

/** The moons a ring shows, and how many it does not (drawn as one "+N" moon). */
export function moonsOf(apps: readonly ProjectApp[], radius: number): { shown: readonly ProjectApp[]; more: number } {
  const room = moonCapacity(radius);
  if (apps.length <= room) return { shown: apps, more: 0 };
  return { shown: apps.slice(0, room - 1), more: apps.length - (room - 1) };
}

/**
 * The halo: 0 for nothing remembered, 1 at a thousand memories, logarithmic between, so the first
 * dozen show and the thousandth does not drown the rest.
 */
export function haloOf(memories: number): number {
  if (memories <= 0) return 0;
  return round(Math.min(1, Math.log10(1 + memories) / 3));
}

/** A point on ring `radius` at `degrees`, in plane units from the centre, as seen tilted. */
export function spotOf(degrees: number, radius: number): { x: number; y: number } {
  const a = (degrees * Math.PI) / 180;
  return { x: round(Math.cos(a) * radius * 50), y: round(Math.sin(a) * radius * 50 * PLANE.tilt) };
}

/** One ring, ready to draw. */
export interface Orbit {
  radius: number;
  period: number;
  reverse: boolean;
  label: { angle: number; x: number; y: number };
  moons: readonly { app: ProjectApp; angle: number }[];
  /** Moons not drawn, shown as one "+N" moon at the end of the ring. */
  more: number;
  moreAngle: number;
}

export function orbitOf(project: Project, index: number, count: number): Orbit {
  const radius = orbitRadius(index, count);
  const angle = labelAngle(index);
  const { shown, more } = moonsOf(project.apps, radius);
  const angles = moonAngles(shown.length + (more > 0 ? 1 : 0), angle);
  return {
    radius,
    period: orbitPeriod(index),
    reverse: orbitReverse(index),
    label: { angle, ...spotOf(angle, radius) },
    moons: shown.map((app, i) => ({ app, angle: angles[i]! })),
    more,
    moreAngle: more > 0 ? angles[angles.length - 1]! : 0,
  };
}

/** The rings the orrery draws, and the projects past `MAX_ORBITS` it lists instead. */
export function orrery(projects: readonly Project[]): { rings: { project: Project; orbit: Orbit }[]; rest: readonly Project[] } {
  const drawn = projects.slice(0, MAX_ORBITS);
  return {
    rings: drawn.map((project, i) => ({ project, orbit: orbitOf(project, i, drawn.length) })),
    rest: projects.slice(MAX_ORBITS),
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
