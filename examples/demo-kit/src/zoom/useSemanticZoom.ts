"use client";

/**
 * Camera distance IS the level. `docs/kit-camera-contract.md` §3, the wiring.
 *
 * Two things can move the reader between depths and they must not fight:
 *
 *   · the CAMERA — a wheel, a pinch, a drag that crosses a band. The hook dispatches
 *     `nav.openGroup` / `nav.openItem` / `nav.up`, so tools, Escape, focus and the flight go on
 *     seeing one truth. The nav is still the model; the camera is just another way to press it.
 *   · the NAV — a click, an agent tool, Escape, a breadcrumb. The hook calls
 *     `rig.flyTo(poseFor(focus))`, so the reader is carried to the new depth instead of being
 *     cut to it.
 *
 * THE LOOP THIS AVOIDS, since it is the whole reason the hook exists. Each of those causes the
 * other: dispatching from the camera changes the nav, which would fly the camera, which crosses
 * a band, which dispatches. So one `driving` ref marks who is leading, and the follower ignores
 * the echo of its own action — matched by the focus it dispatched, not just by a flag, so that a
 * genuine nav change arriving mid-fly is still honoured (a reader clicking a breadcrumb while
 * the camera is flying somewhere else must win).
 *
 * AND IT STILL BUMPS THE FLIGHT. A camera-driven level change goes through the nav reducer, so
 * `nav.state.flight` advances exactly as a click's would; `useLevelFlight` sees it, the echo
 * plays, and the flight settles when the fly or the coast finishes. Pass the flight in
 * `options.flight` and the hook claims and settles it for you; leave it out and the surface's
 * own fallback ends the move.
 *
 * `levelForZoom` — the part that can be wrong, the hysteresis that stops a band flapping — is
 * pure in `./semantic.ts` and pinned by `test/semantic.test.ts`.
 */
import { useEffect, useRef, useState } from "react";

import type { CameraPose } from "./camera";
import type { CameraRig } from "./useCameraRig";
import { SEMANTIC_HYSTERESIS, levelForZoom } from "./semantic";
import type { Nav } from "./nav";
import type { Focus, Level } from "./state";
import { ARMING_FLIGHT } from "./flight";
import type { LevelFlight } from "./useLevelFlight";

export interface SemanticZoomOptions {
  /** Zoom thresholds: at or above `l1` the camera is in a group, at or above `l2` in an item. */
  bands: readonly [l1: number, l2: number];
  /** Which group is under the camera at this pose. `null` when the answer is "none of them". */
  resolveGroup(pose: CameraPose): string | null;
  /** Which item, once the group is known. `null` leaves the camera at L1. */
  resolveItem(pose: CameraPose, group: string): string | null;
  /** Where the camera goes for a focus the nav arrived at some other way. */
  poseFor(focus: Focus): Partial<CameraPose>;
  /** Fraction of a band a crossing must overshoot. Default `SEMANTIC_HYSTERESIS` (0.08). */
  hysteresis?: number;
  /**
   * The surface's flight, if it has one.
   *
   * NOT IN THE CONTRACT — the contract asks for "a camera-driven level change must still bump
   * flight and settle when the flyTo/idle completes", and settling needs the flight object. Pass
   * the value `useLevelFlight` returned; the hook claims each flight it causes and settles it
   * when the camera stops.
   */
  flight?: Pick<LevelFlight, "flight" | "settle" | "claim">;
}

export interface SemanticZoom {
  /** The level the camera implies right now. Usually equal to `nav.state.focus.level`. */
  level: Level;
  /** Who is currently leading, for a surface that wants to style the difference. */
  driving: "camera" | "nav" | null;
}

/** Only these members of the nav are touched. */
export type SemanticNav = Pick<Nav, "state" | "openGroup" | "openItem" | "up">;

