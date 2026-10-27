/**
 * The Mind depth's fixtures — README section 3.5. The Setup module's own view-models, named for the
 * depth, with nothing re-derived: what the module would say is what this says.
 */
import type { Path } from "@/depth/model";
import { fixtures as setup } from "@/modules/setup/fixtures";
import type { SetupModel } from "@/modules/setup/model";
import type { FixtureId } from "@/modules/types";
import type { DevicesView } from "@/lib/fleet";
import type { CycleView, ProposalView, SleepView } from "@/lib/sleep";
import type { Vitals } from "@/lib/vitals";
import { EMPTY_DEVICES } from "@/stores/devices";
import { EMPTY_SLEEP } from "@/stores/sleep";

import type { DevicesModel } from "./devices";
import type { SleepModel } from "./sleep";

export const fixtures: Record<string, SetupModel> = {
  empty: setup.empty!,
  typical: setup.typical!,
  heavy: setup.heavy!,
  degraded: setup.degraded!,
  "engine-missing": setup.notFound!,
  checking: setup.checking!,
  calm: { ...setup.typical!, motion: "calm" },
};

export const fixtureIds: readonly FixtureId[] = Object.keys(fixtures);

/** The place each story is about. */
export const PATHS: Record<string, Path> = {
  field: { root: "mind" },
  engine: { root: "mind", item: "engine" },
  brain: { root: "mind", item: "brain" },
  look: { root: "mind", item: "look" },
  data: { root: "mind", item: "data" },
  mic: { root: "mind", item: "mic" },
  devices: { root: "mind", item: "devices" },
  missing: { root: "mind", item: "nowhere" },
};

// -- the Devices level (ADR 0140) -------------------------------------------------------------

/** A fixed clock for the fixtures, so "last seen" and the arm delay read the same every render. */
export const DEVICES_NOW = Date.parse("2026-10-24T12:00:00Z");

const noop = async () => {};
const actions: DevicesModel["actions"] = {
  load: noop,
  rename: noop,
  setBeacon: noop,
  openPairing: noop,
  join: noop,
  toggleGrant: () => {},
  answer: noop,
  revoke: noop,
  send: noop,
};

// -- a computer's room (device-vitals, ADR 0143) ----------------------------------------------

/** This computer, measured, with room: one GPU, on mains, three slots, slept five hours ago. */
export const VITALS_OK: Vitals = {
  at: "2026-10-24T11:59:55Z",
  cpu_pct: 12,
  cores: 16,
  ram_total_mb: 65_536,
  ram_free_mb: 38_666,
  ram_pct: 41,
  gpus: [{ name: "RTX 4090", util_pct: 30, vram_total_mb: 24_576, vram_used_mb: 1536 }],
  power: "mains",
  battery_pct: null,
  disk_free_mb: 412_000,
  room: "ok",
  slots: 3,
  held: null,
  runs: { hours: 24, turns: 14, blank: 2, no_answer: 1, failed: 1, timeout: 1, usage_limit: 0, tasks_empty: 0 },
  sleep: { state: "idle", last_at: "2026-10-24T07:00:00Z", pressure: 0.78 },
};

/** A laptop with little room: one slot, the RAM high, no GPU found, on battery, never slept. */
export const VITALS_TIGHT: Vitals = {
  ...VITALS_OK,
  cpu_pct: 64,
  cores: 8,
  ram_total_mb: 16_384,
  ram_free_mb: 2700,
  ram_pct: 86,
  gpus: [],
  power: "battery",
  battery_pct: 64,
  disk_free_mb: 8200,
  room: "tight",
  slots: 1,
  runs: { hours: 24, turns: 3, blank: 0, no_answer: 0, failed: 0, timeout: 0, usage_limit: 0, tasks_empty: 0 },
  sleep: { state: "never", last_at: null, pressure: 0.12 },
};

