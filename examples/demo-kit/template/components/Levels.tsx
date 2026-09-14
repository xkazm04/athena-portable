"use client";

/**
 * The level container — a new app's starting point on the layered-UI formula.
 *
 * Three depths over the same rows: L0 every owner, L1 one owner's records, L2 one record. It is
 * a SKELETON: no design, no domain, about a hundred lines. What it is here to do is make the
 * nine rules in `docs/layered-ui-formula.md` §1 the default shape of a new app rather than
 * something each app rediscovers — round 1 had three apps build the same five primitives, badly
 * and differently, before the kit grew them.
 *
 * Which rule each piece is, so the skeleton can be read as the formula:
 *
 *   1. The level you LEAVE carries the camera. `dk-echo` is the outgoing level rendered once as
 *      an inert, id-free copy with the whole zoom on it; the live layer mounts at its final size
 *      so a shared-element morph is never measured inside an animating ancestor.
 *   2. One claimant per shared id — `sharedIdentity` in the list, `useSharedIdentity` in the
 *      overlay. The card gives the id up in the same commit the overlay takes it.
 *   4. One clock. `useTokens` reads `--dk-dur-*` / `--dk-ease` out of the cascade; there is not a
 *      millisecond typed in this file.
 *   5. The overlay owns its Escape and hands focus back — `useOverlayEscape`.
 *   6. A move in flight is abortable: `useLevelFlight` tells the nav it is moving, so the nav's
 *      Escape aborts to where the reader was instead of stepping up out of a level they never
 *      arrived at. Nothing is ever disabled while a transition plays.
 *   7. Presence comes from the model — `presenceOf`, never a second derivation.
 *   8. Reduced motion lands on the final state at frame zero (`instant`), not a faster animation.
 *
 * Delete the record-shaped parts, keep the shape.
 */
import { useEffect, useMemo, useRef } from "react";
import {
  AnimatePresence,
  LayoutGroup,
  MotionConfig,
  motion,
  useReducedMotion,
  type Transition,
} from "motion/react";
import {
  parseBezier,
  presenceOf,
  secs,
  sharedIdentity,
  useLevelFlight,
  useOverlayEscape,
  useSharedIdentity,
  useTokens,
  useZoomNav,
  type Focus,
} from "@athena/demo-kit/zoom";

import type { Record_ } from "@/lib/types";

/** The only motion vocabulary this surface has. Declared in `app/globals.css`. */
const TOKENS = ["--dk-dur-move", "--dk-dur-fade", "--dk-ease"] as const;

/** Reduced motion: the final state at frame zero, never a faster animation (rule 8). */
const INSTANT: Transition = { duration: 0 };

const idOf = (record: Record_) => `record-${record.id}`;

export function Levels({ rows }: { rows: Record_[] }) {
  const nav = useZoomNav();
  const reduced = useReducedMotion();
  /* The tokens are on `<html data-variant>`, so the document element answers them. A design that
     scopes its tokens to its own wrapper passes that element as the second argument. */
  const t = useTokens(TOKENS);
  /* `fallbackToken` is the safety net for a move whose animation never runs; `settle` below is
     what normally ends a flight, so the level change ends when the motion does. */
  const flight = useLevelFlight(nav, { fallbackToken: "--dk-dur-move" });

  const ease = parseBezier(t["--dk-ease"].ease) ?? "easeOut";
  const move: Transition = reduced
    ? INSTANT
    : { duration: secs(t["--dk-dur-move"].ms), ease };
  const fade: Transition = reduced ? INSTANT : { duration: secs(t["--dk-dur-fade"].ms), ease };

  const groups = useMemo(() => {
    const byOwner = new Map<string, Record_[]>();
    for (const row of rows) byOwner.set(row.owner, [...(byOwner.get(row.owner) ?? []), row]);
    return [...byOwner].map(([owner, records]) => ({ id: owner, records }));
  }, [rows]);

  const focus: Focus = nav.state.focus;
  const group = groups.find((g) => g.id === focus.group);
  const open = group?.records.find((r) => r.id === focus.item);

  return (
    <MotionConfig reducedMotion="user">
      <section className="dk-levels" data-level={focus.level}>
        <LayoutGroup>
          {/* The completion signal: a zero-size element keyed on the flight, running the move
              this level change is actually running, so the flight ends with the motion rather
              than at a number somebody typed. */}
          <motion.span
            key={flight.flight}
            className="dk-flight"
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={move}
            onAnimationComplete={() => flight.settle()}
          />

          {focus.level === 0 ? (
            <ul className="dk-level">
              {groups.map((g) => (
                <motion.li key={g.id} animate={presenceOf(focus, g.id)} transition={move}>
                  <button type="button" className="dk-level-row" onClick={() => nav.openGroup(g.id)}>
                    {g.id} <span className="dk-level-count">{g.records.length}</span>
                  </button>
                </motion.li>
              ))}
            </ul>
          ) : null}

          {focus.level > 0 && group ? (
            <ul className="dk-level">
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

          {/* Rule 1: the level being left, inert and id-free, carrying the whole camera move. */}
          <AnimatePresence>
            {flight.moving && flight.from.level === 0 && focus.level > 0 ? (
              <motion.ul
                key={flight.flight}
                className="dk-level dk-echo"
                aria-hidden
                inert
                initial={{ opacity: 1, scale: 1 }}
                animate={{ opacity: 0, scale: 1.08 }}
                transition={move}
              >
                {groups.map((g) => (
                  <li key={g.id} className="dk-level-row">
                    {g.id}
                  </li>
                ))}
              </motion.ul>
            ) : null}
          </AnimatePresence>

          {open && group ? (
            <Overlay record={open} onClose={nav.up} transition={fade} layout={move} />
          ) : null}
        </LayoutGroup>
      </section>
    </MotionConfig>
  );
}

/**
 * L2. It owns Escape and gives focus back to the card it grew out of (rule 5), and it holds the
 * record's shared id for as long as it is open (rule 2).
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
