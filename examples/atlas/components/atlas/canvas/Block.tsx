"use client";

/**
 * ONE BLOCK ON THE SHEET: a title bar, a count, and its components as parts with ports.
 *
 * A block is the same rectangle in all four views — `plan.ts` sizes it from the model and only its
 * x and y change — so this component never measures anything. It is positioned by a `translate` in
 * world units and the camera scales the whole sheet around it; the ONE owner of this element's
 * transform is the layout (formula §1 rule 11), and the camera owns the world's, one level up.
 *
 * WHAT CHANGES WITH THE BAND, and it is a class flip and a tokenized crossfade, never a remount:
 *
 *   band 0   the title bar and the count. The parts are here, laid out, at zero opacity.
 *   band 1   the parts of the OPEN layer's blocks fade in with their own ports.
 *   band 2   the open part takes the rule weight; its pane is elsewhere.
 *
 * The parts are always in the DOM because the geometry must not move when the band changes — a
 * reader crossing a band watches detail arrive on a drawing that holds still, which is the whole
 * difference between semantic zoom and a page swap.
 *
 * PRESENCE COMES FROM THE MODEL (rule 7), through `presenceStyle` with `{ scale: false }` — the
 * block's transform is its POSITION, which is data, and a scale from the navigation channel would
 * compose into it and move the block. That option exists because ledgerbox hit the same thing in
 * round 2, and it is the reason this file has no opinion about what receding looks like beyond
 * "less ink".
 */
import { memo } from "react";
import { emphasis, presenceStyle, type Focus } from "@athena/demo-kit/zoom";

import { litIn, type Lens } from "@/data";

import { DIM } from "./geometry";
import type { BlockBox } from "./plan";

export interface BlockProps {
  block: BlockBox;
  focus: Focus;
  lens: Lens;
  /** True when this block's layer is the one the reader has open. */
  open: boolean;
  /** The turn's stop numbers on this block, in order. Empty outside the turn view. */
  stops: readonly number[];
  /** True when the turn's current stop is in this block. */
  live: boolean;
  onOpenLayer: (layer: string) => void;
  onOpenPart: (id: string) => void;
  onHover: (id: string | null) => void;
}

/** The four port stubs. Drawn always: a block with no visible ports is a box, not a component. */
const PORTS = [
  { side: "top", x: DIM.blockW / 2, y: 0, dx: 0, dy: -DIM.stub },
  { side: "bottom", x: DIM.blockW / 2, y: 0, dx: 0, dy: DIM.stub },
  { side: "left", x: 0, y: 0, dx: -DIM.stub, dy: 0 },
  { side: "right", x: 0, y: 0, dx: DIM.stub, dy: 0 },
] as const;

function BlockView({
  block,
  focus,
  lens,
  open,
  stops,
  live,
  onOpenLayer,
  onOpenPart,
  onHover,
}: BlockProps) {
  const lit = lens.systems.has(block.id);
  const n = litIn(lens, block.id);
  /* The kit's presence answers for a group and for an item; a block is the tier in between, so it
     takes its LAYER's presence and is floored, which keeps a receding layer's blocks drawn rather
     than gone (KIT-GAPS, the middle tier — round 2 #9, round 3 #7, round 4 again). */
  const present = presenceStyle(emphasis(focus, block.layer, null), { scale: false, floor: 0.22 });

  return (
    <div
      className="at-block"
      data-block={block.id}
      data-layer={block.layer}
      data-status={block.status}
      data-open={open ? "" : undefined}
      data-lit={lit ? "" : undefined}
      data-live={live ? "" : undefined}
      style={{
        transform: `translate(${block.x}px, ${block.y}px)`,
        width: `${block.w}px`,
        height: `${block.h}px`,
        opacity: present.opacity,
      }}
      onPointerEnter={() => onHover(block.id)}
      onPointerLeave={() => onHover(null)}
    >
      {PORTS.map((p) => (
        <span
          key={p.side}
          className="at-port"
          data-side={p.side}
          aria-hidden
          style={
            p.side === "top" || p.side === "bottom"
              ? { left: `${p.x}px`, height: `${DIM.stub}px` }
              : { top: "50%", width: `${DIM.stub}px` }
          }
        />
      ))}

      <button
        type="button"
        className="at-block-head"
        data-roving=""
        data-block-head={block.id}
        style={{ height: `${DIM.headH}px` }}
        aria-label={`${block.part} ${block.name}, ${block.parts.length} modules in ${block.layer}`}
        onClick={() => onOpenLayer(block.layer)}
      >
        <span className="at-scaled">
          <span className="at-part">{block.part}</span>
          <span className="at-block-name">{block.name}</span>
          <span className="at-fig at-block-n" data-lit={lit ? "" : undefined}>
            {lit ? `${n}/${block.parts.length}` : block.parts.length}
          </span>
        </span>
      </button>

      {stops.length > 0 ? (
        <span className="at-stops" aria-hidden>
          <span className="at-scaled">
            {stops.map((s) => (
              <b key={s} className="at-stop-n" data-live={live ? "" : undefined}>
                {s}
              </b>
            ))}
          </span>
        </span>
      ) : null}

      <ul className="at-parts">
        {block.parts.map((p) => {
          const on = lens.components.has(p.id);
          const here = focus.item === p.id;
          return (
            <li
              key={p.id}
              className="at-part-box"
              style={{
                left: `${p.x}px`,
                top: `${p.y}px`,
                width: `${p.w}px`,
                height: `${p.h}px`,
              }}
            >
              <button
                type="button"
                className="at-part-btn"
                data-component={p.id}
                data-status={p.status}
                data-lit={on ? "" : undefined}
                data-here={here ? "" : undefined}
                tabIndex={open ? 0 : -1}
                aria-label={`${p.part} ${p.name}`}
                onClick={() => onOpenPart(p.id)}
                onPointerEnter={() => onHover(p.id)}
                onPointerLeave={() => onHover(null)}
              >
                <span className="at-scaled">
                  <span className="at-part-name">{p.name}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Memoised on purpose. Nineteen blocks and sixty-eight parts re-render on every hover otherwise,
 * and a hover is a thing a reader does sixty times a minute. The props are all primitives or
 * stable references, so the default comparison is the right one.
 */
export const Block = memo(BlockView);