/** A computer the gate holds: RAM over the line, and every figure it could not read left unknown. */
export const VITALS_HELD: Vitals = {
  at: "2026-10-24T11:59:55Z",
  cpu_pct: null,
  cores: null,
  ram_total_mb: 32_768,
  ram_free_mb: 1900,
  ram_pct: 94,
  gpus: null,
  power: null,
  battery_pct: null,
  disk_free_mb: null,
  room: "full",
  slots: 0,
  held: "Waiting for room: memory is 94% used; tasks start again under 85%.",
  runs: null,
  sleep: { state: "sleeping", last_at: "2026-10-23T22:00:00Z", pressure: 1.1 },
};

const view: DevicesView = {
  ok: true,
  self: { device_id: "dev_0000000000a1", name: "Study PC" },
  peers: [],
  pending: [],
  beacon: { on: false, url: null },
  overlay: { state: "up" },
  listener: { up: false, address: null, port: 17491, error: null },
  joining: [],
};

function devicesModel(over: Partial<DevicesModel["state"]> = {}, viewOver: Partial<DevicesView> = {}): DevicesModel {
  return {
    state: {
      ...EMPTY_DEVICES,
      loaded: true,
      view: { ...view, ...viewOver },
      ...over,
    },
    now: DEVICES_NOW,
    setup: null,
    actions,
  };
}

const LISTENING: DevicesView["listener"] = { up: true, address: "100.64.0.7", port: 17491, error: null };

/** A phone's pairing window, opened at 11:58 and good until 12:03: three minutes left at {@link DEVICES_NOW}. */
const PHONE_WINDOW = {
  ok: true,
  pairing_id: "pair_0000000000c1",
  code: "7Q4K2P",
  url: "http://100.64.0.7:17491/m/#claim=pair_0000000000c1.abc",
  expires_at: "2026-10-24T12:03:00Z",
};

const PENDING: DevicesView["pending"] = [
  {
    pairing_id: "pair_0000000000b1",
    name: "Kitchen phone",
    kind: "phone",
    requested_grants: ["chat", "approve"],
    expires_at: "2026-10-24T12:05:00Z",
    pair_back: false,
  },
];

