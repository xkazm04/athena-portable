/**
 * What a message typed while she is working means - fleet-surfaces, ADR 0141.
 *
 * Her composer never closes. A message the person sends while a turn of the main thread runs is
 * one of two things: a correction of what she is doing right now ("stop", "wait, the other one",
 * "no, the paid ones", "do March instead"), which should end that turn and be heard at once, or the
 * next thing to do, which should wait its turn. This says which, from the words alone.
 *
 * It is a heuristic and is meant to stay one: a short list of English cue words, read at the start
 * of the message (after a little filler such as "ok" or "please"), or anywhere in a message of a
 * few words, plus "instead" as the last word. Everything else queues, because a queued message is
 * never lost - the person sees it in line and can take it back - while a wrong interrupt throws
 * away work in progress.
 *
 * The cues, and why each is there:
 * - `stop`, `cancel`, `wait`, `hold on`: the plain words for "not this".
 * - `never mind` / `nevermind`: the person withdraws what they asked.
 * - `actually`, `instead`: a change of mind about the turn in flight.
 * - `no` followed by a comma, a stop or nothing: "no, the other one". "no problem" is not a cue.
 * - `don't` / `dont` / `do not`: forbids what she is about to do.
 */

export type MidTurn = "interrupt" | "queue";

/** Cues read as the message's first words (after filler). Lowercase; `\b` ends each. */
const LEADS = [
  "stop",
  "cancel",
  "wait",
  "hold on",
  "never mind",
  "nevermind",
  "actually",
  "instead",
  "don't",
  "dont",
  "do not",
];

/** Words a person puts before a cue without changing it: "ok wait", "please stop". */
const FILLER = new Set(["ok", "okay", "oh", "hey", "please", "sorry", "um", "uh", "hmm", "athena", "so"]);

/** A message of at most this many words is "mainly" its cue when it holds one anywhere: "please just stop". */
const SHORT_WORDS = 4;

/** Is the message a correction of the turn in flight (`interrupt`) or the next thing to do (`queue`)? */
export function classifyMidTurn(text: string): MidTurn {
  const plain = text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "queue";
  const words = plain.split(" ").map((w) => w.replace(/^[^a-z']+|[^a-z',.!?]+$/g, ""));
  // Leave the filler out, so "ok, wait" and "please stop" lead with their cue.
  let first = 0;
  while (first < words.length - 1 && FILLER.has(words[first]!.replace(/[,.!?]+$/, ""))) first += 1;
  const rest = words.slice(first).join(" ");
  if (leadsWithCue(rest)) return "interrupt";
  const bare = words.map((w) => w.replace(/[,.!?]+$/, ""));
  if (bare[bare.length - 1] === "instead") return "interrupt";
  // A question that does not lead with a cue asks and adds; a cue word inside it is a name, as in
  // "How is Cancel going?" asked about a task titled "Cancel".
  if (plain.endsWith("?")) return "queue";
  if (bare.length <= SHORT_WORDS && bare.some((_, i) => isCueAt(bare, i))) return "interrupt";
  return "queue";
}

function leadsWithCue(rest: string): boolean {
  // "no" is a cue only on its own: "no," "no." "no!" or the whole message. "no problem" is not.
  if (/^no(?:[,.!]|$)/.test(rest)) return true;
  // A hyphen joins the cue into another word ("stop-loss", "wait-list"), so it ends no cue either.
  return LEADS.some((cue) => rest === cue || new RegExp(`^${escape(cue)}(?![a-z'-])`).test(rest));
}

/**
 * A cue starting at position `i` of a short message. A bare "no" counts only as a lead: inside a few
 * words it is as often "no problem" as "no".
 */
function isCueAt(words: readonly string[], i: number): boolean {
  return LEADS.some((cue) => cue.split(" ").every((part, k) => words[i + k] === part));
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
