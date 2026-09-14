/**
 * How fast the scene moves, and how firmly it draws what is not being read.
 *
 * Every number here was arrived at by watching the thing on a slow machine, and
 * the comments say what went wrong before it was this value. Kept together
 * because they are one decision: a flatten that takes a fixed time, an opacity
 * that cannot jump, and a weight that says which quadrant the reader is on.
 */

import { FLATTEN as FLATTEN_MS } from "../beats";

/** Ease out, so everything decelerates onto its target rather than stopping. */
export const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * How long the records take to leave the lattice and form the plate, in
 * seconds, and how long they take to fall back.
 *
 * Driven off the clock rather than off a per-frame lerp. A lerp written as
 * `value += (want - value) * delta * rate` looks smooth at sixty frames a
 * second and TELEPORTS on a slow one, because the moment `delta * rate` reaches
 * one the whole remaining distance is covered in a single frame — which is
 * exactly what happened on a software renderer, where the flatten finished
 * before the first frame was even shown. A duration cannot do that.
 *
 * The flatten is the first third of the L0 -> L1 budget, so its length is not
 * this file's to decide: it is `../beats.ts`, in milliseconds, converted here.
 * The unflatten is, because nothing waits on it — it is what an ABANDONED move
 * looks like, and a cube that comes back faster than it left is the right answer
 * for a reader who has just said no.
 */
export const FLATTEN = FLATTEN_MS / 1000;
export const UNFLATTEN = 0.34;

/**
 * A frame-rate-independent approach factor, with a ceiling.
 *
 * Same trap as above, one order milder: this is only ever used for opacity, so
 * a jump is a flicker rather than a lost transition, but the ceiling keeps even
 * that from happening on a stalled frame.
 */
export const approach = (delta: number, rate: number) => Math.min(0.3, delta * rate);

/**
 * How firmly a quadrant is drawn, given what the reader is pointing at.
 *
 * A line in WebGL cannot be thickened, so weight here is opacity: the quadrant
 * under the pointer is drawn nearly solid and the other three step back to a
 * ghost, which is what a draughtsman does when they trace one part of a general
 * arrangement. Nothing is hidden — every zone stays legible — but only one is
 * being read.
 */
export const EDGE_REST = 0.55;
export const EDGE_LIT = 0.95;
export const EDGE_ASIDE = 0.16;
