"use client";

/**
 * L1 — one lane, spread across the whole sheet.
 *
 * WHY THIS IS A GRID AND NOT A TIME AXIS ANY MORE. The first cut kept L0's
 * absolute date positioning and packed the cards into rows greedily, so a card
 * went to whichever row its neighbours left free. That IS a rule, but it is an
 * invisible one: the review asked what decided the number of rows, which is the
 * question a layout should never provoke. The rule now is the one everybody
 * already knows how to read — the cards run in the order they fall due, left to
 * right and then down, and the number of rows is however many that takes. It is
 * stated on the surface as well, under the spread.
 *
 * The date has not been lost, only demoted: it is on every card, and the lane's
 * own chronology is the reading order.
 *
 * TWO READINGS, one dataset. `flat` is the honest 2D one. `raised` tilts the
 * field and stands every card up by what it still owes, so the lane reads as a
 * terrace. 2D compares dates, raised compares amounts.
 *
 * THE CONTENT TRAVELS. The card carries a `layoutId` for its box and one for
 * each of the two things the L2 card also shows, so the amount and the client
 * name fly to their new positions instead of cross-fading.
 */
import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { sharedIdentity } from "@athena/demo-kit/zoom";

import { formatMoneyShort } from "@/lib/format";
import {
  PRESENCE_OPACITY,
  chronological,
  matches,
  markPresence,
  statusOf,
  type LnFilter,
  type LnLane,
  type LnSheet,
} from "./model";
import { fade, instant, lift, move, revealDelay, zoom } from "./motion";
import { StatusGlyph } from "./spread/Glyph";
import { SpreadHead } from "./spread/Head";

export type SpreadMode = "flat" | "raised";

