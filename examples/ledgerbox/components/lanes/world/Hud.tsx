"use client";

/**
 * The head, as a HUD — the one thing in this direction that does not live in the world.
 *
 * IT IS A STRIP AND NOT A PANEL, which the first capture settled: as a boxed column in the
 * top-left corner it covered a quarter of the map at exactly the band where the map is what the
 * reader came for. A place label on a map is a line, not a card. One row, pinned to the top of
 * the stage, reading left to right: what this is, its name, its three figures, and the way back.
 *
 * ROUND 2'S L1 HEAD WAS A PAGE. It mounted when you opened a lane and unmounted when you left,
 * and it carried the lane's name across the level change on a `layoutId` so the word appeared to
 * travel. That is a good solution to a problem this round does not have: there is no level
 * change any more, only a camera, and a camera that has flown into the Reimbursable band is not
 * "on a different page" — it is in the same world, closer. So the head is furniture: one box,
 * fixed over the stage, whose TEXT changes when the lane under the camera changes and whose BOX
 * never moves. Drag from one lane to the next and the figures swap; nothing mounts.
 *
 * It crossfades in at the near band because that is the band where the lane's identity is the
 * question. At the far and mid bands the lane names are in the world, in the gutter, where they
 * belong — one name per lane, all six at once, which is the reading that level is for.
 *
 * THE READOUT BESIDE IT IS THE MAP'S LEGEND. A surface you drag and wheel has to say so; a map
 * that does not admit it is a map is a picture. It names the band, the date under the camera and
 * the two gestures, and its live half — the date — is written by `Lanes.tsx` straight onto the
 * DOM node in the camera's own subscribe, because a readout that re-rendered React sixty times a
 * second would be the most expensive thing on the screen.
 */
import type { RefObject } from "react";

import { formatMoneyShort } from "@/lib/format";
import type { LnLane, LnMark } from "../model";
import { BAND_LABEL, BAND_OUT, type Band } from "./bands";

export function Hud({
  band,
  lane,
  mark,
  dateRef,
  onOut,
}: {
  band: Band;
  /** The lane under the camera — not necessarily the one the nav has open, while a drag is on. */
  lane: LnLane | undefined;
  mark: LnMark | undefined;
  /** Written per frame by the camera's subscribe. Never React state. */
  dateRef: RefObject<HTMLElement | null>;
  onOut: () => void;
}) {
  const out = BAND_OUT[band];
  return (
    <div className="ln-hud" data-band={band}>
      {/*
       * The lane's claim. `aria-live` is deliberately absent: the reader is driving the camera
       * and already knows where they went, and a region that announced a new lane on every
       * frame of a drag would make the surface unusable with a screen reader on.
       */}
      <div className="ln-hud-head">
        <span className="ln-label">the area under the camera</span>
        <h2 className="ln-hud-name ln-display">{lane?.label ?? ""}</h2>
        <div className="ln-readout ln-hud-figures">
          <div data-tone={lane && lane.lateCents > 0 ? "alert" : undefined}>
            <b>{formatMoneyShort(lane?.lateCents ?? 0)}</b>
            <span>{lane?.lateCount ?? 0} late</span>
          </div>
          <div>
            <b>{formatMoneyShort(lane?.owedCents ?? 0)}</b>
            <span>still open</span>
          </div>
          <div>
            <b>{lane?.count ?? 0}</b>
            <span>invoices</span>
          </div>
        </div>
        <p className="ln-hud-blurb">{mark ? `${mark.number} · ${mark.clientName}` : (lane?.blurb ?? "")}</p>
        {out ? (
          <button type="button" className="ln-hud-out" onClick={onOut}>
            {out}
          </button>
        ) : null}
      </div>

      {/* The map's own legend: where you are, what is under you, how to drive. */}
      <div className="ln-where">
        <span className="ln-where-band">{BAND_LABEL[band]}</span>
        <span className="ln-where-date num" ref={dateRef as RefObject<HTMLSpanElement>} />
        <span className="ln-where-keys">
          drag to pan · wheel to zoom · <kbd>Home</kbd> resets
        </span>
      </div>
    </div>
  );
}
