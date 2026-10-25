/**
 * One reader for a mirror of a daemon list - the read discipline the devices and sleep stores share.
 *
 * A mirror's bus is a nudge and its reads are the state. This reader decides when a read goes out
 * and whether its answer may be applied, so no store hand-rolls it:
 *
 * - **One flight at a time.** `load()` while a read is out joins it.
 * - **A nudge during a flight reads once more after it** (`nudge()`), so any number of bus frames
 *   that land while one read is out cost one read after it, never one each. A flight reads at most
 *   `maxReads` times in a row; the bus's reconnect beat catches anything after that.
 * - **A change this side made supersedes the flight** (`refresh()`): an act that settled knows the
 *   read out was issued before it, so a fresh read goes out at once and the old one's answer is
 *   dropped when it lands.
 * - **A generation is minted at issue**, and an answer is applied (or its failure told) only while
 *   its generation is still the newest issued. Authority is the order reads were issued in, never
 *   the order they came back in, so the state never steps back to an answer older than one shown.
 * - **A reconnect reads at most once per `rereadMinMs`** (`reconnected()`): the daemon ends a quiet
 *   stream every 15 s and a daemon with no bus refuses it at once.
 * - **Holders are counted** (`hold()`): the bus is followed once for any number of surfaces and let
 *   go with the last.
 *
 * Pure of any store: `read` returns the answer (or `null` when nothing can be asked, having said
 * why itself), `apply` and `onFail` put it where it belongs.
 */

export interface MirrorOptions<T> {
  /** Issue one read. `null` when it cannot be issued (no daemon); the store has said so itself. */
  read: () => Promise<T> | null;
  /** Put a current answer in the store. Never called for a superseded read. */
  apply: (answer: T) => void;
  /** Tell a current read's failure. Never called for a superseded read. */
  onFail: (error: unknown) => void;
  now: () => number;
  /** The least time between a read and a reconnect's read. */
  rereadMinMs: number;
  /** The most reads one flight makes in a row while nudges keep landing (default 3). */
  maxReads?: number;
  /** Follow the bus: `onChange` per nudge, `onConnected` per (re)connect. Returns its stop. */
  follow?: () => ((onChange: () => void, onConnected: () => void) => () => void) | undefined;
}

export interface Mirror {
  /** Read now, or join the read that is out. Settles when the mirror holds its newest answer. */
  load: () => Promise<void>;
  /** A bus frame: read now, or once more after the read that is out. */
  nudge: () => void;
  /** A change this side made: a fresh read now, superseding any that is out. */
  refresh: () => Promise<void>;
  /** A bus (re)connect: read, unless one was issued within `rereadMinMs`. */
  reconnected: () => void;
  /** Count one holder: the first reads and follows the bus. Returns its stop (idempotent). */
  hold: () => () => void;
  /** How many surfaces hold it now. */
  holders: () => number;
  /** Let go of the bus, forget every holder, and drop every answer still out (tests). */
  reset: () => void;
}

export function createMirror<T>(options: MirrorOptions<T>): Mirror {
  const maxReads = options.maxReads ?? 3;
  let generation = 0;
  let lastIssued = Number.NEGATIVE_INFINITY;
  let dirty = false;
  /** The newest read issued, settled or not. */
  let newest: Promise<void> | null = null;
  /** The flight: settles once no read is out and no nudge is owed. */
  let flight: Promise<void> | null = null;
  /** Which flight is the current one; a reset starts a new epoch and orphans the one out. */
  let epoch = 0;
  let count = 0;
  let unfollow: (() => void) | null = null;

  function issue(): Promise<void> {
    const mine = ++generation;
    dirty = false;
    lastIssued = options.now();
    const pending = options.read();
    if (!pending) return Promise.resolve();
    return pending.then(
      (answer) => {
        if (mine === generation) options.apply(answer);
      },
      (error: unknown) => {
        if (mine === generation) options.onFail(error);
      },
    );
  }

  function fly(): Promise<void> {
    if (flight) return flight;
    const mine = ++epoch;
    flight = (async () => {
      for (let reads = 0; reads === 0 || (dirty && reads < maxReads); reads += 1) {
        let awaited = (newest = issue());
        await awaited;
        // A refresh while this read was out issued a newer one: the flight ends with that one.
        while (newest && newest !== awaited) {
          awaited = newest;
          await awaited;
        }
        if (epoch !== mine) return; // reset meanwhile: this flight is no one's now
      }
    })().finally(() => {
      if (epoch !== mine) return;
      flight = null;
      newest = null;
    });
    return flight;
  }

  const mirror: Mirror = {
    load: fly,

    nudge() {
      if (flight) dirty = true;
      else void fly();
    },

    refresh() {
      if (!flight) return fly();
      newest = issue();
      return flight;
    },

    reconnected() {
      if (options.now() - lastIssued >= options.rereadMinMs) void fly();
    },

    hold() {
      count += 1;
      if (count === 1) {
        void fly();
        unfollow = options.follow?.()?.(mirror.nudge, mirror.reconnected) ?? null;
      }
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        count -= 1;
        if (count === 0) {
          unfollow?.();
          unfollow = null;
        }
      };
    },

    holders: () => count,

    reset() {
      unfollow?.();
      unfollow = null;
      count = 0;
      generation += 1;
      epoch += 1;
      dirty = false;
      flight = null;
      newest = null;
      lastIssued = Number.NEGATIVE_INFINITY;
    },
  };
  return mirror;
}
