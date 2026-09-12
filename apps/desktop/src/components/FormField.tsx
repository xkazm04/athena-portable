/**
 * @catalog A labelled field — label, hint or error, wired for a11y — and the text input it wraps.
 *
 * Two things it carries that a hand-rolled `<label><input/></label>` does not:
 *
 * - **The label is the heading tier and full contrast.** Weight is the signal (catalog rule 2).
 *   A form whose labels render at the weight of their own help text is a form with no labels.
 * - **`aria-invalid` and `aria-describedby` are wired by the wrapper**, through the render-prop
 *   form of `children`, so a field cannot be labelled correctly by accident and wrong by
 *   default. The error *replaces* the hint rather than joining it, and carries `role="alert"`.
 *
 * `TextInput` is the same `.input` every other control in the app spends, so nothing invents a
 * fifth border-padding-focus recipe.
 */
import { useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";

/** What the wrapper hands a render-prop child, so the input is wired without the caller thinking. */
export interface FieldInputProps {
  id: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}

export default function FormField({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  /** Secondary prose under the control. Suppressed while an error is showing. */
  hint?: ReactNode;
  /** A blocking message. Replaces the hint and marks the control invalid. */
  error?: string | null;
  children: ReactNode | ((input: FieldInputProps) => ReactNode);
}) {
  const id = `field-${useId()}`;
  const errorId = `${id}-err`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  const input: FieldInputProps = {
    id,
    ...(error ? { "aria-invalid": true as const } : {}),
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
  };

  return (
    <div className="field">
      <label htmlFor={id} className="typo-heading">
        {label}
      </label>
      {typeof children === "function" ? children(input) : children}
      {error ? (
        <p id={errorId} role="alert" className="typo-caption field__error">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="typo-caption">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** The app's one text input. `invalid` paints the error edge; pass what you passed the field. */
export function TextInput({
  invalid,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...rest}
      aria-invalid={invalid || rest["aria-invalid"] ? true : undefined}
      className="input typo-body focus-ring field__input"
      spellCheck={false}
    />
  );
}
