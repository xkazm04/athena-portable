"use client";

/**
 * The level container — a new app's starting point on the layered-UI formula.
 *
 * Three depths over the same rows: L0 every owner, L1 one owner's records, L2 one record. It is
 * a SKELETON: no design, no domain. What it is here to do is make the nine rules in
 * `docs/layered-ui-formula.md` §1 the default shape of a new app rather than something each app
 * rediscovers — round 1 had three apps build the same five primitives, badly and differently,
 * and round 2 had four apps build rule 1, the headline rule, by hand.
 *
 * Which rule each piece is, so the skeleton can be read as the formula:
 *
 *   1. The level you LEAVE carries the camera. `<Echo>` is the outgoing level rendered once as
 *      an inert, id-free copy, with the move hung off `--echo-ox` / `--echo-oy` and
 *      `[data-direction]` in `app/globals.css`. The live layer mounts at its final size, so a
 *      shared-element morph is never measured inside an animating ancestor.
 *   2. One claimant per shared id — `sharedIdentity` in the list, `useSharedIdentity` in the
 *      overlay. The card gives the id up in the same commit the overlay takes it.
 *   4. One clock. `useTokens` reads `--dk-dur-*` / `--dk-ease` out of the cascade, and the rig
 *      reads `--dk-dur-move` for its flights; there is not a millisecond typed in this file.
 *   5. The overlay owns its Escape and hands focus back — `useOverlayEscape`, preferring the
 *      card it grew out of (`prefer: "origin"`).
 *   6. A move in flight is abortable: `useLevelFlight` tells the nav it is moving, so the nav's
 *      Escape aborts to where the reader was instead of stepping up out of a level they never
 *      arrived at. Nothing is ever disabled while a transition plays.
 *   7. Presence comes from the model — `presenceOf`, never a second derivation.
 *   8. Reduced motion lands on the final state at frame zero (`instant`), not a faster animation.
 *      The rig takes the same branch on its own.
 *
 * AND THE CAMERA (round 3, `docs/kit-camera-contract.md`). `useCameraRig` owns the pose and
 * never re-renders this component; one `subscribe` writes `poseToTransform` onto the stage.
 * `useSemanticZoom` makes the distance mean something: wheel in past a band and the nav opens
 * the group, exactly as a click would, so tools, Escape and the flight go on seeing one truth.
 * A WebGL surface swaps the two lines that touch the DOM for a `useFrame` and keeps everything
 * else — see the kit README, "Camera and semantic zoom".
 *
 * Delete the record-shaped parts, keep the shape.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  AnimatePresence,
  LayoutGroup,
  MotionConfig,
  motion,
  useReducedMotion,
  type Transition,
} from "motion/react";
import {
  Echo,
  parseBezier,
  poseToTransform,
  presenceOf,
  secs,
  sharedIdentity,
  useCameraRig,
  useEcho,
  useLevelFlight,
  useOverlayEscape,
  useSemanticZoom,
  useSharedIdentity,
  useTokens,
  useZoomNav,
  type CameraPose,
  type Focus,
} from "@athena/demo-kit/zoom";

import type { Record_ } from "@/lib/types";

/** The only motion vocabulary this surface has. Declared in `app/globals.css`. */
const TOKENS = ["--dk-dur-move", "--dk-dur-fade", "--dk-ease"] as const;

/** Reduced motion: the final state at frame zero, never a faster animation (rule 8). */
const INSTANT: Transition = { duration: 0 };

/** Scene units between two group centres — the row height the stylesheet draws. */
const STEP = 72;
/** Where the camera stands at each depth. The bands below are read off these. */
const ZOOM = [1, 3, 7] as const;
/** The two thresholds `useSemanticZoom` watches, set between the three resting zooms. */
const BANDS = [2, 5] as const;

const idOf = (record: Record_) => `record-${record.id}`;
const clamp = (n: number, hi: number) => (n < 0 ? 0 : n > hi ? hi : n);

