/**
 * The Mind depth's fixtures — README section 3.5. The Setup module's own view-models, named for the
 * depth, with nothing re-derived: what the module would say is what this says.
 */
import type { Path } from "@/depth/model";
import { fixtures as setup } from "@/modules/setup/fixtures";
import type { SetupModel } from "@/modules/setup/model";
import type { FixtureId } from "@/modules/types";
import type { DevicesView } from "@/lib/fleet";
import { EMPTY_DEVICES } from "@/stores/devices";

import type { DevicesModel } from "./devices";

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
        },
      ],
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
        },
      ],
    },
  ),
};
