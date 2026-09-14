"use client";

/**
 * The Blocks — the whole sheet, and the only stateful component in the
 * direction.
 *
 * It owns the level, through the kit's shared L0/L1/L2 model, so "open a group"
 * means here exactly what it means everywhere else in this repo. Everything else
 * is a pure child handed props.
 *
 * MOTION IS TOKENISED HERE, at the root, and this is a correction rather than an
 * addition. The direction already carried matched `layoutId`s from the cell to
 * the dossier, but nothing configured them: `motion` 13's default layout
 * transition is a spring, which cannot be expressed as a `--bk-*` token and
 * settles fast enough that the dossier read as a cut — and its `reducedMotion`
 * default is `"never"`, which quietly contradicted the token file's claim to be
 * running "law's durations verbatim". One `MotionConfig` fixes both: the default
 * transition is `--bk-dur-4` on `--bk-ease`, read out of the cascade by
 * `motion-tokens.ts`, and the reduced-motion preference is honoured by the
 * library the same way `app/globals.css` honours it for CSS.
 *
 * THE INK WAITS FOR THE BOX, and this is round 2's correction. A `layout` morph
 * scale-corrects the element it owns and not the type inside it, so the cell
 * travelling out to the dossier drew its own figures at three times their size
 * on the way, and again on the way home — the finding round 1's review carried
 * forward as "the cell's figures scale with the box (ink travelling at 3x)".
 * `ink` below is the one piece of state that fixes it: while the box is in
 * flight the cell's lettering is held back, and it is written again once the box
 * has landed. `hirelane` arrived at the same rule from the other end and calls
 * it `data-ink="after-box"`; this is the same attribute and the same two beats.
 *
 * The level change itself is still a redraw and not a spring — the box edges lay
 * themselves down, everything else is press feedback — and the one morph on the
 * sheet is the table travelling out of its cell, which is the only place where
 * two levels are the same object.
 */
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, MotionConfig, motion as m } from "motion/react";
import { useZoomNav } from "@athena/demo-kit/zoom";

import { Dossier } from "./Dossier";
import { Field } from "./Field";
import { L0 } from "./l0/L0";
import { cellsOf } from "./l0/cells";
import { BlocksTools } from "./tools";
import { useArrival } from "./useArrival";
import { useMotionTokens } from "./motion-tokens";
import { SheetFoot } from "./sheet/Foot";
import { SheetHead } from "./sheet/Head";
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

  const { opening, phase, openFromPlate, openDatabase, flattened } = useArrival(nav);
  const motion = useMotionTokens();

  const level = nav.state.focus.level;
  const database = databaseOf(sheet, nav.state.focus.group);
  const table = tableOf(sheet, nav.state.focus.item);
  const cells = useMemo(() => cellsOf(sheet), [sheet]);

  /*
   * THE INK HOLD.
   *
   * Going out, the hold is set in the render that opens the dossier. Coming
   * home, the cell re-claims the shared id and the hold has to outlast the
   * travel — so it is dropped a morph plus a fade later, both read from the
   * tokens rather than typed. A second open inside that window replaces the hold
   * rather than queueing behind it, which is what the effect's own cleanup does
   * for free.
   */
  const open = level === 2 && table ? table.ident : null;
  const [ink, setInk] = useState<{ seen: string | null; hold: InkHold | null }>({
    seen: null,
    hold: null,
  });
  const holdMs = motion ? (motion.morph.duration + motion.medium.duration) * 1000 : 0;
  // Adjusted DURING RENDER, which is React's own recipe for state that follows a
  // prop, rather than in an effect: the hold has to be on the cell in the SAME
  // commit the dossier mounts, and an effect is one frame late — one frame of
  // lettering drawn at three times its size, which is the whole bug. `seen` is
  // state and not a ref for the same reason the recipe says so: a ref read
  // during render is a value React is allowed not to have re-read.
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
  // Coming home is the only half with a clock on it, and the clock is read out
  // of the tokens: a morph for the travel, a press-feedback for the fade.
  useEffect(() => {
    if (hold?.phase !== "back") return;
    const id = window.setTimeout(() => setInk((s) => ({ ...s, hold: null })), holdMs);
    return () => window.clearTimeout(id);
  }, [holdMs, hold]);

  return (
    <div className="bk-root" data-variant="blocks" data-level={level}>
      {/*
        * `reducedMotion="user"` rather than the library's `"never"` default: a
        * reader who has asked for less motion gets the end state of the morph,
        * the same as they get the end state of every transition in `style/`.
        */}
      <MotionConfig reducedMotion="user" transition={motion?.morph}>
        {/* The ingest layer: this direction's three levels, offered to an agent
            beside the page on `document.modelContext`. It opens a database
            through `openFromPlate`, the same path a click on a cell takes, so
            the picture actually flattens rather than the level being swapped
            under it. Renders nothing, and no tool it registers writes. */}
        <BlocksTools
          sheet={sheet}
          nav={nav}
          onOpenDatabase={openFromPlate}
          showKinds={showKinds}
          setShowKinds={setShowKinds}
        />

        <div className="bk-sheet">
          <SheetHead sheet={sheet} />

          {/*
            * Both can be mounted at once, stacked in one cell. That overlap is
            * the transition: the L0 picture is still there, flattened, while the
            * cells arrive on top of it wearing its geometry.
            */}
          <div className="bk-stage">
            {level === 0 || opening ? (
              <div className="bk-l0-hold" data-out={level >= 1} aria-hidden={level >= 1}>
                {/* `out` is the same fact as `data-out`: the hold is fading, so
                    the picture has nothing left to draw and stops rendering. It
                    stays MOUNTED because the cells are standing on the pose it
                    is holding. */}
                <L0
                  cells={cells}
                  opening={opening}
                  out={level >= 1}
                  onOpen={openFromPlate}
                  onFlattened={flattened}
                />
              </div>
            ) : null}

            {level >= 1 && database ? (
              <Field
                sheet={sheet}
                database={database}
                phase={phase}
                ink={hold}
                onOpenTable={(ident) => nav.openItem(database.id, ident)}
                onOpenDatabase={openDatabase}
              />
            ) : null}
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
          * an `AnimatePresence` of its own. Held by the card it would either have
          * taken the card's opacity with it (hiding the move it exists to frame)
          * or held the card in the tree while it faded, and a card still mounted
          * is a card the cell cannot morph back out of: `layoutId` reverses when
          * the dossier LEAVES and the cell becomes the lead again.
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
            same card holding a different one. The dossier carries two pieces of
            state a reader armed against what was in front of them — the armed
            act and the pair being adjudicated — and an agent may call open_item
            while it is mounted. Unkeyed, the armed merge or delete survives the
            swap and points at a table nobody armed it for, with no undo behind
            it. */}
        <AnimatePresence>
          {level === 2 && table ? (
            <Dossier key={table.ident} table={table} onClose={nav.up} motion={motion} />
          ) : null}
        </AnimatePresence>
      </MotionConfig>
    </div>
  );
}
