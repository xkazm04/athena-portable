/**
 * @catalog The module bar: the thin band that says which module the window is on, and whether Athena is about.
 *
 * Implements README section 3.1 and 3.5 (module-first window) in the Countersign's form (ADR
 * 0026): a 36px band with the stamp-face mark, the module labels, and on the right a presence
 * pill that reads what Athena is doing and, pressed, brings her window forward. It is a pure
 * control — a list, a selection, a presence and callbacks — and knows nothing about a store, a
 * command or a rectangle.
 *
 * Its height is `--bar-height`, which `src-tauri/src/layout.rs` also spells as `BAR_HEIGHT`. The
 * two files are edited together.
 */
import type { ReactNode } from "react";

export interface BarItem {
  id: string;
  label: string;
}

/** Who Athena is to the bar: `idle` rests, `work` is on a step, `human` is waiting on the user. */
export type PresenceTone = "idle" | "work" | "human";

export interface Presence {
  tone: PresenceTone;
  text: string;
}

/**
 * The stamp face: a rounded field with an A cut out of it whose crossbar is a tick. The field is
 * `--primary` and the cut is `--recessed`, the colour of the band it sits on, so the A reads as
 * a hole rather than a second ink.
 */
export function StampMark({ className = "module-bar__mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="var(--primary)" />
      <g
        fill="none"
        stroke="var(--recessed)"
        strokeWidth="2.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8.6 24.4 16 7.4l7.4 17" />
        <path d="M11.9 19.2l3.2 3 5.2-6.2" strokeWidth="2.3" />
      </g>
    </svg>
  );
}

/** A 24-grid line icon at the bar's size. `d` is the path data; the stroke is the text colour. */
export function BarIcon({ d }: { d: string }) {
  return (
    <svg className="module-bar__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

export default function ModuleBar({
  items,
  active,
  onSelect,
  presence,
  onSummon,
  trailing,
}: {
  items: readonly BarItem[];
  active: string;
  onSelect: (id: string) => void;
  /** What Athena is doing. Nothing, in the preview harness. */
  presence?: Presence;
  /** Bring her window forward. Only meaningful beside `presence`. */
  onSummon?: () => void;
  /** The theme toggle and the window buttons, in the shell. Nothing, in the preview harness. */
  trailing?: ReactNode;
}) {
  return (
    <nav className="module-bar" aria-label="Module" data-tauri-drag-region>
      <div className="module-bar__brand" data-tauri-drag-region>
        <StampMark />
        <span className="module-bar__word" data-tauri-drag-region>
          Athena
        </span>
      </div>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="module-bar__item focus-ring"
          aria-current={item.id === active ? "page" : undefined}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
      {/* The point of the band: a strip of titlebar no control can take. It carries the drag
          attribute itself — a bare `<div>` in the path swallows the drag rather than passing it
          up, because `data-tauri-drag-region` is self-only. */}
      <div className="module-bar__spacer" data-tauri-drag-region />
      {presence ? (
        <button
          type="button"
          className="module-bar__presence focus-ring"
          data-tone={presence.tone}
          aria-label={`${presence.text}. Bring her window forward.`}
          onClick={onSummon}
        >
          <i className="module-bar__dot" aria-hidden="true" />
          <span>{presence.text}</span>
        </button>
      ) : null}
      {trailing}
    </nav>
  );
}
