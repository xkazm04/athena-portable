/**
 * A QR encoder, in the tree because ADR 0140 allows no dependency for it (fleet-surfaces WP2).
 *
 * Byte mode, error correction level M, the smallest version from 1 to 10 that holds the text, and
 * the mask with the lowest standard penalty. `true` is a dark module; the matrix carries no quiet
 * zone. The text is a pairing credential: nothing here logs it.
 *
 * The steps are the ones ISO/IEC 18004 lays out, in order: the text becomes UTF-8 bytes behind a
 * mode and a length; that bit string is padded to the version's data capacity; the data codewords
 * are split into blocks, each gets its Reed-Solomon error correction, and the blocks are
 * interleaved; the fixed patterns (finders, timing, alignment, the dark module) are drawn and the
 * format and version areas reserved; the codewords are laid in the zigzag; then each of the eight
 * masks is tried and the one the penalty rules like best is kept, with its format bits written.
 * Ten versions is a 57-module code holding 213 bytes - a pairing URL is about 80.
 */

/** Per version 1..10 at level M: error correction codewords per block, and the blocks as
 * `[count, data codewords]` groups (ISO/IEC 18004 table 9). */
const BLOCKS_M: readonly (readonly [number, readonly (readonly [number, number])[]])[] = [
  [10, [[1, 16]]],
  [16, [[1, 28]]],
  [26, [[1, 44]]],
  [18, [[2, 32]]],
  [24, [[2, 43]]],
  [16, [[4, 27]]],
  [18, [[4, 31]]],
  [
    22,
    [
      [2, 38],
      [2, 39],
    ],
  ],
  [
    22,
    [
      [3, 36],
      [2, 37],
    ],
  ],
  [
    26,
    [
      [4, 43],
      [1, 44],
    ],
  ],
];

/** Alignment pattern centres per version (annex E); version 1 has none. */
const ALIGNMENT: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const MAX_VERSION = BLOCKS_M.length;
/** Level M's two format-indicator bits. */
const LEVEL_M = 0b00;

export function qrMatrix(text: string): boolean[][] {
  return qrEncode(text).matrix;
}

/** {@link qrMatrix} with what was chosen. `mask` forces one (0..7), which only the tests do: the
 * reference matrices they pin were made by another encoder told the same mask. */
export function qrEncode(
  text: string,
  mask: number | null = null,
): { version: number; mask: number; matrix: boolean[][] } {
  if (mask !== null && !(Number.isInteger(mask) && mask >= 0 && mask <= 7)) {
    throw new RangeError("qrEncode: a mask is 0 to 7");
  }
  const bytes = new TextEncoder().encode(text);
  const version = versionFor(bytes.length);
  const codewords = withErrorCorrection(dataCodewords(bytes, version), version);
  const size = version * 4 + 17;
  const grid = new Grid(size);
  drawFunctionPatterns(grid, version);
  drawCodewords(grid, codewords);
  const finished = (candidate: number) => {
    const matrix = grid.masked(candidate);
    drawFormatBits(matrix, candidate);
    return matrix;
  };
  if (mask !== null) return { version, mask, matrix: finished(mask) };
  // Each mask is scored as the finished symbol, its own format bits drawn; the first lowest wins.
  let best = { version, mask: 0, matrix: finished(0) };
  let bestScore = penalty(best.matrix);
  for (let candidate = 1; candidate < 8; candidate++) {
    const matrix = finished(candidate);
    const score = penalty(matrix);
    if (score < bestScore) {
      best = { version, mask: candidate, matrix };
      bestScore = score;
    }
  }
  return best;
}

// --- the bit string -------------------------------------------------------------------------------

function dataCapacity(version: number): number {
  return BLOCKS_M[version - 1][1].reduce((sum, [count, data]) => sum + count * data, 0);
}

/** The character count field is 8 bits in byte mode up to version 9, 16 from version 10. */
function countBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

function versionFor(length: number): number {
  for (let version = 1; version <= MAX_VERSION; version++) {
    const needed = 4 + countBits(version) + length * 8;
    if (needed <= dataCapacity(version) * 8) return version;
  }
  throw new RangeError(`qrMatrix: ${length} bytes do not fit a version ${MAX_VERSION} code`);
}

