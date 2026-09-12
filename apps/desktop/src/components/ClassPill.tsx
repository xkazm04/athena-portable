/**
 * @catalog A tool's class as a pill, and the tighten-only picker behind it.
 *
 * Two surfaces show the same fact — the Panel's tool list for the page in front of the user, the
 * Origins detail's override table for every page ever seen — and both let the user pin the class
 * from it. Two spellings of `AUTO` would be two answers to "what will happen when Athena calls
 * this", which is the one question these surfaces exist to answer.
 *
 * The hue rides the `StatusDot` inside the pill and never the word (house style §4b), so the
 * class name is `--foreground` at every size and in both themes. `AUTO` is a success only in the
 * sense of "nothing will interrupt you"; `GATED` is a warning only in the sense of "this will
 * stop and ask" — the word beside the dot is what actually says which, and the dot is the second
 * channel rather than the only one.
 *
 * `ClassPicker` renders the allowed set its **view-model** hands it and prints that model's
 * reason where the options would have been. It derives nothing: the rule is the gate's and the
 * reading of it is `@/lib/classes`', which both modules' selectors spend (ADR 0018). A control
 * that offered a looser class would be a control whose every press is refused somewhere the user
 * cannot see.
 */
import Button from "@/components/Button";
import PillGroup from "@/components/PillGroup";
import StatusDot, { type Tone } from "@/components/StatusDot";
import { CLASS_WORD } from "@/lib/classes";
import type { ToolClass } from "@/lib/store";

const TONE: Record<ToolClass, Tone> = {
  AUTO: "success",
  READ: "info",
  GATED: "warning",
};

export default function ClassPill({
  cls,
  overridden = false,
  onClick,
  expanded,
}: {
  cls: ToolClass;
  /** The user pinned this class rather than the manifest declaring it. Marked, never hidden. */
  overridden?: boolean;
  /** When given, the pill is the control that opens the picker. */
  onClick?: () => void;
  expanded?: boolean;
}) {
  const body = (
    <>
      <StatusDot tone={TONE[cls]} />
      {cls}
      {overridden ? <span aria-hidden="true">*</span> : null}
    </>
  );
  const label = `${cls} — ${CLASS_WORD[cls]}${overridden ? ", pinned by you" : ""}`;

  if (!onClick) {
    return (
      <span className="badge typo-label" title={label}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="badge typo-label class-pill focus-ring"
      aria-expanded={expanded}
      aria-label={`${label}. Change it for this origin.`}
      onClick={onClick}
    >
      {body}
    </button>
  );
}

/**
 * The per-origin class control: `as declared`, then every class tighter than the declared one.
 *
 * A radio group rather than a cycling cell, because there are at most three positions and the
 * user should read all of them before choosing one — the density argument that made the reference
 * build cycle its cells belongs to a nine-column matrix, and neither of these two surfaces is one.
 */
export function ClassPicker({
  tool,
  declared,
  value,
  allowed,
  lockedReason,
  onChange,
}: {
  tool: string;
  /** What the manifest declared, or `null` when the page is not open and nothing is known. */
  declared: ToolClass | null;
  /** The stored override, or `null` for "as declared". */
  value: ToolClass | null;
  /** The classes this tool may be pinned at, from the model. Often empty, and that is a fact. */
  allowed: readonly ToolClass[];
  /** Why `allowed` is empty. Shown in the control's place, never left to be inferred. */
  lockedReason: string | null;
  onChange: (cls: ToolClass | null) => void;
}) {
  // Nothing to pick: the reason stands where the rail would have been, and a ruling that is
  // already stored still has the one act that applies to it.
  if (allowed.length === 0) {
    return (
      <span className="row" style={{ gap: 8 }}>
        <span className="typo-caption">{lockedReason}</span>
        {value !== null ? (
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            Clear
          </Button>
        ) : null}
      </span>
    );
  }

  const options = [
    {
      value: "declared",
      label: declared ? `as declared · ${declared}` : "as declared",
      hint: declared ? CLASS_WORD[declared] : "the page is not open",
    },
    ...allowed.map((cls) => ({ value: cls as string, label: cls, hint: CLASS_WORD[cls] })),
  ];

  return (
    <PillGroup
      ariaLabel={`Class of ${tool}`}
      value={value ?? "declared"}
      options={options}
      onChange={(next) => onChange(next === "declared" ? null : (next as ToolClass))}
    />
  );
}
