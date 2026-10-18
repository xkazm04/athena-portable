/**
 * The first act's Face step (the ADR on Athena's face): how she will appear, as three cards, each
 * her at rest in that form, one radio group whose choice is the `avatar` setting.
 *
 * Its own chunk, fetched when the step is first drawn: the first act is part of Main's first paint
 * (ADR 0095) and most of it is never this step.
 */
import type { KeyboardEvent } from "react";

import { Avatar } from "@/avatar/Avatar";
import { RESTING, type AvatarId, type FaceSource } from "@/avatar/types";
import Bell from "@/bell/Bell";

import { FACE_CHOICES } from "./faces";

/** A face at rest that never changes: the choice cards idle on their own procedural motion. */
const RESTING_SOURCE: FaceSource = {
  subscribe: (listener) => {
    listener(RESTING);
    return () => {};
  },
};

/** The size of a face on a choice card. */
const CARD_FACE = 120;

export default function FaceStep({ avatar, onAvatar }: { avatar: AvatarId; onAvatar?: (avatar: AvatarId) => void }) {
  // The cards are one radio group: one tab stop, and the arrows move the choice (WAI-ARIA, as PillGroup).
  const walk = (e: KeyboardEvent<HTMLDivElement>) => {
    const by = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (by === 0) return;
    e.preventDefault();
    const n = FACE_CHOICES.length;
    const at = Math.max(0, FACE_CHOICES.findIndex((c) => c.id === avatar));
    const next = FACE_CHOICES[(at + by + n) % n]!;
    onAvatar?.(next.id);
    e.currentTarget.querySelector<HTMLElement>(`[data-avatar-choice="${next.id}"]`)?.focus();
  };

  return (
    <>
      <p className="waking__lead">
        She can have a face that moves as she listens and speaks, or stay a halo of light at the edge of
        the screen.
      </p>
      <div className="waking__faces" role="radiogroup" aria-label="How she appears" onKeyDown={walk}>
        {FACE_CHOICES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={avatar === c.id}
            aria-label={c.label}
            tabIndex={avatar === c.id ? 0 : -1}
            className="waking__face focus-ring"
            data-avatar-choice={c.id}
            onClick={() => onAvatar?.(c.id)}
          >
            {c.id === "halo" ? (
              <Bell pose="resting" reach={[]} size={CARD_FACE} />
            ) : (
              <Avatar avatar={c.id} size={CARD_FACE} source={RESTING_SOURCE} />
            )}
            <span className="waking__face-name">{c.label}</span>
          </button>
        ))}
      </div>
      <p className="waking__fact">You can change this later in Voice.</p>
    </>
  );
}
