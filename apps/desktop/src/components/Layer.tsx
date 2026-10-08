/**
 * @catalog The second layer of a module: a sheet from the right, where an item opens (ADR 0029).
 *
 * An overview reads; a layer is where one item opens on its detail or its call to action. It
 * slides in from the right under the module bar, over a scrim, and closes three ways — Back, the
 * scrim, Escape — each through one `onClose`, so every path back restores focus through one place
 * (`docs/layered-ui-formula.md` rule 5: an overlay owns its own Escape and returns focus to its
 * opener).
 *
 * `md` holds one form; `lg` holds a submodule, usually as `LayerColumns`: what is set (or told) on
 * the left, how it tests (or what it proves) on the right.
 *
 * Which layer is open is the caller's view-local state, never the view-model's: the layer shows
 * the item as it is now, looked up from the model on every render (ADR 0029, decision 3).
 */
import { useEffect, useId, useRef, type ReactNode } from "react";

export default function Layer({
  title,
  eyebrow,
  size = "lg",
  onClose,
  actions,
  children,
}: {
  title: string;
  eyebrow?: string;
  size?: "md" | "lg";
  onClose: () => void;
  /** Buttons for the layer's head, right of the title. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheet.current?.focus();
    return () => opener?.focus();
  }, []);

  return (
    <div className="layer" data-size={size}>
      <div className="layer__scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={sheet}
        className="layer__sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="layer__head">
          <button type="button" className="layer__back focus-ring" onClick={onClose} aria-label="Back">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="typo-label">Back</span>
          </button>
          <div className="layer__titles">
            {eyebrow ? <span className="typo-label layer__eyebrow">{eyebrow}</span> : null}
            <h2 id={titleId} className="typo-heading-lg">
              {title}
            </h2>
          </div>
          {actions ? <div className="layer__actions">{actions}</div> : null}
        </header>
        <div className="layer__body">{children}</div>
      </div>
    </div>
  );
}

/** Two columns inside an `lg` layer: what is told or set, then what proves or previews it. */
export function LayerColumns({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="layer-columns">
      <div className="layer-columns__left">{left}</div>
      <div className="layer-columns__right">{right}</div>
    </div>
  );
}