/** Mode 0100 (byte), the length, the bytes, a terminator of up to four zeros, zeros to a byte
 * boundary, then the pad bytes 0xEC 0x11 in turn up to the version's data capacity. */
function dataCodewords(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, width: number) => {
    for (let i = width - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, countBits(version));
  for (const byte of bytes) push(byte, 8);
  const capacity = dataCapacity(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    out.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
  }
  for (let pad = 0xec; out.length < capacity / 8; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

// --- error correction -----------------------------------------------------------------------------

/** Multiplication in GF(256) modulo x^8 + x^4 + x^3 + x^2 + 1 (0x11D), the field QR uses. */
function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** The generator polynomial (x - a^0)(x - a^1)...(x - a^(degree-1)), leading 1 dropped. */
function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

/** The remainder of the data polynomial divided by the generator: the error correction bytes. */
function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coefficient, i) => {
      result[i] ^= gfMultiply(coefficient, factor);
    });
  }
  return result;
}

/** Split into blocks, correct each, then interleave: data column by column across the blocks
 * (the short blocks run out first), then the correction bytes the same way. */
function withErrorCorrection(data: readonly number[], version: number): number[] {
  const [ecPerBlock, groups] = BLOCKS_M[version - 1];
  const divisor = rsDivisor(ecPerBlock);
  const blocks: number[][] = [];
  const corrections: number[][] = [];
  let offset = 0;
  for (const [count, length] of groups) {
    for (let i = 0; i < count; i++) {
      const block = data.slice(offset, offset + length);
      offset += length;
      blocks.push(block);
      corrections.push(rsRemainder(block, divisor));
    }
  }
  const out: number[] = [];
  const longest = Math.max(...blocks.map((block) => block.length));
  for (let i = 0; i < longest; i++) {
    for (const block of blocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const correction of corrections) out.push(correction[i]);
  }
  return out;
}

// --- the matrix -----------------------------------------------------------------------------------

/** The modules, and which of them are function modules that data and masks leave alone. */
class Grid {
  readonly dark: boolean[][];
  readonly fixed: boolean[][];

  constructor(readonly size: number) {
    this.dark = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }

  set(row: number, col: number, dark: boolean): void {
    this.dark[row][col] = dark;
    this.fixed[row][col] = true;
  }

  /** A copy with mask `mask` applied to every data module. The format bits are not drawn. */
  masked(mask: number): boolean[][] {
    return this.dark.map((cells, row) =>
      cells.map((dark, col) => (this.fixed[row][col] ? dark : dark !== maskBit(mask, row, col))),
    );
  }
}

/** The eight mask conditions (table 10), `i` the row and `j` the column. */
function maskBit(mask: number, i: number, j: number): boolean {
  switch (mask) {
    case 0:
      return (i + j) % 2 === 0;
    case 1:
      return i % 2 === 0;
    case 2:
      return j % 3 === 0;
    case 3:
      return (i + j) % 3 === 0;
    case 4:
      return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case 5:
      return ((i * j) % 2) + ((i * j) % 3) === 0;
    case 6:
      return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
    default:
      return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0;
  }
}

