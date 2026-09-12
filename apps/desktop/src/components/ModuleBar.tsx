/**
 * @catalog The module bar: the thin band that says which module the window is on.
 *
 * The window is module-first (README section 3.5): a thin bar, the selected module full width,
 * and the browser is one module among them rather than the frame everything else lives inside.
 * This is that bar, and it is a pure control — it takes the list, the selection and a callback,
 * and it knows nothing about a store, a command or a rectangle.
 *
 * Its height is `--bar-height`, which `src-tauri/src/layout.rs` also spells as `BAR_HEIGHT`. The
 * two files are edited together.
 */
import type { ReactNode } from "react";

export interface BarItem {
  id: string;
  label: string;
}

export default function ModuleBar({
  items,
  active,
  onSelect,
  trailing,
}: {
  items: readonly BarItem[];
  active: string;
  onSelect: (id: string) => void;
  /** The window buttons, in the shell. Nothing, in the preview harness. */
  trailing?: ReactNode;
}) {
  return (
    <nav className="module-bar" aria-label="Module" data-tauri-drag-region>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="module-bar__item typo-label focus-ring"
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
      {trailing}
    </nav>
  );
}
