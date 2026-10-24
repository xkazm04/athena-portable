/**
 * A computer's room, as the Devices level says it - device-vitals (ADR 0142, `lib/vitals.ts`).
 *
 * Every PC's daemon measures its own CPU, RAM, GPU, power and disk, decides from them how many
 * background tasks may run, and names the reason when work has to wait. The constellation says the
 * gate's one word under each computer ("room ok", "tight", "full"); a node's drawer says the figures
 * behind it as facts, beside the presence and the memory it already states.
 *
 * Unknown is never zero: a figure the daemon could not measure is `null` on the wire, and here it
 * reads "unknown" or is left out, never as an empty bar. A GPU list is left out when the probe
 * could not run (`null`) and says "none" when it ran and found none (`[]`). A phone is not measured
 * at all (it runs no daemon), so it has no rows; a computer with no vitals says why in one row:
 * none yet, or none lately when it has not answered.
 *
 * {@link Meter} is the small bar both this file and the Brain level's sleep gauge draw (`sleep.tsx`):
 * a `role="meter"` with its figure in words beside it, so the hue is never the only carrier.
 */
import type { CSSProperties, ReactNode } from "react";

import { Fact } from "@/components/Facts";
import type { Presence } from "@/lib/fleet";
import { whenAgo } from "@/lib/time";
import type { GpuVitals, Room, RunsSummary, SleepSummary, Vitals } from "@/lib/vitals";

/** The gate's word for a computer's room, as a node's caption says it. */
export const ROOM_WORD: Readonly<Record<Room, string>> = { ok: "room ok", tight: "tight", full: "full" };

/** The hold lines the gate uses (`athena/vitals/gate.py`): a bar past one is drawn in the warning hue. */
const RAM_ROOM_PCT = 85;
const CPU_HOLD_PCT = 90;

/** The room word for a caption, or `null` when the room is unknown or nothing was measured. */
export function roomWord(vitals: Vitals | null | undefined): string | null {
  return vitals?.room ? ROOM_WORD[vitals.room] : null;
}

/** A caption with the room word after it, when there is one: "Online · room ok". */
export function withRoom(caption: string, vitals: Vitals | null | undefined): string {
  const room = roomWord(vitals);
  return room ? `${caption} · ${room}` : caption;
}

/** The room as a screen reader says it, where a lone "tight" after a dot would be read as noise. */
const ROOM_SAID: Readonly<Record<Room, string>> = { ok: "room ok", tight: "room is tight", full: "no room" };

/** The same, for an accessible name or a sentence: "online, room is tight"; nothing when unknown. */
export function roomSaid(vitals: Vitals | null | undefined): string | null {
  return vitals?.room ? ROOM_SAID[vitals.room] : null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Megabytes as gigabytes a person reads: whole above 10, one decimal below. */
export function gbFigure(mb: number): string {
  const gb = mb / 1024;
  return gb >= 10 ? String(Math.round(gb)) : String(Math.round(gb * 10) / 10);
}

export const gb = (mb: number) => `${gbFigure(mb)} GB`;
const pct = (n: number) => `${Math.round(n)}%`;

/**
 * A small bar with its figure beside it. `value` is 0 to 1 (clamped, so a pressure past due fills
 * it); `null` draws no bar at all, only the words, because an empty bar would say zero.
 */
export function Meter({
  label,
  value,
  text,
  high = false,
  wide = false,
}: {
  /** What the bar measures, for a screen reader: "CPU", "RAM", "How close her next sleep is". */
  label: string;
  value: number | null;
  /** The figure in words, shown beside the bar and read as its value. */
  text: string;
  /** Past the line where the gate holds work: the bar takes the warning hue. */
  high?: boolean;
  wide?: boolean;
}) {
  if (value === null) return <span className="vmeter__text">{text}</span>;
  const fill = Math.min(1, Math.max(0, value));
  return (
    <span className={wide ? "vmeter vmeter--wide" : "vmeter"} data-high={high ? "1" : undefined}>
      <span
        className="vmeter__bar"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fill * 100)}
        aria-valuetext={text}
      >
        <span className="vmeter__fill" style={{ "--fill": fill } as CSSProperties} />
      </span>
      <span className="vmeter__text" aria-hidden="true">
        {text}
      </span>
    </span>
  );
}

/** One GPU in a line: its name, then whatever of its memory and load was measured. */
export function gpuWords(gpu: GpuVitals): string {
  const parts = [gpu.name];
  if (gpu.vram_total_mb !== null) {
    parts.push(gpu.vram_used_mb !== null ? `${gbFigure(gpu.vram_used_mb)} of ${gb(gpu.vram_total_mb)} VRAM` : `${gb(gpu.vram_total_mb)} VRAM`);
  }
  if (gpu.util_pct !== null) parts.push(`${pct(gpu.util_pct)} busy`);
  return parts.join(" · ");
}

