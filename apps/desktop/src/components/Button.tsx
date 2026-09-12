/**
 * @catalog The canonical button, with `disabledReason` so an inert control is never silent.
 *
 * Catalog rule 2, weight is a signal: the label's *size* falls through to the document and only
 * the weight is set. The first build pinned every button label to the small strong tier, which is
 * smaller than the prose beneath it, so no button in the app had any rank.
 *
 * A disabled button whose reason is stated nowhere is a dead end (house style §2.2), so
 * `disabledReason` hangs the reason on a focusable wrapper — `title` alone is unreachable by
 * keyboard, and a `disabled` element is not focusable at all.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type Variant = "primary" | "secondary" | "ghost";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  variant?: Variant;
  size?: "sm" | "md";
  disabledReason?: string;
  children: ReactNode;
};

export default function Button({
  variant = "secondary",
  size = "md",
  disabledReason,
  children,
  ...rest
}: Props) {
  const classes = ["btn", `btn--${variant}`, "focus-ring"];
  if (size === "sm") classes.push("btn--sm");
  const button = (
    <button type="button" className={classes.join(" ")} disabled={Boolean(disabledReason)} {...rest}>
      {children}
    </button>
  );
  if (!disabledReason) return button;
  return (
    <span tabIndex={0} title={disabledReason} aria-label={disabledReason} className="focus-ring">
      {button}
    </span>
  );
}
