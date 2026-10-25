/**
 * The orrery — README section 3.1 and 3.5, ADR 0087 and 0225.
 *
 * Athena's core is the sun at the centre, drawn as her bell with one tendril per project (lit for
 * the one she is working in). Each project is a ring around her in its own hue, its apps riding it
 * as moons (`AppOrb`, the Apps scene's own drawing, small), and a halo that brightens with what it
 * remembers. Stylised art, drawn for this scene: nothing here is a screenshot of anything.
 *
 * **Everything that moves is a transform on the compositor.** The plane is a square squashed to
 * `PLANE.tilt`; a ring turns with `rotate`; each moon sits on an arm at its own angle and turns
 * back by the ring's turn plus its arm's and is stretched back by `1 / tilt`, so it rides an
 * ellipse while staying upright and round. No script runs per frame, and under Calm (the person's
 * choice or the OS's reduced motion, both written to `data-motion` by `lib/motion.ts`) nothing
 * turns: every moon rests where its angle puts it.
 *
 * The rings and moons are decorative (`aria-hidden`). What a person acts on is HTML on top: the
 * sun, and one name per ring, each a real button placed at the ring's label spot in plane units,
 * so a narrow window moves the names with their rings. A screen reader reads the buttons in orbit
 * order, each naming the project and its counts.
 */
import type { CSSProperties, ReactNode } from "react";

import Bell from "@/bell/Bell";
import AppOrb from "@/scenes/apps/orb";

import { countsLine, PLANE, type Orbit, type Project } from "./model";

type Vars = CSSProperties & Record<`--${string}`, string | number>;

/** The size every drawing below is told it is; CSS sizes it again in plane units. */
const MOON_PX = 40;
const SUN_PX = 96;

/** One ring and its moons, in the project's hue. */
export function OrbitRing({
  project,
  orbit,
  hot = false,
  dim = false,
}: {
  project: Project;
  orbit: Orbit;
  /** Under the pointer or the focus: it brightens. */
  hot?: boolean;
  /** Another ring is: this one steps back. */
  dim?: boolean;
}) {
  const style: Vars = {
    "--r": orbit.radius,
    "--period": `${orbit.period}s`,
    "--hue": project.space.hue,
    "--halo": project.halo,
  };
  return (
    <div
      className="orbit"
      style={style}
      data-reverse={orbit.reverse ? "1" : undefined}
      data-hot={hot ? "1" : undefined}
      data-dim={dim ? "1" : undefined}
      data-active={project.active ? "1" : undefined}
      data-quiet={project.halo === 0 ? "1" : undefined}
      aria-hidden="true"
    >
      {orbit.moons.map(({ app, angle }) => (
        <span key={app.origin} className="orbit__arm" style={{ "--a": `${angle}deg` } as Vars}>
          <span className="moon" data-standing={app.standing}>
            <AppOrb monogram={app.monogram} standing={app.standing} size={MOON_PX} />
          </span>
        </span>
      ))}
      {orbit.more > 0 ? (
        <span className="orbit__arm" style={{ "--a": `${orbit.moreAngle}deg` } as Vars}>
          <span className="moon moon--more">+{orbit.more}</span>
        </span>
      ) : null}
    </div>
  );
}

/** Athena at the centre: her bell, with a tendril for each project, lit for the active one. */
export function Sun({ projects }: { projects: readonly Project[] }) {
  return (
    <span className="sun__art" aria-hidden="true">
      <Bell pose="resting" reach={projects.map((p) => ({ id: p.space.id, lit: p.active }))} size={SUN_PX} />
    </span>
  );
}

/** The plane every ring is drawn on, seen tilted. Its children are rings. */
export function Plane({ children }: { children: ReactNode }) {
  return (
    <div className="orrery__plane" aria-hidden="true">
      {children}
    </div>
  );
}

/** Where a ring's name sits, in plane units from the centre, as the stage's CSS reads it. */
export function labelStyle(orbit: Orbit, hue: number): Vars {
  return { "--x": orbit.label.x, "--y": orbit.label.y, "--hue": hue };
}

/** The tilt as the stage's CSS reads it: one number, the model's. */
export const TILT_STYLE: Vars = { "--k": PLANE.tilt };

/** A project in the words its button is read with. */
export function projectSaid(p: Project, showing?: { shown: number }): string {
  const apps = showing && showing.shown < p.apps.length ? ` (showing ${showing.shown} of ${p.apps.length} apps)` : "";
  const here = p.active ? " Athena is working in it." : p.pending ? " Athena switches to it after this turn." : "";
  return `${p.space.name || "Untitled project"}: ${countsLine(p)}.${apps}${here} Open it.`;
}
