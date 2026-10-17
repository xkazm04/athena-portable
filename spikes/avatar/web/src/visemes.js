// Oculus-15 visemes -> mouth shape parameters the rig understands.
// open: jaw/lip opening 0..1   wide: corners out (+) / in (-)   round: pucker 0..1
// teeth: upper-teeth visibility 0..1   press: lips pressed (bilabials) 0..1   bite: lower lip tucked under upper teeth (f/v)
export const VISEMES = ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'ih', 'oh', 'ou'];

export const SHAPES = {
  sil: { open: 0.0, wide: 0.0, round: 0.0, teeth: 0.0, press: 0.0, bite: 0 },
  PP:  { open: 0.0, wide: -0.05, round: 0.05, teeth: 0.0, press: 1.0, bite: 0 },
  FF:  { open: 0.12, wide: 0.1, round: 0.0, teeth: 0.9, press: 0.0, bite: 1 },
  TH:  { open: 0.2, wide: 0.1, round: 0.0, teeth: 0.8, press: 0.0, bite: 0.2 },
  DD:  { open: 0.28, wide: 0.12, round: 0.0, teeth: 0.6, press: 0.0, bite: 0 },
  kk:  { open: 0.33, wide: 0.05, round: 0.05, teeth: 0.45, press: 0.0, bite: 0 },
  CH:  { open: 0.26, wide: -0.15, round: 0.45, teeth: 0.8, press: 0.0, bite: 0 },
  SS:  { open: 0.14, wide: 0.3, round: 0.0, teeth: 1.0, press: 0.0, bite: 0 },
  nn:  { open: 0.2, wide: 0.08, round: 0.0, teeth: 0.5, press: 0.0, bite: 0 },
  RR:  { open: 0.24, wide: -0.12, round: 0.55, teeth: 0.4, press: 0.0, bite: 0 },
  aa:  { open: 0.9, wide: 0.12, round: 0.0, teeth: 0.55, press: 0.0, bite: 0 },
  E:   { open: 0.55, wide: 0.38, round: 0.0, teeth: 0.75, press: 0.0, bite: 0 },
  ih:  { open: 0.38, wide: 0.3, round: 0.0, teeth: 0.7, press: 0.0, bite: 0 },
  oh:  { open: 0.62, wide: -0.25, round: 0.75, teeth: 0.3, press: 0.0, bite: 0 },
  ou:  { open: 0.32, wide: -0.42, round: 1.0, teeth: 0.15, press: 0.0, bite: 0 },
};

/** Weighted mouth shape from a {viseme: weight} map. `open` is NOT taken from here when the
 *  frame carries mouth.open (the frame is authoritative) - see rig.js. */
export function shapeFrom(visemes) {
  const out = { open: 0, wide: 0, round: 0, teeth: 0, press: 0, bite: 0, sum: 0 };
  if (!visemes) return out;
  for (const k in visemes) {
    const w = visemes[k];
    const s = SHAPES[k];
    if (!s || !(w > 0)) continue;
    out.sum += w;
    for (const p of ['open', 'wide', 'round', 'teeth', 'press', 'bite']) out[p] += w * s[p];
  }
  if (out.sum > 1) for (const p of ['open', 'wide', 'round', 'teeth', 'press', 'bite']) out[p] /= out.sum;
  return out;
}
