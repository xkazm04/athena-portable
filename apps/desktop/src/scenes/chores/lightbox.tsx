/**
 * The expandable screenshot — README section 3.5, ADR 0096.
 *
 * A still opened over everything: dimmed backdrop, the image as large as fits, its caption and
 * "n / N", Left/Right step, Escape or a click on the backdrop closes, focus returns to the opener,
 * and Tab wraps around its own controls.
 * The caller owns which still is open (`at`, or null when closed).
 */
import { useEffect, useRef } from "react";

import type { StoryStill } from "@/lib/playbooks";


export default function Lightbox({
  stills,
  at,
  onAt,
  onClose,
}: {
  stills: readonly StoryStill[];
  at: number | null;
  onAt: (i: number) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const open = at !== null;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    box.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [open]);

  if (at === null || stills.length === 0) return null;
  const here = Math.max(0, Math.min(at, stills.length - 1));
  const still = stills[here]!;
  const step = (d: number) => onAt((here + d + stills.length) % stills.length);

  return (
    <div
      className="lbx"
      role="dialog"
      aria-modal="true"
      aria-label={still.caption}
      tabIndex={-1}
      ref={box}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Tab") {
          // A modal keeps the keyboard: Tab wraps around its own controls instead of leaving for
          // the page and the stage chrome under the scrim.
          const stops = [...e.currentTarget.querySelectorAll<HTMLElement>("button")];
          const first = stops[0];
          const last = stops[stops.length - 1];
          if (!first || !last) return;
          const here = document.activeElement;
          if (e.shiftKey && (here === first || here === e.currentTarget)) last.focus();
          else if (!e.shiftKey && here === last) first.focus();
          else return;
          e.preventDefault();
          return;
        }
        if (e.key === "Escape") onClose();
        else if (e.key === "ArrowRight") step(1);
        else if (e.key === "ArrowLeft") step(-1);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <figure className="lbx__figure">
        <img className="lbx__img" src={still.url} alt={still.caption} decoding="async" />
        <figcaption className="lbx__caption">
          <span className="lbx__count">{`${here + 1} / ${stills.length}`}</span>
          <span>{still.caption}</span>
        </figcaption>
      </figure>
      {stills.length > 1 ? (
        <>
          <button type="button" className="lbx__nav lbx__nav--prev" aria-label="Previous screen" onClick={() => step(-1)}>
            ‹
          </button>
          <button type="button" className="lbx__nav lbx__nav--next" aria-label="Next screen" onClick={() => step(1)}>
            ›
          </button>
        </>
      ) : null}
      <button type="button" className="lbx__close" aria-label="Close" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