export function Spread({
  sheet,
  lane,
  live,
  filter,
  picked,
  mode,
  onOpenItem,
}: {
  sheet: LnSheet;
  lane: LnLane;
  /**
   * True while this level is the one being read.
   *
   * On the frames it is still mounted on its way back out to L0 it renders the
   * same markup without `layoutId`s, so the marks arriving underneath it can
   * claim them — exactly one live claimant per id, in every frame.
   */
  live: boolean;
  filter: LnFilter;
  /** Ticked invoices, ringed at this level too. */
  picked: ReadonlySet<string>;
  mode: SpreadMode;
  onOpenItem: (id: string) => void;
}) {
  const reduced = useReducedMotion();
  const ordered = useMemo(() => chronological(lane), [lane]);
  // The tallest bar in THIS lane, so a lane of small invoices still has relief
  // rather than lying flat because another lane holds the studio's whale.
  const maxBalance = useMemo(
    () => ordered.reduce((m, x) => Math.max(m, x.balanceCents), 0),
    [ordered],
  );
  const shown = ordered.filter((m) => matches(m, filter)).length;

  /**
   * ONE TAB STOP FOR THE WHOLE FIELD, and the arrows inside it.
   *
   * L0 has had this since the first cut and L1 never did: forty cards were forty
   * tab stops between the head and the footer, so nobody reached the footer by
   * keyboard and nobody walked the lane by keyboard either. It is the same
   * pattern the swarm uses, one level down — a roving `tabIndex`, the arrows
   * moving between peers, Home and End to the ends of the lane.
   *
   * UP AND DOWN ARE A COLUMN, not a guess at one. The field is a wrapped
   * `auto-fill` grid, so the column count is whatever the container gave it
   * this frame; it is measured off the cards' own `offsetTop` rather than
   * assumed, which means it stays right at every width and in both modes
   * without a media query anywhere near it.
   */
  const [roving, setRoving] = useState(0);
  const rove = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>(".ln-node")];
    const here = nodes.indexOf(document.activeElement as HTMLElement);
    if (here < 0 || nodes.length === 0) return;
    // The first card on the second row is the width of a row, in cards.
    const top = nodes[0]?.offsetTop;
    const wrapAt = nodes.findIndex((n) => n.offsetTop !== top);
    const columns = wrapAt > 0 ? wrapAt : nodes.length;
    const clamp = (n: number) => Math.max(0, Math.min(nodes.length - 1, n));
    let next = here;
    if (event.key === "ArrowRight") next = clamp(here + 1);
    else if (event.key === "ArrowLeft") next = clamp(here - 1);
    else if (event.key === "ArrowDown") next = clamp(here + columns);
    else if (event.key === "ArrowUp") next = clamp(here - columns);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = nodes.length - 1;
    if (next === here) return;
    event.preventDefault();
    // Focusing is enough: the card's own `onFocus` moves the stop, so there is
    // exactly one place that decides where it is.
    nodes[next]?.focus();
  }, []);

  return (
    <div className="ln-spread" data-live={live}>
      <SpreadHead sheet={sheet} lane={lane} live={live} filter={filter} />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={lane.id}
          className="ln-field"
          data-mode={mode}
          role="group"
          aria-label={`${lane.label}, ${lane.count} invoices in due order. Use the arrow keys to move between them.`}
          onKeyDown={rove}
          /*
           * NINE DEGREES, NOT THIRTEEN, and a much longer perspective.
           *
           * At 13deg against a 1800px perspective the cards at either end of a
           * six-column row sheared hard enough to push the leftmost one off the
           * stage's own clip, and the lifted top row climbed into the rails
           * above it. A terrace should read as a terrace: the tilt is the
           * smallest one that still gives the plinths somewhere to stand.
           */
          animate={{ rotateX: mode === "raised" ? 9 : 0, transformPerspective: 2600 }}
          transition={zoom}
        >
          {ordered.map((mark, index) => {
            const presence = markPresence(mark, filter);
            const status = statusOf(mark);
            // How far this card stands up in `raised` mode: its share of the
            // largest balance in the lane.
            const standing = maxBalance > 0 ? Math.max(0, mark.balanceCents) / maxBalance : 0;
            /*
             * THE STAGGER IS ON THE MORPH, not on a separate entrance.
             *
             * Each card grows out of the mark it was at L0 — one `layoutId`,
             * measured in the frame the level changed — and each waits its turn
             * by `--ln-stagger` before it does. That is what makes a lane read
             * as unpacking rather than as twelve boxes appearing at once, and
             * the cap keeps a forty-invoice lane inside the same 140ms tail a
             * ten-invoice lane takes.
             */
            const delay = reduced ? 0 : revealDelay(index);
            const arrive = reduced ? instant : { ...move(), delay };
            const money = formatMoneyShort(
              mark.balanceCents > 0 ? mark.balanceCents : mark.amountCents,
            );
            /*
             * THE THREE SHARED IDS, through the kit's one helper.
             *
             * A `layoutId` is claimed at MOUNT and released at UNMOUNT — setting
             * the prop to `undefined` on a live element does not deregister it —
             * so ownership has to be a remount. `sharedIdentity` is exactly that
             * pair: the id when this level owns it, and a `key` that flips when
             * it does not. It replaces three live/plain element branches here
             * whose only contract was a comment asking the two spellings not to
             * drift.
             */
            const ids = {
              box: sharedIdentity(mark.id, live),
              money: sharedIdentity(`money-${mark.id}`, live),
              client: sharedIdentity(`client-${mark.id}`, live),
            };
            const body = (
              <>
                {/*
                 * THE STANDING, WHERE THE ID USED TO BE. `#0058` in the corner
                 * the eye reaches first was four digits every invoice in the
                 * books shares a prefix with — an address, printed where a fact
                 * belongs. The glyph says what is the matter with this invoice;
                 * the id has dropped to the quiet mono line below, which is
                 * where you look when you are about to name it to somebody.
                 */}
                <span className="ln-node-top">
                  <StatusGlyph status={status} />
                  <motion.span
                    key={ids.money.key}
                    layoutId={ids.money.layoutId}
                    className="ln-node-money"
                  >
                    {money}
                  </motion.span>
                </span>
                <motion.span
                  key={ids.client.key}
                  layoutId={ids.client.layoutId}
                  className="ln-node-client"
                >
                  {mark.clientName}
                </motion.span>
                <span className="ln-node-no num">{mark.number}</span>
                <span className="ln-node-status">{mark.status}</span>
                {/*
                 * The balance, as a length, against the largest balance in this
                 * lane. Twelve boxes of identical size cannot be compared by
                 * eye, and reading twelve figures one at a time is not
                 * comparing — it is arithmetic. The `3D amounts` reading now
                 * exists in the flat one too, and the tilt adds the physical
                 * version of the same fact rather than being the only way to
                 * get it.
                 */}
                <span className="ln-node-meter" aria-hidden />
              </>
            );
            const shared = {
              type: "button" as const,
              className: "ln-node",
              "data-heat": mark.heat,
              "data-presence": presence,
              "data-picked": picked.has(mark.id),
              /* One stop for the field; the arrows walk the rest. See `rove`. */
              tabIndex: index === roving ? 0 : -1,
              onFocus: () => setRoving((r) => (r === index ? r : index)),
              onClick: () => onOpenItem(mark.id),
              "aria-label": `Open ${mark.number}, ${mark.clientName}. ${mark.status}${
                picked.has(mark.id) ? " Ticked." : ""
              }`,
            };
            /* The card's presence is the mark's, mapped by the one table in
               `model/attention.ts` — motion owns the inline opacity here while
               the card morphs, so this is the one place the number rather than
               the token is read. */
            const opacity = PRESENCE_OPACITY[presence];
            return (
              <motion.button
                key={ids.box.key}
                layoutId={ids.box.layoutId}
                {...shared}
                style={{ "--lift": standing, opacity } as CSSProperties}
                /* Only the LIVE level has an entrance. The layer on its way out
                   is rendering the same cards one last time; starting them at
                   zero would be a second animation nobody asked for, on top of
                   the layer's own fade. */
                initial={live && !reduced ? { opacity: 0 } : false}
                animate={{
                  opacity,
                  y: mode === "raised" ? -standing * 26 : 0,
                }}
                /* A receding card is still a card. Pointing at one or tabbing
                   to it brings it back to full, which is the promise the L0
                   marks make and the same one has to hold here — and it has to
                   be said in motion's own vocabulary, because an inline opacity
                   is not something a `:hover` rule can outrank. */
                whileHover={{ opacity: 1 }}
                whileFocus={{ opacity: 1 }}
                transition={live ? { ...lift, layout: arrive, opacity: arrive } : instant}
              >
                {body}
              </motion.button>
            );
          })}
        </motion.div>
      </AnimatePresence>

      {/* Only when the filter has actually narrowed the lane. The count and the
          ordering rule are in the readout above; repeating them under the grid
          was two statements of one fact, and it left nothing to say in the one
          case that genuinely needs saying. */}
      {shown === ordered.length ? null : (
        <motion.p
          className="ln-count ln-spread-narrowed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={fade()}
        >
          showing {shown} of {ordered.length} — the rest are dimmed, not removed
        </motion.p>
      )}
    </div>
  );
}
