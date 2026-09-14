"use client";

/**
 * The direction switch: three drawings of the same pipeline, one at a time.
 *
 * A `radiogroup` rather than three buttons, because that is what it is — one
 * choice with three answers — and because the role brings the keyboard
 * behaviour a segmented control is expected to have for free in every screen
 * reader: the group is one tab stop, and the arrow keys move the choice inside
 * it. A roving `tabIndex` is the other half; only the selected option is
 * tabbable, so Tab crosses the control once rather than three times.
 *
 * It is TEMPORARY FURNITURE and says so in its own label. Two of the three
 * directions will be deleted after the review, and the switch goes with them.
 */

import { useRef } from "react";

import {
  DIRECTIONS,
  DIRECTION_CONCEPT,
  DIRECTION_LABEL,
  DIRECTION_NOTE,
  type Direction,
} from "./contract";

export function DirectionSwitcher({
  direction,
  onChoose,
}: {
  direction: Direction;
  onChoose: (next: Direction) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const at = DIRECTIONS.indexOf(direction);
    let next: Direction | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = DIRECTIONS[(at + 1) % DIRECTIONS.length];
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = DIRECTIONS[(at - 1 + DIRECTIONS.length) % DIRECTIONS.length];
    } else if (event.key === "Home") {
      next = DIRECTIONS[0];
    } else if (event.key === "End") {
      next = DIRECTIONS[DIRECTIONS.length - 1];
    }
    if (!next) return;
    event.preventDefault();
    const chosen = next;
    onChoose(chosen);
    ref.current?.querySelector<HTMLElement>(`[data-direction-id="${chosen}"]`)?.focus();
  };

  return (
    <div className="bd-dir-switch">
      <span className="bd-dir-switch-label" id="bd-dir-switch-label">
        Direction
      </span>
      <div
        className="bd-seg"
        role="radiogroup"
        aria-labelledby="bd-dir-switch-label"
        ref={ref}
        onKeyDown={onKeyDown}
      >
        {DIRECTIONS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={id === direction}
            data-direction-id={id}
            className="bd-seg-option"
            tabIndex={id === direction ? 0 : -1}
            title={DIRECTION_NOTE[id]}
            onClick={() => onChoose(id)}
          >
            {DIRECTION_LABEL[id]}
          </button>
        ))}
      </div>
      <p className="bd-dir-switch-note">
        {DIRECTION_NOTE[direction]} <i>Tests {DIRECTION_CONCEPT[direction]}.</i>
      </p>
    </div>
  );
}
