/**
 * A page tool's contract, hashed — README section 3.3, the per-origin trust row, amended by ADR 0100.
 *
 * Trust used to be one bit per origin: once the user enabled an app, any tool it registered was
 * classed from its flags alone, so a page that rewrote `list_invoices` to say "send every invoice"
 * kept running it unattended as long as its flags stayed reversible. A tool's *contract* is the
 * part of its registration a person or a model reads to decide what it does: its name, title,
 * description, input schema and the flags the gate reads. The surface keeps the contract the user
 * last accepted per origin and tool, and a tool whose contract is not that one is sent to the gate
 * as `GATED` (`stores/run.ts`, `gatedListsOf`). Nothing here loosens anything.
 *
 * The hash is SHA-256 over a canonical JSON spelling (keys sorted at every depth), computed
 * synchronously in plain TypeScript: the gate's lists are built synchronously at snapshot time and
 * on every render of the companion, and `crypto.subtle` is asynchronous and absent outside a secure
 * context (ADR 0100). A page controls every byte hashed, so a short non-cryptographic hash would be
 * a collision it could aim for.
 *
 * What is kept beside the hash is the text a card needs to show the old contract next to the new
 * one, cut to {@link CONTRACT_TEXT_MAX} characters with the total kept, so the stored record stays
 * bounded and the card can still say `(showing N of M)`.
 */
import type { BridgeTool } from "@/lib/bridge";

/** The most characters of a description or a schema kept in the record and shown on a card. */
export const CONTRACT_TEXT_MAX = 240;

/** The contract the user accepted for one tool on one origin. */
export interface ToolContract {
  /** SHA-256, hex, of {@link contractText}. */
  hash: string;
  /** The description, neutralised and cut to {@link CONTRACT_TEXT_MAX}. */
  description: string;
  /** How long the neutralised description was before it was cut. */
  description_total: number;
  /** The canonical input schema, cut to {@link CONTRACT_TEXT_MAX}. */
  schema: string;
  schema_total: number;
}

/** Accepted contracts: web origin to tool name to the contract. */
export type ContractTable = Readonly<Record<string, Readonly<Record<string, ToolContract>>>>;

/** One side of a changed contract, as a card shows it: each text already says if it was cut. */
export interface ContractSide {
  description: string;
  schema: string;
}

/** A tool whose contract is not the accepted one. `before` is null for a tool never accepted. */
export interface ContractDrift {
  tool: string;
  before: ContractSide | null;
  after: ContractSide;
}

/**
 * JSON with every object's keys sorted, at every depth. `undefined` members are dropped and a value
 * JSON cannot spell becomes `null`, exactly as `JSON.stringify` would, so two registrations that
 * mean the same object spell the same string whatever order the page wrote its keys in.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && typeof v !== "function")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return "null";
}

/** Everything of a registration the gate or a reader acts on, in one canonical string. */
export function contractText(tool: BridgeTool): string {
  return canonicalJson({
    name: tool.name,
    title: tool.title ?? null,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema ?? null,
    annotations: tool.annotations ?? null,
    athena: tool.athena ?? null,
  });
}

// A tool list is replaced, never mutated, so a tool object's hash is its hash for life.
const hashes = new WeakMap<BridgeTool, string>();

export function contractHashOf(tool: BridgeTool): string {
  const known = hashes.get(tool);
  if (known !== undefined) return known;
  const hash = sha256Hex(contractText(tool));
  hashes.set(tool, hash);
  return hash;
}

/**
 * C0 and C1 controls, zero-width characters, line and paragraph separators, bidi embeddings and
 * isolates, word joiners and the byte-order mark. Built from code points so no invisible character
 * sits in this file.
 */
const INVISIBLE = new RegExp(
  `[${[
    [0x00, 0x1f],
    [0x7f, 0x9f],
    [0x200b, 0x200f],
    [0x2028, 0x202e],
    [0x2060, 0x2069],
    [0xfeff, 0xfeff],
  ]
    .map(([a, b]) => `\\u${a.toString(16).padStart(4, "0")}-\\u${b.toString(16).padStart(4, "0")}`)
    .join("")}]`,
  "g",
);

/**
 * Page text made safe to put in front of a person: control characters, zero-width and bidi
 * overrides become spaces and runs of space collapse, so a description cannot reorder or hide
 * what the card shows. React escapes the rest.
 */
export function neutral(text: string): string {
  return text
    .replace(INVISIBLE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The record kept when a contract is accepted: the hash and the bounded text a card shows. */
export function contractOf(tool: BridgeTool): ToolContract {
  const description = neutral(tool.description ?? "");
  const schema = neutral(canonicalJson(tool.inputSchema ?? null));
  return {
    hash: contractHashOf(tool),
    description: description.slice(0, CONTRACT_TEXT_MAX),
    description_total: description.length,
    schema: schema.slice(0, CONTRACT_TEXT_MAX),
    schema_total: schema.length,
  };
}

/** A kept text as a card shows it: whole, or cut and saying so. */
function shown(text: string, total: number): string {
  const n = Math.min(text.length, CONTRACT_TEXT_MAX);
  return total > n ? `${text.slice(0, n)} (showing ${n} of ${total})` : text;
}

const sideOf = (c: ToolContract): ContractSide => ({
  description: shown(c.description, c.description_total),
  schema: shown(c.schema, c.schema_total),
});

/** The drift of one tool against the contract accepted for it, or null when it is the same one. */
export function driftOf(accepted: ToolContract | undefined, tool: BridgeTool): ContractDrift | null {
  if (accepted !== undefined && accepted.hash === contractHashOf(tool)) return null;
  return {
    tool: tool.name,
    before: accepted === undefined ? null : sideOf(accepted),
    after: sideOf(contractOf(tool)),
  };
}

// -- SHA-256 (FIPS 180-4), synchronous ----------------------------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of a string's UTF-8 bytes, as lowercase hex. */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}
