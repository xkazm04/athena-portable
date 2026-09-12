/**
 * @catalog The app's one value picker on a rail: a radio group that looks like a segmented control.
 *
 * A rail that sets a *setting* is a `radiogroup`, not a row of buttons and not a tablist — the
 * distinction is real and it is the reason this is a component rather than three `<button>`s in
 * three modules. A group of `aria-pressed` buttons puts every option in the Tab order and
 * answers no arrow key; a radio group has one tab stop and moves with ←/→/↑/↓/Home/End, which is
 * what WAI-ARIA asks of a thing that picks one value out of a few.
 *
 * **The chosen option keeps its word at `--foreground`.** The hue rides the border and a light
 * fill, exactly as `StatusDot` carries it beside a word rather than on it: a status colour on
 * 12px type is the pair that keeps measuring under AA (house style §4).
 */
import { useCallback, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export interface PillOption<T extends string> {
  value: T;
  label: ReactNode;
  /** What choosing this means, as a `title`. Longer than a line belongs beside the group. */
  hint?: string;
  /** A reason this option cannot be chosen. It is shown, never merely implied. */
  disabledReason?: string;
}

export default function PillGroup<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  options: readonly PillOption<T>[];
  value: T;
  onChange: (next: T) => void;
  /** What the group is choosing — "Engine", "Theme". Required: it is the group's name. */
  ariaLabel: string;
  disabled?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
      let to: number | null = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") to = (i + 1) % options.length;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") to = (i - 1 + options.length) % options.length;
      if (e.key === "Home") to = 0;
      if (e.key === "End") to = options.length - 1;
      if (to === null) return;
      e.preventDefault();
      refs.current[to]?.focus();
      const next = options[to];
      if (next && !next.disabledReason) onChange(next.value);
    },
    [options, onChange],
  );

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className="pill-group"
    >
      {options.map((option, i) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={disabled || Boolean(option.disabledReason)}
            title={option.disabledReason ?? option.hint}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className="pill typo-label focus-ring"
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
