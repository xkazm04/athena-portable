/**
 * The forms she can take, as the person is offered them (the ADR on Athena's face): the Face step of
 * the first act and the picker in Voice settings read this one list, so their words cannot drift.
 */
import type { AvatarId } from "@/avatar/types";

/** In the order they are offered: the two faces, then no face at all. */
export const FACE_CHOICES: readonly { id: AvatarId; label: string }[] = [
  { id: "b04-owl", label: "Owl of light" },
  { id: "d08-origami", label: "Origami" },
  { id: "halo", label: "Just the halo" },
];
