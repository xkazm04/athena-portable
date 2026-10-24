/**
 * A QR encoder, in the tree because ADR 0140 allows no dependency for it (fleet-surfaces WP2).
 *
 * Byte mode, error correction level M, the smallest version from 1 to 10 that holds the text, and
 * the mask with the lowest standard penalty. `true` is a dark module; the matrix carries no quiet
 * zone. The text is a pairing credential: nothing here logs it.
 */
export function qrMatrix(text: string): boolean[][] {
  void text;
  throw new RangeError("qrMatrix: not built yet (fleet-surfaces WP2)");
}