export function Levels({ rows }: { rows: Record_[] }) {
  const nav = useZoomNav();
  const reduced = useReducedMotion();
  const sceneRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  /* The tokens are on `<html data-variant>`, so the document element answers them. A design that
     scopes its tokens to its own wrapper passes that element as the second argument. */
  const t = useTokens(TOKENS);
  /* `fallbackToken` is the safety net for a move whose animation never runs; the echo below is
     what normally ends a flight, so the level change ends when the move does. `el` is a
     FUNCTION because the scope does not exist on the first render. */
  const flight = useLevelFlight(nav, {
    fallbackToken: "--dk-dur-move",
    el: () => sceneRef.current,
  });

  const ease = parseBezier(t["--dk-ease"].ease) ?? "easeOut";
  const move: Transition = reduced ? INSTANT : { duration: secs(t["--dk-dur-move"].ms), ease };
  const fade: Transition = reduced ? INSTANT : { duration: secs(t["--dk-dur-fade"].ms), ease };

  const groups = useMemo(() => {
    const byOwner = new Map<string, Record_[]>();
    for (const row of rows) byOwner.set(row.owner, [...(byOwner.get(row.owner) ?? []), row]);
    return [...byOwner].map(([owner, records]) => ({ id: owner, records }));
  }, [rows]);

  const focus: Focus = nav.state.focus;
  const group = groups.find((g) => g.id === focus.group);
  const open = group?.records.find((r) => r.id === focus.item);

  /* ------------------------------------------------------------------------------ the camera */

  const rig = useCameraRig({
    bounds: { zoom: [0.6, 12], pan: { x: [-400, 400], y: [-2000, 2000] } },
    drag: "pan",
    wheel: "zoom",
    flyToken: "--dk-dur-move",
    easeToken: "--dk-ease",
  });

  /* The one wire to the DOM. `subscribe` fires on every frame of a move and renders nothing:
     a camera behind `useState` is sixty renders a second of a tree that has not changed. */
  useEffect(
    () =>
      rig.subscribe((pose) => {
        const stage = stageRef.current;
        if (stage) stage.style.transform = poseToTransform(pose);
      }),
    [rig],
  );

  /* Where each depth stands, and how to read a depth back off a pose. The two are inverses, and
     that is the whole of the surface's contribution to semantic zoom. */
  const indexOf = useCallback(
    (id: string | null) => clamp(groups.findIndex((g) => g.id === id), groups.length - 1),
    [groups],
  );
  useSemanticZoom(nav, rig, {
    bands: BANDS,
    flight,
    poseFor: (to) => ({ zoom: ZOOM[to.level], pan: { x: 0, y: -STEP * indexOf(to.group) } }),
    resolveGroup: (pose: CameraPose) =>
      groups[clamp(Math.round(-pose.pan.y / STEP), groups.length - 1)]?.id ?? null,
    /* A record has no place in this scene of its own, so the camera stops at the group and the
       last step is a click. A surface that lays its items out returns one here and gets L2 on
       the wheel for nothing. */
    resolveItem: () => null,
  });

  /* Rule 1, as a primitive: what the reader is leaving, measured before it leaves. */
  const { echo, liveProps } = useEcho(nav, flight, {
    container: () => sceneRef.current,
    measure: (of) =>
      of.level === 0
        ? (sceneRef.current?.getBoundingClientRect() ?? null)
        : (document
            .querySelector(`[data-group="${CSS.escape(of.group ?? "")}"]`)
            ?.getBoundingClientRect() ?? null),
  });

  const setScene = useCallback(
    (el: HTMLElement | null) => {
      sceneRef.current = el;
      rig.bind.ref(el);
    },
    [rig],
  );

  return (
    <MotionConfig reducedMotion="user">
      <section
        className="dk-levels"
        data-level={focus.level}
        aria-label="Levels"
        {...rig.bind}
        ref={setScene}
      >
        <div className="dk-stage" ref={stageRef}>
          <LayoutGroup>
            {focus.level === 0 ? (
              <ul className="dk-level" {...liveProps}>
                {groups.map((g) => (
                  <motion.li
                    key={g.id}
                    data-group={g.id}
                    animate={presenceOf(focus, g.id)}
                    transition={move}
                  >
                    <button
                      type="button"
                      className="dk-level-row"
                      onClick={() => nav.openGroup(g.id)}
                    >
                      {g.id} <span className="dk-level-count">{g.records.length}</span>
                    </button>
                  </motion.li>
                ))}
              </ul>
            ) : null}

            {focus.level > 0 && group ? (
              <ul className="dk-level" data-group={group.id} {...liveProps}>
                {group.records.map((record) => {
                  /* The card holds the record's identity unless the overlay has it. The pure
                     function inside a list, the hook for the single element below: one claimant
                     per id, and the key flips with ownership so motion re-reads it at mount. */
                  const box = sharedIdentity(idOf(record), focus.item !== record.id);
                  return (
                    <motion.li
                      key={box.key}
                      layoutId={box.layoutId}
                      data-record={record.id}
                      animate={presenceOf(focus, group.id, record.id)}
                      transition={move}
                    >
                      <button
                        type="button"
                        className="dk-level-row"
                        onClick={() => nav.openItem(group.id, record.id)}
                      >
                        {record.title}
                      </button>
                    </motion.li>
                  );
                })}
              </ul>
            ) : null}

            {open && group ? (
              <Overlay record={open} onClose={nav.up} transition={fade} layout={move} />
            ) : null}
          </LayoutGroup>
        </div>

        {/* Rule 1: the level being left, inert, id-free, carrying the whole move. Rendered
            OUTSIDE the stage — the echo has a camera of its own and must not ride this one. */}
        <AnimatePresence>
          {echo ? (
            <Echo key={echo.key} echo={echo} className="dk-echo">
              <ul className="dk-level">
                {(echo.from.level === 0
                  ? groups.map((g) => g.id)
                  : (groups.find((g) => g.id === echo.from.group)?.records ?? []).map(
                      (r) => r.title,
                    )
                ).map((label) => (
                  <li key={label} className="dk-level-row">
                    {label}
                  </li>
                ))}
              </ul>
            </Echo>
          ) : null}
        </AnimatePresence>
      </section>
    </MotionConfig>
  );
}

