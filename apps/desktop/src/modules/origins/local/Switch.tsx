/**
 * A standing permission as a switch — this module's only control, and local to it on purpose.
 *
 * The catalog's rule for promoting a primitive is **two callers, or it stays in the module**
 * (`src/components/CATALOG.md`), and trust is a fact only Origins states today. When Connectors
 * or Projects grows its second standing permission this file moves to `src/components/` whole;
 * until then a primitive with one caller is a file move rather than a promotion.
 *
 * Three things about it are deliberate:
 *
 * - **`role="switch"` with `aria-checked`, not a button.** `Button` is for an act and `Badge` is
 *   for a fact; a standing permission is neither. What the user reads off the surface is which
 *   way it is set *now*, so the label names the permission ("Athena on invoices.example.test")
 *   and never the verb.
 * - **Off is drawn as the resting state**, not as an alarm: off is the default for every origin
 *   in this app (README section 3.3 — a page's tools are off until the user says otherwise) and
 *   a table of red switches on first launch would be saying something is wrong.
 * - **The click does not propagate.** The switch sits in a table row whose first cell is itself a
 *   button, and flipping trust must never also open the detail.
 */
export default function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The accessible name: the permission, not the verb. */
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      className="switch focus-ring"
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
    >
      <span className="switch__knob" aria-hidden="true" />
    </button>
  );
}