export const deviceFixtures: Record<string, DevicesModel> = {
  loading: { ...devicesModel(), state: { ...EMPTY_DEVICES } },
  unreadable: { ...devicesModel(), state: { ...EMPTY_DEVICES, problem: "the daemon did not answer" } },
  empty: devicesModel({}, { overlay: { state: "absent" } }),
  "signed-out": devicesModel({}, { overlay: { state: "logged_out" } }),
  "beacon-on": devicesModel(
    {
      opened: {
        phone: {
          ok: true,
          pairing_id: "pair_0000000000c1",
          code: "7Q4-K2P",
          url: "http://100.64.0.7:17491/m/#claim=pair_0000000000c1.abc",
          expires_at: "2026-10-24T12:05:00Z",
        },
      },
    },
    {
      beacon: { on: true, url: "http://100.64.0.7:17491/m/" },
      listener: { up: true, address: "100.64.0.7", port: 17491, error: null },
    },
  ),
  "pending-new": devicesModel({ seenAt: { pair_0000000000b1: DEVICES_NOW - 200 } }, { pending: PENDING }),
  "pending-armed": devicesModel({ seenAt: { pair_0000000000b1: DEVICES_NOW - 5000 } }, { pending: PENDING }),
  typical: devicesModel(
    {
      conversations: {
        dev_0000000000a2: {
          requestId: "job_0000000000d1",
          phase: "done",
          lines: [
            { kind: "you", text: "what is due this week?" },
            { kind: "athena", text: "Two invoices are due on Friday." },
          ],
          dropped: 0,
          problem: null,
        },
      },
    },
    {
      peers: [
        {
          peer_id: "dev_0000000000a2",
          name: "Laptop",
          kind: "pc",
          grants: ["chat", "approve", "memory"],
          created: "2026-10-20T09:00:00Z",
          expires: null,
          last_seen: "2026-10-24T11:58:00Z",
          memory: { last_pull_at: "2026-10-24T11:59:00Z", pulled: 42, conflicts: 0, deferred: 0, state: "ok" },
          presence: "online",
          presence_at: "2026-10-24T11:59:30Z",
          vitals: VITALS_TIGHT,
        },
        {
          peer_id: "dev_0000000000a3",
          name: "Kitchen phone",
          kind: "phone",
          grants: ["chat", "approve"],
          created: "2026-10-21T09:00:00Z",
          expires: null,
          last_seen: null,
          memory: null,
          presence: null,
          presence_at: null,
          vitals: null,
        },
        {
          peer_id: "dev_0000000000a4",
          name: "Studio PC",
          kind: "pc",
          grants: ["chat", "memory"],
          created: "2026-10-22T09:00:00Z",
          expires: null,
          last_seen: "2026-10-24T10:00:00Z",
          memory: { last_pull_at: "2026-10-24T09:58:00Z", pulled: 7, conflicts: 0, deferred: 0, state: "ok" },
          presence: "asleep",
          presence_at: "2026-10-24T11:59:30Z",
          vitals: null,
        },
        {
          peer_id: "dev_0000000000a5",
          name: "Attic tower",
          kind: "pc",
          grants: ["chat"],
          created: "2026-10-23T09:00:00Z",
          expires: null,
          last_seen: "2026-10-22T08:00:00Z",
          memory: null,
          presence: "unreachable",
          presence_at: "2026-10-24T11:59:30Z",
        },
      ],
      self: { ...view.self, vitals: VITALS_OK },
      listener: { up: true, address: "100.64.0.7", port: 17491, error: null },
      joining: [{ join_id: "pair_0000000000e1", address: "100.64.0.9:17491", name: "Office PC", state: "pending", expires_at: "2026-10-24T12:10:00Z" }],
    },
  ),
  "peer-offline": devicesModel(
    {
      conversations: {
        dev_0000000000a2: {
          requestId: null,
          phase: "error",
          lines: [{ kind: "you", text: "hello" }],
          dropped: 0,
          problem: "Athena on Laptop is asleep. Open it there and try again.",
        },
      },
    },
    {
      peers: [
        {
          peer_id: "dev_0000000000a2",
          name: "Laptop",
          kind: "pc",
          grants: ["chat"],
          created: "2026-10-20T09:00:00Z",
          expires: "2026-11-20T09:00:00Z",
          last_seen: "2026-10-22T08:00:00Z",
          presence: "asleep",
          presence_at: "2026-10-24T11:59:30Z",
        },
      ],
    },
  ),
  /** Four computers with no presence verdict to read, and the link state that says why (ADR 0140). */
  links: devicesModel(
    {},
    {
      peers: (
        [
          ["a6", "Old desk", { state: "removed_there", since: "2026-10-24T10:00:00Z" }, null],
          ["a7", "New laptop", { state: "awaiting_key", since: "2026-10-24T11:30:00Z" }, null],
          ["a8", "Back office", { state: "stale", since: "2026-10-24T11:50:00Z" }, "online"],
          ["a9", "Garage PC", { state: null, since: null }, null],
        ] as const
      ).map(([id, name, link, presence]) => ({
        peer_id: `dev_0000000000${id}`,
        name,
        kind: "pc" as const,
        grants: ["chat" as const],
        created: "2026-10-23T09:00:00Z",
        expires: null,
        last_seen: "2026-10-24T09:00:00Z",
        memory: null,
        presence,
        presence_at: null,
        vitals: null,
        link: { ...link, evidence: {} },
      })),
    },
  ),
  /** The phone wizard's Scan step: a window this person opened, two minutes into its five. */
  "pairing-phone": devicesModel({ opened: { phone: PHONE_WINDOW } }, { listener: LISTENING }),
  /** The same window, run out. */
  "pairing-expired": devicesModel(
    { opened: { phone: { ...PHONE_WINDOW, expires_at: "2026-10-24T11:59:00Z" } } },
    { listener: LISTENING },
  ),
  /** The phone scanned it: the request for that window waits, so the wizard is on Approve. */
  "pairing-requested": devicesModel(
    { opened: { phone: PHONE_WINDOW }, seenAt: { [PHONE_WINDOW.pairing_id]: DEVICES_NOW - 5000 } },
    {
      listener: LISTENING,
      pending: [
        {
          pairing_id: PHONE_WINDOW.pairing_id,
          name: "Kitchen phone",
          kind: "phone",
          requested_grants: ["chat", "approve"],
          expires_at: PHONE_WINDOW.expires_at,
          pair_back: false,
        },
      ],
    },
  ),
  /** A computer's code, shown here for the other computer to type. */
  "pairing-pc": devicesModel(
    { opened: { pc: { ok: true, pairing_id: "pair_0000000000c2", code: "M7KQ2X", url: null, expires_at: "2026-10-24T12:04:00Z" } } },
    { listener: LISTENING },
  ),
  /** The gate holds this computer, and a paired one answered but has sent no vitals yet. */
  "vitals-held": devicesModel(
    {},
    {
      self: { ...view.self, vitals: VITALS_HELD },
      peers: [
        {
          peer_id: "dev_0000000000a2",
          name: "Laptop",
          kind: "pc",
          grants: ["chat"],
          created: "2026-10-20T09:00:00Z",
          expires: null,
          last_seen: "2026-10-24T11:59:00Z",
          presence: "online",
          presence_at: "2026-10-24T11:59:30Z",
          vitals: null,
        },
      ],
    },
  ),
};

