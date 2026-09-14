"use client";

/**
 * The prototype switch: three drawings of the same nine databases, one at a time.
 *
 * A `radiogroup` rather than three buttons, because that is what it is — one
 * choice with three answers — and because the role brings the keyboard behaviour
 * a segmented control is expected to have for free in every screen reader:
 * the group is one tab stop, and the arrow keys move the choice inside it.
 * `roving tabindex` is the other half; only the selected option is tabbable.
 *
 * It is TEMPORARY FURNITURE and says so in its own label. Two of the three
 * prototypes will be deleted after the review, and the switch goes with them.
 */

import { useRef } from "react";

import { L0_VARIANT_LABEL, L0_VARIANT_NOTE, L0_VARIANTS, type L0Variant } from "./contract";

export function L0Switcher({
  variant,
  onChoose,
}: {
  variant: L0Variant;
  onChoose: (next: L0Variant) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : event.key === "Home"
            ? -L0_VARIANTS.length
            : event.key === "End"
              ? L0_VARIANTS.length
              : 0;
    if (step === 0) return;
    event.preventDefault();
    const at = L0_VARIANTS.indexOf(variant);
    const next = Math.min(
      L0_VARIANTS.length - 1,
      Math.max(0, step === 0 ? at : at + step),
    );
    const wrapped =
      Math.abs(step) === 1
        ? (at + step + L0_VARIANTS.length) % L0_VARIANTS.length
        : next;
    const chosen = L0_VARIANTS[wrapped];
    if (!chosen) return;
    onChoose(chosen);
    ref.current?.querySelector<HTMLElement>(`[data-variant-id="${chosen}"]`)?.focus();
  };

  return (
    <div className="bk-l0-switch">
      <span className="bk-l0-switch-label" id="bk-l0-switch-label">
        L0 prototype
      </span>
      <div
        className="bk-seg"
        role="radiogroup"
        aria-labelledby="bk-l0-switch-label"
        ref={ref}
        onKeyDown={onKeyDown}
      >
        {L0_VARIANTS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={id === variant}
            data-variant-id={id}
            className="bk-seg-option"
            tabIndex={id === variant ? 0 : -1}
            title={L0_VARIANT_NOTE[id]}
            onClick={() => onChoose(id)}
          >
            {L0_VARIANT_LABEL[id]}
          </button>
        ))}
      </div>
      <p className="bk-l0-switch-note">{L0_VARIANT_NOTE[variant]}</p>
    </div>
  );
}