export function useSemanticZoom(
  nav: SemanticNav,
  rig: CameraRig,
  options: SemanticZoomOptions,
): SemanticZoom {
  const opts = useRef(options);
  opts.current = options;
  const navRef = useRef(nav);
  navRef.current = nav;

  const [level, setLevel] = useState<Level>(nav.state.focus.level);
  const [driving, setDriving] = useState<"camera" | "nav" | null>(null);

  /* Who is leading, as a ref as well as state: the rig calls back on animation frames, long
     before a render could have told it. */
  const lead = useRef<"camera" | "nav" | null>(null);
  /** The level this hook asked the nav for, so its own echo is recognisable. */
  const asked = useRef<Level | null>(null);
  /** The flight this hook caused and owes a settle for, and the claim holding it open. */
  const owed = useRef<{ flight: number; release: () => void } | null>(null);

  const setLead = (next: "camera" | "nav" | null) => {
    lead.current = next;
    setDriving(next);
  };

  const finish = () => {
    const owe = owed.current;
    owed.current = null;
    if (owe) {
      owe.release();
      opts.current.flight?.settle(owe.flight);
    }
    if (lead.current === "camera") setLead(null);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  /* Arm the flight's self-settle: from here on a level change nobody claims is over in a frame
     rather than at the end of the fallback. See `ARMING_FLIGHT`. */
  useEffect(() => {
    const flight = opts.current.flight;
    if (!flight) return;
    return flight.claim(ARMING_FLIGHT);
  }, []);

  /* ------------------------------------------------------------------ the camera drives the nav */

  useEffect(() => {
    let first = true;
    const off = rig.subscribe((pose, moving) => {
      const o = opts.current;
      const focus = navRef.current.state.focus;
      const implied = levelForZoom(
        pose.zoom,
        o.bands,
        o.hysteresis ?? SEMANTIC_HYSTERESIS,
        focus.level,
      );
      setLevel((was) => (was === implied ? was : implied));

      /* The very first callback is `subscribe` handing over the pose it already had, not a
         movement. Acting on it would dispatch a nav action during mount. */
      if (first) {
        first = false;
        return;
      }

      if (implied !== focus.level && lead.current !== "nav") {
        drive(implied, pose);
      }

      /* The camera has come to rest after a change it caused: the move is over. */
      if (!moving && owed.current && lead.current === "camera") finishRef.current();
    });
    return off;

    function drive(next: Level, pose: CameraPose) {
      const o = opts.current;
      const n = navRef.current;
      const focus = n.state.focus;

      if (next < focus.level) {
        asked.current = next;
        setLead("camera");
        n.up();
        return;
      }
      const group = o.resolveGroup(pose);
      if (!group) return;
      if (next === 1) {
        if (focus.level === 1 && focus.group === group) return;
        asked.current = 1;
        setLead("camera");
        n.openGroup(group);
        return;
      }
      const item = o.resolveItem(pose, group);
      if (!item) {
        // Close enough for an item but the surface cannot say which one: stop at the group
        // rather than guessing, and let the reader's next movement decide.
        if (focus.level === 1 && focus.group === group) return;
        asked.current = 1;
        setLead("camera");
        n.openGroup(group);
        return;
      }
      if (focus.level === 2 && focus.group === group && focus.item === item) return;
      asked.current = 2;
      setLead("camera");
      n.openItem(group, item);
    }
  }, [rig]);

  /* ------------------------------------------------------------------ the nav drives the camera */

  const flightNo = nav.state.flight;
  const focus = nav.state.focus;

  useEffect(() => {
    const o = opts.current;
    const mine = lead.current === "camera" && asked.current === focus.level;
    asked.current = null;

    if (mine) {
      /* Our own dispatch, come back round. The camera is already where it wants to be, so the
         only thing left is to hold the flight open until it stops moving. */
      owed.current?.release();
      const release = o.flight?.claim(flightNo) ?? (() => {});
      owed.current = { flight: flightNo, release };
      if (rig.moving) return;
      // Already at rest — a wheel tick does not coast. One frame, so the arriving level has
      // been painted, and the move is done.
      const id = requestAnimationFrame(() => finishRef.current());
      return () => cancelAnimationFrame(id);
    }

    /* Anything else moved the nav: a click, a tool, Escape, an abort. Carry the reader there. */
    owed.current?.release();
    owed.current = null;
    setLead("nav");
    const release = o.flight?.claim(flightNo) ?? (() => {});
    const cancel = rig.flyTo(o.poseFor(focus), {
      onDone: () => {
        release();
        o.flight?.settle(flightNo);
        if (lead.current === "nav") setLead(null);
      },
    });
    return () => {
      cancel();
      release();
    };
    // `focus` is the value `flightNo` counts, so the counter alone is the dependency — and it is
    // monotonic, which is what makes a re-open of the same focus still fly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flightNo, rig]);

  return { level, driving };
}