function drawFunctionPatterns(grid: Grid, version: number): void {
  const size = grid.size;
  // Timing: alternating along row 6 and column 6, dark on the even modules.
  for (let i = 0; i < size; i++) {
    grid.set(6, i, i % 2 === 0);
    grid.set(i, 6, i % 2 === 0);
  }
  // Finders, with their light separators, in three corners.
  for (const [row, col] of [
    [3, 3],
    [3, size - 4],
    [size - 4, 3],
  ]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const r = row + dy;
        const c = col + dx;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const ring = Math.max(Math.abs(dx), Math.abs(dy));
        grid.set(r, c, ring !== 2 && ring !== 4);
      }
    }
  }
  // Alignment patterns at every pair of centres, except the three that would sit on a finder.
  const centres = ALIGNMENT[version - 1];
  const last = centres.length - 1;
  centres.forEach((row, a) => {
    centres.forEach((col, b) => {
      if ((a === 0 && b === 0) || (a === 0 && b === last) || (a === last && b === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          grid.set(row + dy, col + dx, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    });
  });
  // Reserve the format areas (written after masking) and the dark module.
  for (let i = 0; i < 9; i++) {
    if (!grid.fixed[8][i]) grid.set(8, i, false);
    if (!grid.fixed[i][8]) grid.set(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    grid.set(8, size - 1 - i, false);
    grid.set(size - 1 - i, 8, false);
  }
  grid.set(size - 8, 8, true);
  // Version information, from version 7: 6 bits and a BCH(18, 6) remainder, in two 3x6 blocks.
  if (version >= 7) {
    const bits = (version << 12) | bchRemainder(version, 0x1f25, 12);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      grid.set(b, a, dark);
      grid.set(a, b, dark);
    }
  }
}

/** `value` shifted left by `degree`, reduced modulo `generator`: a BCH code's check bits. */
function bchRemainder(value: number, generator: number, degree: number): number {
  let rem = value;
  for (let i = 0; i < degree; i++) rem = (rem << 1) ^ ((rem >>> (degree - 1)) * generator);
  return rem & ((1 << degree) - 1);
}

/** The 15 format bits: level and mask, a BCH(15, 5) remainder, XOR 101010000010010 so the
 * area is never all light. Exported so the tests can read a matrix's format back and check it. */
export function formatBits(mask: number): number {
  const data = (LEVEL_M << 3) | mask;
  return ((data << 10) | bchRemainder(data, 0x537, 10)) ^ 0x5412;
}

/** Both copies of the format bits: around the top-left finder, and split between the other two. */
function drawFormatBits(matrix: boolean[][], mask: number): void {
  const size = matrix.length;
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) matrix[i][8] = bit(i);
  matrix[7][8] = bit(6);
  matrix[8][8] = bit(7);
  matrix[8][7] = bit(8);
  for (let i = 9; i < 15; i++) matrix[8][14 - i] = bit(i);
  for (let i = 0; i < 8; i++) matrix[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) matrix[size - 15 + i][8] = bit(i);
}

/** The codewords, most significant bit first, up and down two-column strips from the right,
 * skipping the timing column and every function module. Leftover modules stay light. */
function drawCodewords(grid: Grid, codewords: readonly number[]): void {
  const size = grid.size;
  const total = codewords.length * 8;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        if (grid.fixed[row][col] || i >= total) continue;
        grid.dark[row][col] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
        i++;
      }
    }
  }
}

// --- choosing the mask ----------------------------------------------------------------------------

const N1 = 3;
const N2 = 3;
const N3 = 40;
const N4 = 10;

/** The four penalty rules (7.8.3): long runs, 2x2 blocks, finder look-alikes, dark/light balance.
 * Rule 3 counts a 1:1:3:1:1 run with four light modules on either side, the light area past the
 * edge counted as the quiet zone it will be. */
function penalty(matrix: boolean[][]): number {
  const size = matrix.length;
  let score = 0;
  for (const line of linesOf(matrix)) {
    let colour = false;
    let run = 0;
    const history = [0, 0, 0, 0, 0, 0, 0];
    for (const dark of line) {
      if (dark === colour) {
        run++;
        if (run === 5) score += N1;
        else if (run > 5) score++;
      } else {
        addRun(history, run, size);
        if (!colour) score += finderLike(history) * N3;
        colour = dark;
        run = 1;
      }
    }
    if (colour) {
      addRun(history, run, size);
      run = 0;
    }
    addRun(history, run + size, size);
    score += finderLike(history) * N3;
  }
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const dark = matrix[r][c];
      if (dark === matrix[r][c + 1] && dark === matrix[r + 1][c] && dark === matrix[r + 1][c + 1]) {
        score += N2;
      }
    }
  }
  const darkCount = matrix.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  const total = size * size;
  score += (Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1) * N4;
  return score;
}

/** Every row, then every column. */
function linesOf(matrix: boolean[][]): boolean[][] {
  return [...matrix, ...matrix.map((_, c) => matrix.map((row) => row[c]))];
}

/** Push a finished run onto the newest-first history; the first run of a line gains the quiet zone. */
function addRun(history: number[], run: number, size: number): void {
  history.pop();
  history.unshift(history[0] === 0 ? run + size : run);
}

/** How many finder look-alikes end at the newest light run: dark 1:1:3:1:1 with 4 light beside. */
function finderLike(history: readonly number[]): number {
  const n = history[1];
  const core =
    n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
  return (
    (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) +
    (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0)
  );
}
