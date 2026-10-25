/**
 * The first act's Face step (the ADR on Athena's face): how she will appear, as three cards, each
 * her in that form, one radio group whose choice is the `avatar` setting.
 *
 * A face card speaks the sample line (the audition) while it has focus or the pointer, so the form is
 * chosen by watching it speak; it stops on blur, on leave and when the step goes, and stays still
 * under Calm. A computer that cannot draw a face (`canDrawFace`, asked once) is offered the halo
 * only: the face cards are disabled, the arrows pass over them and one line says why.
 *
 * Its own chunk, fetched when the step is first drawn: the first act is part of Main's first paint
 * (ADR 0095) and most of it is never this step.
 */
import { useEffect, type KeyboardEvent } from "react";

import { audition } from "@/avatar/audition";
import { Avatar } from "@/avatar/Avatar";
import { canDrawFace } from "@/avatar/support";
import type { AvatarId } from "@/avatar/types";
import Bell from "@/bell/Bell";

import { FACE_CHOICES } from "./faces";

/** The size of a face on a choice card. */
const CARD_FACE = 120;

export default function FaceStep({ avatar, onAvatar }: { avatar: AvatarId; onAvatar?: (avatar: AvatarId) => void }) {
  const drawable = canDrawFace();
  const offered = (id: AvatarId) => id === "halo" || drawable;
  // A stored face this computer cannot draw reads as the halo, which is what she will be.
  const chosen = offered(avatar) ? avatar : "halo";
  const choices = FACE_CHOICES.filter((c) => offered(c.id));

  useEffect(() => () => audition.stop(), []);

  // The cards are one radio group: one tab stop, and the arrows move the choice (WAI-ARIA, as PillGroup).
  const walk = (e: KeyboardEvent<HTMLDivElement>) => {
    const by = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (by === 0) return;
    e.preventDefault();
    const n = choices.length;
    const at = Math.max(0, choices.findIndex((c) => c.id === chosen));
    const next = choices[(at + by + n) % n]!;
    if (next.id !== chosen) onAvatar?.(next.id);
    e.currentTarget.querySelector<HTMLElement>(`[data-avatar-choice="${next.id}"]`)?.focus();
  };

  return (
    <>
      <p className="waking__lead">
        She can have a face that moves as she listens and speaks, or stay a halo of light at the edge of
        the screen.
      </p>
      <div className="waking__faces" role="radiogroup" aria-label="How she appears" onKeyDown={walk}>
        {FACE_CHOICES.map((c) => {
          const face = c.id !== "halo";
          const on = offered(c.id);
          const speak = face && on ? () => audition.play(c.id as Exclude<AvatarId, "halo">) : undefined;
          const hush = face && on ? () => audition.stop() : undefined;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={chosen === c.id}
              aria-disabled={on ? undefined : true}
              aria-label={c.label}
              tabIndex={chosen === c.id ? 0 : -1}
              className="waking__face focus-ring"
              data-avatar-choice={c.id}
              onClick={() => on && onAvatar?.(c.id)}
              onFocus={speak}
              onBlur={hush}
              onMouseEnter={speak}
              onMouseLeave={hush}
            >
              {c.id === "halo" ? (
                <Bell pose="resting" reach={[]} size={CARD_FACE} />
              ) : on ? (
                <Avatar avatar={c.id} size={CARD_FACE} source={audition.source(c.id)} />
              ) : (
                <span className="waking__face-blank" style={{ width: CARD_FACE, height: CARD_FACE }} aria-hidden="true" />
              )}
              <span className="waking__face-name">{c.label}</span>
            </button>
          );
        })}
      </div>
      {drawable ? null : <p className="waking__fact">This computer cannot draw her face, so she stays a halo of light.</p>}
      <p className="waking__fact">You can change this later in Voice.</p>
    </>
  );
}
