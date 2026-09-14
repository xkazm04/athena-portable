"use client";

/**
 * The Blocks — the whole sheet, and the only stateful component in the
 * direction.
 *
 * It owns the level, through the kit's shared L0/L1/L2 model, so "open a group"
 * means here exactly what it means everywhere else in this repo. It also owns
 * the CAMERA, which is round 3's change: one rig, created here, read by the
 * scene, by the L1 labels and by `useSemanticZoom`, so that a click, a wheel, an
 * Escape and an agent's `open_group` all end up in the same flight.
 *
 * ONE SPACE, THREE DEPTHS. There is no longer a picture at L0 and a page at L1.
 * `World.tsx` is mounted at every level and never unmounts; the level is where
 * the camera is. L2 is the one thing that is still a page — the dossier is text
 * and actions and belongs on paper — and the camera holds under it.
 *
 * MOTION IS TOKENISED HERE, at the root. `motion` 13's default layout
 * transition is a spring, which cannot be expressed as a `--bk-*` token and
 * settles fast enough that the dossier read as a cut; its `reducedMotion`
 * default is `"never"`, which contradicts the token file's claim to be running
 * law's durations verbatim. One `MotionConfig` fixes both.
 *
 * THE INK WAITS FOR THE BOX. A `layout` morph scale-corrects the element it owns
 * and not the type inside it, so the cell travelling out to the dossier drew its
 * own figures at three times their size on the way. `ink` below is the state
 * that fixes it: while the box is in flight the cell's lettering is held back,
 * and it is written again once the box has landed.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion as m } from "motion/react";
import {
  angleDelta,
  useCameraRig,
  useLevelFlight,
  useSemanticZoom,
  useZoomNav,
} from "@athena/demo-kit/zoom";

import { Dossier } from "./Dossier";
import { Field } from "./Field";
import { World } from "./World";
import { L0 } from "./l0/L0";
import { FieldHead } from "./field/Head";
import { cellsOf } from "./l0/cells";
import { BlocksTools } from "./tools";
import { useArrival } from "./useArrival";
import { useMotionTokens } from "./motion-tokens";
import { SheetFoot } from "./sheet/Foot";
import { SheetHead } from "./sheet/Head";
import { BANDS, BOUNDS, REST, poseFor, resolveGroup, resolveItem, snapNear } from "./space/camera";
import { useWheelZoom } from "./space/useWheelZoom";
import { databaseOf, tableOf, type BkSheet } from "./model";
import "./style/index.css";

/** Which cell is holding its ink back, and which way the box is travelling. */
export interface InkHold {
  ident: string;
  /** `out` — the box is leaving for the dossier. `back` — it is coming home. */
  phase: "out" | "back";
}