// -- her sleep, on the Brain level (ADR 0143) -------------------------------------------------

const sleepActions: SleepModel["actions"] = { load: noop, readJournal: noop, sleepNow: noop, stage: () => {}, stageAll: () => {}, undo: () => {} };

const STATS = {
  episodes_in: 12,
  episodes_available: 12,
  chars_in: 28_400,
  truncated: false,
  facts_written: 4,
  facts_dropped: 0,
  procedurals_written: 1,
  procedurals_dropped: 0,
  duplicates: 2,
  supersedes: 1,
  contradictions: 1,
  faded: 0,
  forget_proposed: 1,
};

const CYCLE_DONE: CycleView = {
  id: "cyc_00000000c001",
  started_at: "2026-10-24T06:58:00Z",
  finished_at: "2026-10-24T07:00:00Z",
  status: "completed",
  reason: "pressure",
  stats: STATS,
};

const CYCLE_PARTIAL: CycleView = {
  id: "cyc_00000000c002",
  started_at: "2026-10-24T10:40:00Z",
  finished_at: "2026-10-24T10:44:00Z",
  status: "partial",
  reason: "forced",
  stats: { ...STATS, episodes_in: 120, episodes_available: 310, truncated: true, contradictions: 0, forget_proposed: 0 },
};

const CYCLE_FAILED: CycleView = {
  id: "cyc_00000000c003",
  started_at: "2026-10-24T11:20:00Z",
  finished_at: "2026-10-24T11:25:00Z",
  status: "failed",
  reason: "the merge step timed out after 300 s",
  stats: null,
};

const CYCLE_RUNNING: CycleView = {
  id: "cyc_00000000c004",
  started_at: "2026-10-24T11:58:00Z",
  finished_at: null,
  status: "running",
  reason: "pressure",
  stats: { episodes_in: 14, chars_in: 41_200 },
};

const PROPOSALS: ProposalView[] = [
  {
    id: "prp_00000000d001",
    cycle_id: CYCLE_DONE.id,
    kind: "contradiction",
    node_ids: ["fct_00000000e001", "fct_00000000e002"],
    summary: "One says the invoices go out on Fridays; a newer one says Mondays.",
    status: "open",
    created_at: "2026-10-24T07:00:00Z",
  },
  {
    id: "prp_00000000d002",
    cycle_id: CYCLE_DONE.id,
    kind: "forget",
    node_ids: ["fct_00000000e003"],
    summary: "The old office's Wi-Fi name: not recalled in 34 days.",
    status: "open",
    created_at: "2026-10-24T07:00:00Z",
  },
  {
    id: "prp_00000000d003",
    cycle_id: CYCLE_DONE.id,
    kind: "forget",
    node_ids: ["fct_00000000e004"],
    summary: "A proposal already kept, which is shown nowhere.",
    status: "kept",
    created_at: "2026-10-24T07:00:00Z",
  },
];

