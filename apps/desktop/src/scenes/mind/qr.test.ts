/**
 * The QR encoder (fleet-surfaces WP2), checked without a decoder: the structure every reader looks
 * for first, the format and version words read back and checked against their BCH codes, and three
 * whole matrices pinned from outside this tree.
 *
 * The pinned matrices were generated once, offline, by two independent encoders that agreed module
 * for module: Project Nayuki's qrcodegen (as bundled in qrcode.react 3.2.0, byte segment, EC M, no
 * level boost, automatic mask) and node-qrcode 1.5.4 (byte segment, EC M, told the same mask).
 * Their automatic masks agree on the two longer texts; on "athena" node-qrcode's simpler rule 3
 * picks mask 0, so `qrMatrix` is held to qrcodegen's choice there, whose penalty this encoder uses.
 */
import { describe, expect, test } from "vitest";

import { formatBits, qrEncode, qrMatrix } from "./qr";

const URL_78 = "http://100.101.102.103:17491/m/#claim=pair_0123456789ab.AbCdEfGhIjKlMnOpQrStUv";

const bit = (matrix: boolean[][], row: number, col: number) => (matrix[row][col] ? 1 : 0);

/** The remainder of `word` (of `width` bits) divided by `generator` (of degree `degree`). */
function bchRemainder(word: number, width: number, generator: number, degree: number): number {
  let rem = word;
  for (let i = width - 1; i >= degree; i--) {
    if ((rem >>> i) & 1) rem ^= generator << (i - degree);
  }
  return rem;
}

/** Both copies of the 15 format bits, bit 0 first, from where 7.9.1 puts them. */
function readFormat(matrix: boolean[][]): [number, number] {
  const size = matrix.length;
  // Down column 8 past the timing row, then left along row 8 past the timing column.
  const first: [number, number][] = [
    ...[0, 1, 2, 3, 4, 5, 7, 8].map((row): [number, number] => [row, 8]),
    ...[7, 5, 4, 3, 2, 1, 0].map((col): [number, number] => [8, col]),
  ];
  const second: [number, number][] = [
    ...Array.from({ length: 8 }, (_, i): [number, number] => [8, size - 1 - i]),
    ...Array.from({ length: 7 }, (_, i): [number, number] => [size - 7 + i, 8]),
  ];
  const word = (cells: [number, number][]) =>
    cells.reduce((acc, [r, c], i) => acc | (bit(matrix, r, c) << i), 0);
  return [word(first), word(second)];
}

/** Both copies of the 18 version bits (7.10): bottom-left 6x3 and top-right 3x6, bit 0 first. */
function readVersion(matrix: boolean[][]): [number, number] {
  const size = matrix.length;
  let lower = 0;
  let upper = 0;
  for (let i = 0; i < 18; i++) {
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    lower |= bit(matrix, a, b) << i;
    upper |= bit(matrix, b, a) << i;
  }
  return [lower, upper];
}

function expectFinder(matrix: boolean[][], top: number, left: number) {
  for (let dy = -1; dy <= 7; dy++) {
    for (let dx = -1; dx <= 7; dx++) {
      const r = top + dy;
      const c = left + dx;
      if (r < 0 || c < 0 || r >= matrix.length || c >= matrix.length) continue;
      const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      expect(matrix[r][c], `finder module ${r},${c}`).toBe(ring !== 2 && ring !== 4);
    }
  }
}

function expectStructure(text: string) {
  const { version, mask, matrix } = qrEncode(text);
  const size = matrix.length;
  expect(size).toBe(version * 4 + 17);
  expect(matrix.every((row) => row.length === size)).toBe(true);

  expectFinder(matrix, 0, 0);
  expectFinder(matrix, 0, size - 7);
  expectFinder(matrix, size - 7, 0);
  for (let i = 8; i < size - 8; i++) {
    expect(matrix[6][i], `timing row at ${i}`).toBe(i % 2 === 0);
    expect(matrix[i][6], `timing column at ${i}`).toBe(i % 2 === 0);
  }
  expect(matrix[4 * version + 9][8], "the dark module").toBe(true);

  const [first, second] = readFormat(matrix);
  expect(first).toBe(second);
  expect(first).toBe(formatBits(mask));
  const unmasked = first ^ 0x5412;
  expect(bchRemainder(unmasked, 15, 0x537, 10)).toBe(0);
  expect(unmasked >>> 13, "level M is 00").toBe(0b00);
  expect((unmasked >>> 10) & 0b111).toBe(mask);

  if (version >= 7) {
    const [lower, upper] = readVersion(matrix);
    expect(lower).toBe(upper);
    expect(lower >>> 12).toBe(version);
    expect(bchRemainder(lower, 18, 0x1f25, 12)).toBe(0);
  }
  return { version, mask, matrix };
}

const draw = (matrix: boolean[][]) => matrix.map((row) => row.map((d) => (d ? "#" : ".")).join(""));

