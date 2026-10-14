/**
 * A playbook's storyboard — README section 3.5, ADR 0055 and 0096.
 *
 * The real screens of the bench run, beside the blueprint's plan of it: the still in hand large,
 * with its caption, and a strip of every still under it to pick another (Left and Right step along
 * the strip, Home and End jump). The stills are small WebPs the evidence pipeline commits beside the
 * playbook; a run filmed before they were captured has only its thumbnail, which is shown as what
 * it is (what she filed) with a quiet line saying the step screens are not captured yet. A playbook
 * with neither draws nothing here: an empty frame would claim a screen that does not exist.
 *
 * Images are URLs the browser fetches lazily, never imported. Which still is in hand is the strip's
 * own state, and starts again at the first for another playbook (the pane is keyed by it).
 */
import { useRef, useState, type KeyboardEvent } from "react";

import type { PlaybookView } from "@/modules/playbooks/model";

import { stillStep } from "./model";

export default function Storyboard({ view }: { view: PlaybookView }) {
  const story = (view.playbook.evidence?.story ?? []).filter((s) => s.url);
  const [at, setAt] = useState(0);
  const strip = useRef<(HTMLButtonElement | null)[]>([]);
  const thumb = view.evidence?.thumbnailUrl ?? "";

  if (story.length === 0) {
    if (!thumb) return null;
    return (
      <section className="ch-story" aria-label="Screens">
        <figure className="ch-story__frame">
          <img className="ch-story__still" src={thumb} alt="What she filed, on the bench" loading="lazy" decoding="async" />
          <figcaption className="ch-note">What she filed</figcaption>
        </figure>
        <p className="ch-note ch-story__none">No step screens captured for this run yet.</p>
      </section>
    );
  }

  const here = Math.min(at, story.length - 1);
  const still = story[here]!;
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const to = stillStep(here, e.key, story.length);
    if (to === null) return;
    e.preventDefault();
    setAt(to);
    strip.current[to]?.focus();
  };

  return (
    <section className="ch-story" aria-label="Screens">
      <figure className="ch-story__frame">
        <img className="ch-story__still" src={still.url} alt={still.caption} loading="lazy" decoding="async" />
        <figcaption className="ch-note">{`${here + 1} of ${story.length} · ${still.caption}`}</figcaption>
      </figure>
      <div className="ch-story__strip" role="group" aria-label="Screens of the run">
        {story.map((s, i) => (
          <button
            key={s.url}
            ref={(el) => {
              strip.current[i] = el;
            }}
            type="button"
            className="ch-story__pick focus-ring"
            aria-pressed={i === here}
            aria-label={s.caption}
            tabIndex={i === here ? 0 : -1}
            onClick={() => setAt(i)}
            onKeyDown={onKeyDown}
          >
            <img src={s.url} alt="" loading="lazy" decoding="async" />
          </button>
        ))}
      </div>
    </section>
  );
}