const SLEEP_IDLE: SleepView = {
  state: "idle",
  phase: null,
  pressure_chars: 31_000,
  threshold_chars: 40_000,
  episodes_waiting: 9,
  verdict: { admit: false, reason: "not_yet", text: "Not yet: 31,000 of the 40,000 characters she sleeps on have piled up." },
  last: CYCLE_DONE,
  open_proposals: 2,
};

function sleepModel(over: Partial<SleepModel["state"]> = {}): SleepModel {
  return {
    state: { ...EMPTY_SLEEP, loaded: true, view: SLEEP_IDLE, cycles: [CYCLE_DONE], proposals: PROPOSALS, ...over },
    now: DEVICES_NOW,
    actions: sleepActions,
  };
}

const JOURNAL = [
  "# Sleep, 24 Oct 06:58",
  "",
  "Read 12 episodes (28,400 characters).",
  "",
  "- wrote: the invoices go out on Mondays",
  "- confirmed fct_00000000e007",
].join("\n");

/** The Sleep section's states, by name; `opening` in the tests opens a journal or a choice. */
export const sleepFixtures: Record<string, SleepModel> = {
  loading: { ...sleepModel(), state: { ...EMPTY_SLEEP } },
  unreadable: { ...sleepModel(), state: { ...EMPTY_SLEEP, problem: "Could not read her sleep: the daemon did not answer" } },
  /** An older daemon: no `/sleep`, so no section. */
  missing: { ...sleepModel(), state: { ...EMPTY_SLEEP, loaded: true, missing: true } },
  never: sleepModel({
    view: {
      ...SLEEP_IDLE,
      state: "never",
      pressure_chars: 1200,
      episodes_waiting: 2,
      verdict: { admit: false, reason: "too_little", text: "Too little to sleep on yet: 1,200 characters, and she needs 2,000." },
      last: null,
      open_proposals: 0,
    },
    cycles: [],
    proposals: [],
  }),
  typical: sleepModel({ journals: { [CYCLE_DONE.id]: { status: "completed", loading: false, text: JOURNAL, problem: null } } }),
  sleeping: sleepModel({
    view: {
      ...SLEEP_IDLE,
      state: "sleeping",
      phase: "merge",
      pressure_chars: 0,
      episodes_waiting: 0,
      verdict: { admit: false, reason: "sleeping", text: "She is asleep now." },
      last: CYCLE_RUNNING,
    },
    cycles: [CYCLE_RUNNING, CYCLE_DONE],
    journals: { [CYCLE_RUNNING.id]: { status: "running", loading: false, text: null, problem: null } },
  }),
  failed: sleepModel({
    view: {
      ...SLEEP_IDLE,
      state: "failed",
      verdict: { admit: false, reason: "failed_recently", text: "Her last sleep failed less than an hour ago; she tries again after that." },
      last: CYCLE_FAILED,
    },
    cycles: [CYCLE_FAILED, CYCLE_DONE],
    journals: { [CYCLE_FAILED.id]: { status: "failed", loading: false, text: null, problem: null } },
  }),
  partial: sleepModel({
    view: { ...SLEEP_IDLE, last: CYCLE_PARTIAL, pressure_chars: 52_000, episodes_waiting: 190 },
    cycles: [CYCLE_PARTIAL, CYCLE_DONE],
    journals: { [CYCLE_PARTIAL.id]: { status: "partial", loading: false, text: null, problem: "Could not read the journal: not found" } },
  }),
  /** "Sleep now" refused, in the daemon's words; and a later read that failed over what is shown. */
  refused: sleepModel({
    answer: { admitted: false, reason: "no_room", text: "Waiting for room: RAM is at 93% (resumes below 85%).", cycle_id: null },
    answeredAfter: CYCLE_DONE.id,
    problem: "Could not read her sleep: the daemon did not answer",
  }),
};