describe("qrMatrix", () => {
  test("a short text is a version 1 code, 21 modules a side", () => {
    expect(qrMatrix("athena")).toHaveLength(21);
    expect(expectStructure("athena").version).toBe(1);
  });

  test("a 78-byte pairing URL is version 5, 37 modules", () => {
    expect(new TextEncoder().encode(URL_78)).toHaveLength(78);
    const { version, matrix } = expectStructure(URL_78);
    expect(version).toBe(5);
    expect([33, 37]).toContain(matrix.length);
  });

  test("every version from 1 to 10 has its finders, timing, format and version words", () => {
    // The byte capacity at level M of versions 1..10; each length here is a version's maximum.
    const capacity = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
    capacity.forEach((bytes, index) => {
      expect(expectStructure("x".repeat(bytes)).version).toBe(index + 1);
      if (index < 9) expect(expectStructure("x".repeat(bytes + 1)).version).toBe(index + 2);
    });
  });

  test("every mask writes its own format word", () => {
    for (let mask = 0; mask < 8; mask++) {
      const { matrix } = qrEncode(URL_78, mask);
      expect(readFormat(matrix)).toEqual([formatBits(mask), formatBits(mask)]);
    }
  });

  test("past version 10 is a RangeError, counted in UTF-8 bytes", () => {
    expect(qrMatrix("x".repeat(213))).toHaveLength(57);
    expect(() => qrMatrix("x".repeat(214))).toThrow(RangeError);
    expect(() => qrMatrix("é".repeat(107))).toThrow(RangeError); // 214 bytes in 107 characters
    expect(() => qrEncode("athena", 8)).toThrow(RangeError);
  });

  test.each([
    ["version 1", () => SHORT],
    ["version 5", () => URL],
    ["version 8", () => LONG],
  ])("matches the pinned %s reference module for module", (_, pinned) => {
    const { text, version, mask, rows } = pinned();
    const forced = qrEncode(text, mask);
    expect(forced.version).toBe(version);
    expect(draw(forced.matrix)).toEqual(rows);
    const chosen = qrEncode(text);
    expect(chosen.mask).toBe(mask);
    expect(draw(qrMatrix(text))).toEqual(rows);
  });
});

/** 6 bytes: version 1, mask 2. */
const SHORT = {
  text: "athena",
  version: 1,
  mask: 2,
  rows: [
    "#######..#.#..#######",
    "#.....#.....#.#.....#",
    "#.###.#.#.....#.###.#",
    "#.###.#.#.#.#.#.###.#",
    "#.###.#.#####.#.###.#",
    "#.....#.#.#.#.#.....#",
    "#######.#.#.#.#######",
    "........#####........",
    "#.#####..#..#.#####..",
    "#.##....#.#.#..#.####",
    "#.#####..#.#.#..#.##.",
    "#..##..........#####.",
    "##.#..######.#..#....",
    "........#.######....#",
    "#######...#.#.##..##.",
    "#.....#.##.####..##.#",
    "#.###.#.#...#..#...#.",
    "#.###.#.##..#..####..",
    "#.###.#.#..#.#...##..",
    "#.....#..##....####..",
    "#######.#.##.#..#..#.",
  ],
};

/** 78 bytes: version 5, mask 4. */
const URL = {
  text: "http://100.101.102.103:17491/m/#claim=pair_0123456789ab.AbCdEfGhIjKlMnOpQrStUv",
  version: 5,
  mask: 4,
  rows: [
    "#######.#..##.#.##.#...#.##.#.#######",
    "#.....#..####..##..####..##...#.....#",
    "#.###.#..#..#..###..##....#.#.#.###.#",
    "#.###.#.##.#..#...#...#.##.#..#.###.#",
    "#.###.#.####..#.#.#..#####.#..#.###.#",
    "#.....#.##...###...#..#...#...#.....#",
    "#######.#.#.#.#.#.#.#.#.#.#.#.#######",
    "........##.#.....###.###..#..........",
    "#...#.###..#.#####.#..#.#..#.#####..#",
    ".##.##.#.##.#.#..........#####.##..#.",
    "....#.##..####.#.#..##.#...#.#.##.#..",
    ".#..##......#.######.##....###.#.###.",
    "..#####.#.....#.##.###.#..#...#..####",
    "#.#.#..###...#.##.#..#####.#.#.###.#.",
    ".##.###..##.##.#..#.##.#..##.###.###.",
    "#.#.##.#.##....###.#.#.....###....##.",
    "..#..##.###..###..##.#####....#..##.#",
    "###....#.#.##.#.####.#.#.##.##.##..#.",
    "..##..#.....#...##...#####.###..##...",
    "#.####..#.#...#..###.#.#.....#.#.###.",
    "..###.##..###..#.#.###.#..###.#..##..",
    "#####....##.#######.########...##..#.",
    "....#####...#.##..#.#..##.##########.",
    ".#..#...##...#.##..####...###..####.#",
    "#..####.#.#.#.#.#.....#.#....##..###.",
    "#.#......#.#.##..##.......##...##....",
    "..###.######...#.##.####.####.##.....",
    "..####.#######.####..#.#....####.####",
    "###..#######.#...#####.#..#.########.",
    "........#...#.###...##.###.##...#.###",
    "#######.#...#.####..#..#.##.#.#.##...",
    "#.....#...#..######.##.#...##...#####",
    "#.###.#.#...#.....#..##.##..#####.#.#",
    "#.###.#..#.###..##.#.###.###..##.#..#",
    "#.###.#...###.#.###....##..##.#..##..",
    "#.....#...#####..##..#..#.##.#.#####.",
    "#######.#.#....###.####...##.##..####",
  ],
};