/**
 * L2. It owns Escape and gives focus back to the card it grew out of (rule 5, `prefer: "origin"`
 * — the opener may have been a breadcrumb, and the morph the reader watched came from the card),
 * and it holds the record's shared id for as long as it is open (rule 2).
 *
 * Not inside `AnimatePresence`: on close it has to release the id in the same commit the card
 * takes it back, or there are two claimants and the box does not morph home.
 */
function Overlay({
  record,
  onClose,
  transition,
  layout,
}: {
  record: Record_;
  onClose: () => void;
  transition: Transition;
  layout: Transition;
}) {
  const box = useSharedIdentity(idOf(record), true);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const overlay = useOverlayEscape({
    onClose,
    prefer: "origin",
    returnFocusTo: () => document.querySelector<HTMLElement>(`[data-record="${record.id}"] button`),
  });

  /* The hook returns focus; taking it is the pane's own decision, because where it should land
     differs per design. The dialog itself is the standard target: a screen reader reads the pane,
     Tab then lands on its first control, and no focus ring flashes on a destructive one. */
  useEffect(() => {
    paneRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <motion.div
      ref={paneRef}
      key={box.key}
      layoutId={box.layoutId}
      className="dk-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={record.title}
      tabIndex={-1}
      transition={layout}
      {...overlay}
    >
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={transition}>
        <h2>{record.title}</h2>
        <p>{record.note}</p>
        <button type="button" className="dk-level-row" onClick={onClose}>
          Close (Esc)
        </button>
      </motion.div>
    </motion.div>
  );
}
