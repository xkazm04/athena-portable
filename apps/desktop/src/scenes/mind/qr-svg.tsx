/**
 * The phone's pairing address as a QR picture — ADR 0140 ("Pairing + Devices page"), fleet-surfaces
 * WP3. The encoder is `qr.ts` (WP2); this file only draws its matrix.
 *
 * One `<path>` of dark modules on one paper `<rect>`, with the four-module quiet zone the standard
 * asks for, `shape-rendering: crispEdges` so a scaled module stays a hard square, and each run of
 * dark modules along a row merged into one rectangle, which keeps the path a few hundred commands
 * long instead of a thousand. The colours are the stylesheet's (`.qr__paper`, `.qr__ink`): dark on
 * light in both themes, because a phone camera reads light-on-dark codes badly or not at all.
 *
 * The text is a claim credential (the pairing id and its nonce). It goes into the encoder and
 * nowhere else: not into the picture's accessible name, not into a title, not into a log. When the
 * encoder cannot draw it - the text is too long for version 10, or the encoder is not built yet -
 * {@link qrPicture} answers `null` and the caller shows the code and the address alone.
 */
import { qrMatrix } from "./qr";

/** The light margin around the code, in modules (ISO/IEC 18004 asks for four). */
export const QUIET = 4;

/** A drawn code: its side in modules, quiet zone included, and the dark modules as one path. */
export interface QrPicture {
  size: number;
  path: string;
}

/** The picture of `text`, or `null` when the encoder cannot hold it. Never throws, never logs. */
export function qrPicture(text: string): QrPicture | null {
  let matrix: boolean[][];
  try {
    matrix = qrMatrix(text);
  } catch {
    // RangeError (too long), or an encoder that is not there yet: the code alone is shown.
    return null;
  }
  const n = matrix.length;
  if (n === 0) return null;
  let path = "";
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < n) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      let run = 1;
      while (x + run < n && row[x + run]) run += 1;
      path += `M${x + QUIET} ${y + QUIET}h${run}v1h-${run}z`;
      x += run;
    }
  });
  return { size: n + 2 * QUIET, path };
}

/** The picture itself. `label` is its accessible name: what it is for, never what it says. */
export default function QrSvg({ picture, label }: { picture: QrPicture; label: string }) {
  const { size, path } = picture;
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect className="qr__paper" width={size} height={size} />
      <path className="qr__ink" d={path} />
    </svg>
  );
}