export function Blocks({ sheet }: { sheet: BkSheet }) {
  const nav = useZoomNav();
  // The picture is the only thing on screen at L0, so the sheet head carries the
  // frontier. Keeping it open is the reader's choice, not a default.
  const [showKinds, setShowKinds] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  const focus = nav.state.focus;
  const level = focus.level;
  const inside = level >= 1;

  /*
   * THE RIG. Bounds, drag, wheel, inertia, keyboard and the magnet, all from
   * `space/camera.ts` so the arithmetic is testable and this is only the wiring.
   * `flyToken` is `--bk-beat-flight`, which is `beats.ts`'s `FLIGHT` copied into
   * the cascade and pinned there by `test/beats.test.ts` — the one clock, read
   * by the camera rather than typed at it.
   */
  // Written in an effect rather than during render: the magnet is asked for an
  // answer on a pointer-up, long after any render, and a ref updated during
  // render is a side effect React is allowed to run twice.
  const insideRef = useRef(inside);
  useEffect(() => {
    insideRef.current = inside;
  }, [inside]);
  const rig = useCameraRig({
    initial: REST,
    bounds: BOUNDS,
    drag: "orbit",
    /* NOT the rig's. `zoomAt` is exact for an orthographic stage and off by the
       focal length for a perspective one, and the contract gives the rig no way
       to be told which it is driving. `useWheelZoom` runs the kit's own
       arithmetic with the anchor converted first; the argument is in that file,
       and it is round 3's clearest kit gap. */
    wheel: "none",
    inertia: 0.9,
    keyboard: true,
    reducedMotion: "user",
    flyToken: "--bk-beat-flight",
    easeToken: "--bk-ease",
    // The magnet, declining inside a database. A function rather than a list
    // because "only when idle and only if the pose is near one" is a decision
    // the list form cannot express.
    snap: (pose) => snapNear(pose, insideRef.current),
  });
  useWheelZoom(rig, frameRef);

  /*
   * `--bk-dur-6` is the safety net, not the clock: `beats.ts` is the clock, the
   * camera flies on `--bk-beat-flight`, and the arrival releases its claim when
   * the dressing is done. The net only matters for a move whose completion never
   * arrives.
   */
  const flight = useLevelFlight(nav, { fallbackToken: "--bk-dur-6", el: () => frameRef.current });
  const { phase, openDatabase } = useArrival(nav, flight);
  const motion = useMotionTokens();

  const database = inside ? databaseOf(sheet, focus.group) : undefined;
  const table = tableOf(sheet, focus.item);
  const cells = useMemo(() => cellsOf(sheet), [sheet]);

  /*
   * CAMERA DISTANCE IS THE LEVEL, both ways. Wheeling out past the band leaves
   * the database; every nav change that came from anywhere else — a click on a
   * cell, a legend key, an agent's `open_group`, Escape, an abort — is flown.
   * The hook marks which side is leading so the two cannot chase each other.
   */
  const idents = useMemo(
    () => new Map<string, string[]>(sheet.databases.map((d) => [d.id, d.tables.map((t) => t.ident)])),
    [sheet],
  );
  const { driving } = useSemanticZoom(nav, rig, {
    bands: BANDS,
    resolveGroup,
    resolveItem: (pose, group) => resolveItem(pose, group, idents.get(group) ?? []),
    poseFor,
    // So a level change the WHEEL caused claims and settles the same flight a
    // click's does, and Escape means the same thing in both.
    flight,
  });

  /*
   * ARRIVING BY WHEEL ARRIVES WHERE CLICKING WOULD HAVE.
   *
   * A nav-driven change flies to `poseFor`. A camera-driven one — the reader
   * wheeling in until the band is crossed — does not, by the contract's design:
   * the reader is driving and the kit will not fight them. That is right for the
   * ORBIT and wrong for the arrival, and this scene shows why. The tables stand
   * in the plane the camera flies in along and the reader's wheel has no opinion
   * about that plane, so zooming in from the resting pose crosses the band and
   * lands beside a rank of cards seen edge-on, at whatever distance the last
   * notch happened to leave; two more notches and the reader is through the far
   * wall of a database they never saw.
   *
   * So crossing the band IS a level change and gets a level change's flight,
   * exactly once, to exactly the pose a click would have flown to. Afterwards
   * the camera is the reader's again: `aligned` is the guard, so orbiting and
   * zooming inside the database are never undone, and the flight is only ever
   * spent on the crossing itself.
   */
  const aligned = useRef<string | null>(null);
  useEffect(() => {
    if (level < 1 || focus.group === null) {
      aligned.current = null;
      return;
    }
    if (driving !== "camera" || aligned.current === focus.group) return;
    aligned.current = focus.group;
    const want = poseFor(focus);
    const pose = rig.get();
    if (
      Math.abs(angleDelta(pose.yaw, want.yaw)) < 0.05 &&
      Math.abs(pose.pitch - want.pitch) < 0.05 &&
      Math.abs(pose.zoom - want.zoom) < 0.05
    ) {
      return;
    }
    /* NOT returned as this effect's cleanup. `driving` falls back to null a
       frame after the dispatch, which re-runs the effect, which would cancel the
       flight it had just started sixteen milliseconds in — and the reader would
       see the level change begin and stop. The flight is self-cancelling
       anyway: a second `flyTo`, a drag or a wheel notch all end it. */
    rig.flyTo(want);
  }, [driving, focus, level, rig]);

  /* The ink hold. See the header. */
  const open = level === 2 && table ? table.ident : null;
  const [ink, setInk] = useState<{ seen: string | null; hold: InkHold | null }>({
    seen: null,
    hold: null,
  });
  const holdMs = motion ? (motion.morph.duration + motion.medium.duration) * 1000 : 0;
  // Adjusted DURING RENDER, which is React's own recipe for state that follows a
  // prop, rather than in an effect: the hold has to be on the cell in the SAME
  // commit the dossier mounts, and an effect is one frame late — one frame of
  // lettering drawn at three times its size, which is the whole bug.
  if (ink.seen !== open) {
    setInk({
      seen: open,
      hold:
        open !== null
          ? { ident: open, phase: "out" }
          : ink.seen !== null
            ? { ident: ink.seen, phase: "back" }
            : null,
    });
  }
  const hold = ink.hold;
  useEffect(() => {
    if (hold?.phase !== "back") return;
    const id = window.setTimeout(() => setInk((s) => ({ ...s, hold: null })), holdMs);
    return () => window.clearTimeout(id);
  }, [holdMs, hold]);

  return (
    <div className="bk-root" data-variant="blocks" data-level={level}>
      <MotionConfig reducedMotion="user" transition={motion?.morph}>
        {/* The ingest layer: this direction's three levels, offered to an agent
            beside the page on `document.modelContext`. It opens a database
            through the same path a click takes, so the camera actually flies
            rather than the level being swapped under it. Renders nothing, and no
            tool it registers writes. */}
        <BlocksTools
          sheet={sheet}
          nav={nav}
          onOpenDatabase={openDatabase}
          showKinds={showKinds}
          setShowKinds={setShowKinds}
        />

        <div className="bk-sheet">
          <SheetHead sheet={sheet} />

          <div className="bk-stage">
            <World
              cells={cells}
              database={database}
              focus={focus}
              hovered={level === 0 ? hovered : null}
              rig={rig}
              frameRef={frameRef}
              moving={phase === "flight"}
              onHover={setHovered}
              onOpen={openDatabase}
            >
              {database ? (
                <Field
                  database={database}
                  phase={phase}
                  ink={hold}
                  rig={rig}
                  frame={frameRef}
                  onOpenTable={(ident) => nav.openItem(database.id, ident)}
                />
              ) : null}
            </World>

            {database ? (
              <FieldHead
                sheet={sheet}
                database={database}
                phase={phase}
                onOpenDatabase={openDatabase}
              />
            ) : (
              <L0
                cells={cells}
                focus={focus}
                hovered={hovered}
                onHover={setHovered}
                onOpen={openDatabase}
              />
            )}
          </div>

          <SheetFoot
            sheet={sheet}
            database={database}
            table={table}
            level={level}
            showKinds={showKinds}
            nav={nav}
          />
        </div>

        {/*
          * THE SCRIM IS NOT THE CARD'S, and that is why it is here.
          *
          * It dims the sheet while the table travels out of its cell, so it has
          * to fade in PARALLEL with the morph and out again after it — which is
          * an `AnimatePresence` of its own.
          */}
        <AnimatePresence>
          {level === 2 && table ? (
            <m.div
              key="bk-scrim"
              className="bk-dossier-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={motion?.medium}
              aria-hidden
            />
          ) : null}
        </AnimatePresence>

        {/* Keyed by the table, so a change of table is a new card and not the
            same card holding a different one. */}
        <AnimatePresence>
          {level === 2 && table ? (
            <Dossier key={table.ident} table={table} onClose={nav.up} motion={motion} />
          ) : null}
        </AnimatePresence>
      </MotionConfig>
    </div>
  );
}