export function powerWords(vitals: Pick<Vitals, "power" | "battery_pct">): string {
  if (vitals.power === "mains") return "On mains";
  if (vitals.power === "battery") return vitals.battery_pct !== null ? `On battery, ${vitals.battery_pct}%` : "On battery";
  return "unknown";
}

/** "14 turns, 2 blank", and how the blank and failed ones ended, the parts that are not zero. */
export function runsWords(runs: RunsSummary): { line: string; detail: string | null } {
  const detail = [
    runs.no_answer ? `${runs.no_answer} with no answer` : "",
    runs.timeout ? `${runs.timeout} timed out` : "",
    runs.usage_limit ? `${runs.usage_limit} hit the usage limit` : "",
    runs.tasks_empty ? `${plural(runs.tasks_empty, "task")} ended empty` : "",
    runs.failed ? `${runs.failed} failed` : "",
  ].filter(Boolean);
  return { line: `${plural(runs.turns, "turn")}, ${runs.blank} blank`, detail: detail.length ? detail.join(" · ") : null };
}

/** "slept 3 h ago", "sleeping now", "never slept"; and how near the next one is. */
export function sleepWords(sleep: SleepSummary, now: number): { line: string; detail: string | null } {
  const line =
    sleep.state === "sleeping"
      ? "sleeping now"
      : sleep.state === "failed"
        ? sleep.last_at
          ? `last sleep failed; slept ${whenAgo(sleep.last_at, now)}`
          : "last sleep failed"
        : sleep.last_at
          ? `slept ${whenAgo(sleep.last_at, now)}`
          : "never slept";
  if (sleep.state === "sleeping") return { line, detail: null };
  const detail = sleep.pressure >= 1 ? "enough waits for the next sleep" : `${pct(sleep.pressure * 100)} of the way to the next sleep`;
  return { line, detail };
}

/** A fact's value with a quieter second line under it. */
function Two({ line, detail }: { line: ReactNode; detail: string | null }) {
  return (
    <>
      {line}
      {detail ? <span className="vitals__sub typo-caption">{detail}</span> : null}
    </>
  );
}

/**
 * The facts of a computer's room, to sit inside the drawer's `Facts`. `presence` is the peer's, to
 * tell "not heard lately" (asleep, out of reach) from "none yet" (online, or not checked); this
 * computer passes `"online"`, since it is the one measuring.
 */
export function VitalsFacts({ vitals, presence, now }: { vitals: Vitals | null | undefined; presence: Presence | null; now: number }) {
  if (!vitals) {
    const quiet = presence === "asleep" || presence === "unreachable";
    return <Fact label="Vitals">{quiet ? "Not heard lately" : "No vitals yet"}</Fact>;
  }
  const v = vitals;
  const room = v.room ? ROOM_WORD[v.room] : "room unknown";
  const ramText =
    v.ram_pct === null ? "RAM unknown" : `RAM ${pct(v.ram_pct)}${v.ram_total_mb !== null ? ` of ${gb(v.ram_total_mb)}` : ""}`;
  return (
    <>
      <Fact label="Room">
        <Two line={room} detail={plural(v.slots, "task slot")} />
      </Fact>
      <Fact label="Load">
        <span className="vitals__load">
          <Meter
            label="CPU"
            value={v.cpu_pct === null ? null : v.cpu_pct / 100}
            text={v.cpu_pct === null ? "CPU unknown" : `CPU ${pct(v.cpu_pct)}`}
            high={v.cpu_pct !== null && v.cpu_pct >= CPU_HOLD_PCT}
          />
          <Meter
            label="RAM"
            value={v.ram_pct === null ? null : v.ram_pct / 100}
            text={ramText}
            high={v.ram_pct !== null && v.ram_pct >= RAM_ROOM_PCT}
          />
        </span>
      </Fact>
      {v.gpus === null ? null : (
        <Fact label={v.gpus.length > 1 ? "GPUs" : "GPU"}>
          {v.gpus.length === 0
            ? "none"
            : v.gpus.map((gpu, i) => (
                <span key={i} className="vitals__line">
                  {gpuWords(gpu)}
                </span>
              ))}
        </Fact>
      )}
      <Fact label="Power">{powerWords(v)}</Fact>
      <Fact label="Disk">{v.disk_free_mb === null ? "unknown" : `${gb(v.disk_free_mb)} free`}</Fact>
      <Fact label="Runs, last 24 h">{v.runs === null ? "unknown" : <Two {...runsWords(v.runs)} />}</Fact>
      <Fact label="Sleep">{v.sleep === null ? "unknown" : <Two {...sleepWords(v.sleep, now)} />}</Fact>
    </>
  );
}

/** The gate's reason background work waits on that computer, in its own words; nothing when none. */
export function HeldLine({ vitals }: { vitals: Vitals | null | undefined }) {
  if (!vitals?.held) return null;
  return <p className="vitals__held typo-body">{vitals.held}</p>;
}
