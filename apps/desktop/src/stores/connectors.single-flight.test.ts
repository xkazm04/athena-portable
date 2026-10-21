/**
 * One flow poll per connector: the daemon replaces an open flow with a newer one, so a second poll
 * takes the connector and the older one stops without reading or clearing the newer one's wait.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { DaemonApi, type ConnectorView } from "@/lib/api";

import { resetConnectorsForTests, setConnectorDeps, useConnectors, WAITING_WORD } from "./connectors";

function gmail(phase: "awaiting_consent" | "done"): ConnectorView {
  return {
    id: "gmail",
    label: "Gmail",
    description: "",
    auth: "oauth",
    guide: "",
    api_hosts: [],
    egress: "recipients",
    tools: [],
    connection: {
      id: "gmail",
      status: "disconnected",
      identity: "",
      connected_at: "",
      enabled: true,
      writes_enabled: false,
      allowlist: [],
      health: "unknown",
      health_at: "",
      health_detail: "",
      seal: "",
      expires_at: "",
      last_used_at: "",
    },
    live: false,
    seal_available: true,
    flow: {
      id: "f1",
      phase,
      detail: "",
      authorize_url: "",
    } as unknown as ConnectorView["flow"],
    records_notice: "",
  };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("pollFlow single-flight", () => {
  beforeEach(() => resetConnectorsForTests());

  it("stops the older poll when a newer one takes the connector", async () => {
    let reads = 0;
    let phase: "awaiting_consent" | "done" = "awaiting_consent";
    const gates: Array<() => void> = [];
    const fetchImpl = async (): Promise<Response> => {
      reads += 1;
      return new Response(JSON.stringify({ connector: gmail(phase), flow: gmail(phase).flow }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    setConnectorDeps({
      api: () => new DaemonApi({ url: "http://daemon", token: "t" }, fetchImpl),
      wait: () => new Promise<void>((resolve) => gates.push(resolve)),
    });

    const first = useConnectors.getState().pollFlow("gmail");
    await tick();
    expect(reads).toBe(1);

    const second = useConnectors.getState().pollFlow("gmail");
    await tick();
    expect(reads).toBe(2);

    // The older poll wakes: it ends without another read and leaves the newer wait standing.
    gates[0]();
    await first;
    expect(reads).toBe(2);
    expect(useConnectors.getState().busy.gmail).toBe(WAITING_WORD);

    phase = "done";
    gates[1]();
    await second;
    expect(reads).toBe(3);
    expect(useConnectors.getState().busy.gmail).toBeUndefined();
  });
});
