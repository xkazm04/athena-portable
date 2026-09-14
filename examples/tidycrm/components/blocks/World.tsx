"use client";

/**
 * THE WORLD — the one frame every level is looked at through.
 *
 * It is the canvas, the camera's own controls, and the layer the L1 labels are
 * projected onto. One element, mounted once, at every level: L0 is the camera
 * outside the cube, L1 is the camera inside one octant, L2 is that same camera
 * holding still under a DOM pane. Nothing here mounts or unmounts on a level
 * change, which is what round 3 is testing — the level is a place the reader
 * moved to, not a page that replaced the last one.
 *
 * THE RIG IS BOUND TO THE FRAME, NOT TO THE CANVAS, and that is deliberate: the
 * projected labels are children of the frame, so a drag that starts on a table's
 * card still orbits the scene (`Field.tsx` tells a drag from a click). A rig
 * bound to the canvas would have made the level the reader spends most time in
 * the one level they cannot turn.
 *
 * WHAT IT COSTS. `frameloop="demand"`. The scene draws on a pose the rig emits
 * and on a hover that changes a weight, and never otherwise; a settled world
 * draws zero frames and issues zero calls, which the round-3 capture measures.
 */

import { Canvas } from "@react-three/fiber";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import type { Focus } from "@athena/demo-kit/zoom";

import type { CameraRig } from "@athena/demo-kit/zoom";
import { OctantScene } from "./l0/octants/Scene";
import type { L0Cell } from "./l0/contract";
import { CAMERA_FOV, CAMERA_Z, type BkDatabase } from "./model";
import { useReducedMotionQuery } from "./l0/useReduced";
import { poseName, POSES } from "./space/camera";

export function World({
  cells,
  database,
  focus,
  hovered,
  rig,
  frameRef,
  moving,
  onHover,
  onOpen,
  children,
}: {
  cells: L0Cell[];
  /** The database the camera is inside, or undefined at L0. */
  database: BkDatabase | undefined;
  focus: Focus;
  hovered: string | null;
  rig: CameraRig;
  /** Handed up so `Field.tsx` can project into the same box. */
  frameRef: RefObject<HTMLDivElement | null>;
  /** True while the camera is flying: the labels are not drawn and the note says so. */
  moving: boolean;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
  /** The projected L1 labels. Children of the frame, so a drag over them orbits. */
  children: ReactNode;
}) {
  const { ref: bindRef, ...bind } = rig.bind;
  const frame = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotionQuery();

  return (
    <div className="bk-world">
      <div
        className="bk-l0-canvas"
        ref={(node) => {
          frame.current = node;
          frameRef.current = node;
          bindRef(node);
        }}
        {...bind}
        role="application"
        aria-label="Nine databases in one volume. Drag to orbit, wheel to zoom, Home to reset."
        data-moving={moving}
      >
        <Canvas
          camera={{ position: [0, 0, CAMERA_Z], fov: CAMERA_FOV, near: 0.05, far: 100 }}
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: true }}
          frameloop="demand"
          onPointerMissed={() => onHover(null)}
        >
          <OctantScene
            cells={cells}
            database={database}
            focus={focus}
            hovered={hovered}
            rig={rig}
            showSlabs={focus.level >= 1}
            reduced={reduced}
            onHover={onHover}
            onOpen={onOpen}
          />
        </Canvas>

        {/* The labels. `pointer-events: none` on the layer and `auto` on each
            card, so the space between cards is still the camera's. */}
        <div className="bk-world-labels">{children}</div>
      </div>

      <CameraNote rig={rig} level={focus.level} />
    </div>
  );
}

/**
 * What the camera is doing, in words, and the four poses as buttons.
 *
 * The buttons are not a navigation model any more — the drag is — but they are
 * still the keyboard's and the screen reader's path to the same four readings,
 * and the caption is what tells a reader that a pose they dragged to has a
 * name. Subscribed rather than rendered from state: the pose changes sixty
 * times a second and this is one line of text.
 */
function CameraNote({ rig, level }: { rig: CameraRig; level: number }) {
  const [named, setNamed] = useState<string | null>(() => poseName(rig.get()));
  const zoom = useRef<HTMLSpanElement | null>(null);

  useEffect(
    () =>
      rig.subscribe((pose) => {
        setNamed((was) => {
          const now = poseName(pose);
          return now === was ? was : now;
        });
        if (zoom.current) zoom.current.textContent = `${pose.zoom.toFixed(2)}x`;
      }),
    [rig],
  );

  return (
    <div className="bk-pose">
      <span className="bk-pose-label" id="bk-pose-label">
        Camera
      </span>
      <div className="bk-seg" role="group" aria-labelledby="bk-pose-label">
        {POSES.map((p) => (
          <button
            key={p.id}
            type="button"
            className="bk-seg-option"
            data-pose={p.id}
            aria-pressed={named === p.label && level === 0}
            onClick={() => rig.flyTo({ yaw: p.yaw, pitch: p.pitch, zoom: 1, pan: { x: 0, y: 0 } })}
          >
            {p.label}
          </button>
        ))}
        <button type="button" className="bk-seg-option" onClick={() => rig.reset()}>
          reset
        </button>
      </div>
      <p className="bk-pose-note">
        {level === 0
          ? "Drag to orbit, wheel to zoom at the pointer, arrows and +/- from the keyboard, Home to reset. Let go near one of the four and it settles onto it."
          : "Inside a database. Zoom out to come back to the nine; Escape does the same."}{" "}
        <span className="bk-pose-zoom" ref={zoom} aria-hidden>
          {rig.get().zoom.toFixed(2)}x
        </span>
      </p>
    </div>
  );
}