/** 131 bytes: version 8, mask 2. */
const LONG = {
  text: "http://100.101.102.103:17491/m/#claim=pair_0123456789ab.AbCdEfGhIjKlMnOpQrStUv&note=a-longer-pairing-link-to-reach-version-eight-ok",
  version: 8,
  mask: 2,
  rows: [
    "#######....###......#..#.#####..#..#....#.#######",
    "#.....#..#.#.#.......##.#...#.######..###.#.....#",
    "#.###.#.##.#.###.#.#..#.#..##.#.##.#...##.#.###.#",
    "#.###.#.#.###.###.#..###.#...#.#...##..#..#.###.#",
    "#.###.#.####.#....#########...#.##.###....#.###.#",
    "#.....#.#..#.....##.#.#...####....###.#...#.....#",
    "#######.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#######",
    "........##.##.##.######...#####.##...#.#.........",
    "#.#####..#.##.##..#.#######...##...##..##.#####..",
    "#.##...#.#.#.#.#...#..#......####..##....###.....",
    "####.######...#.##.##.##..###.#..##..##.....#..##",
    "###.##....##.....##..#....#.#..###.#.##..#.##...#",
    "..######...####.##.#.####.##.##..##.##.###.#..#.#",
    "...#.#.##.##.######..#..##...##..#...#.#..###..#.",
    "#.########.##.#.#.##...##..##....###..#....######",
    "..###...###.#..##....#...##...##.##...##..###...#",
    "#..#..#..##.###.....#..##.##.##...####..#.#..##..",
    "#..###..##.##.##.#.#.#.###....##.#.###.#..###..#.",
    "####..###.##...#.###..##..##.##..#.#..#.##.###.##",
    "#.###......####..#.........##..###...###.##.#..##",
    "....#.#..##.....####.##.##.....#.#.##.#.#.#...##.",
    "##......#.####.#.###..##...#..##.#.#...#.##.##.##",
    "##.#######....###.#.#.#####.##..#.###########..##",
    "#...#...#.....####....#...##.##..#.#.#.##...#...#",
    ".##.#.#.##....#.##..###.#.#..###.##.##.##.#.#####",
    "#.#.#...###.####...#..#...##.##.##..#..##...#..#.",
    "##########..####.###..#######....##..############",
    "...##...#.#.#..#....#.##.#..##.##.#..##.#...##.##",
    ".#########..##.#.#...#######........#..###..####.",
    ".....#...#.#####.#.####.####.###...###.###.#.....",
    "##.#.####.#.#..#....#.####........#.#.#..####..##",
    "##.#.#....#######..##.#.#.##.#....#..#..#......#.",
    ".....######..###....#.##..#.#..####.######..#.#.#",
    "##...#..#..#.#...#.#...#######..#.#.##.###.#.....",
    "#..##.######..#.#..#.#####..#.####.##.#.#.#.##..#",
    "...##.....#.#.##.#.#...#..###.#.##.......#.##...#",
    "#.##..##.##.....##.####.#.#..###.#####.#..##..#..",
    "#####.....###..#..##.#.####...##.#.......###.###.",
    ".#...###....#.#..###..#.#...##...###.####.#.#..##",
    ".###......#..###..#..#.#..#####.#.##.#...#.....#.",
    "###...##.####...###.#######....#.##.#.#######.#.#",
    "........#.#.###.#.##.##...#.####...#....#...#..#.",
    "#######...#..#...#.#.##.#.#...#..#.######.#.###.#",
    "#.....#.##.#..###.#..##...#.######.#.####...#..##",
    "#.###.#.#.##..##...#..######.#...#..############.",
    "#.###.#.####.#.##.#......##.#.#.#...##.#######..#",
    "#.###.#.#.#....#..##.#..#.#....####.#.##.##..##..",
    "#.....#..#.#..#.#.#..######...##.#.#..###.#.....#",
    "#######.##.#.#.##.#.#..#...#.##....##...##....###",
  ],
};
