/**
 * The Devices level under Mind — ADR 0140 ("Pairing + Devices page", UX/UI spec), ADR 0139 words,
 * fleet-surfaces WP3 (design decision D1).
 *
 * Every device is a full Athena; this is where one meets the others. Two layers on one stage:
 *
 * 1. The constellation (`constellation.tsx`): this computer at the centre, the paired devices on
 *    an orbit around it with their presence, the requests waiting here as pulsing nodes, and two
 *    '+' nodes. A node opens its details in a drawer under the stage.
 * 2. The pairing wizard (`wizard.tsx`): it grows out of the '+' node that was pressed, the
 *    constellation dims behind it, and Back or Escape folds it back into that node.
 *
 * Under both, "Set up with Athena": the setup conversation in her window installs the private
 * network and finds the other computers, every step a card.
 *
 * A pure function of {@link DevicesModel} (the store's mirror of `GET /devices` plus `now`) and of
 * three facts of presentation kept here: which node is open, which wizard is open, and which
 * pairing windows this person already answered (a spent window is replaced, not shown again).
 * Nothing here decides a grant: the approve card's rules are the store's and `wizard.tsx`'s.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import Button from "@/components/Button";
import ProblemNote from "@/components/ProblemNote";
import type { DeviceKind } from "@/lib/fleet";
import { ARM_MS, type DevicesState } from "@/stores/devices";

import Constellation, { ADD_SPOT, DevicesList, Drawer, percentOf } from "./constellation";
import Wizard, { isLive, Refusal, type Answered, type PcBranch } from "./wizard";

export { ARM_MS };
export { GRANT_WORDS, joinPicks } from "./wizard";

/** What the level reads: the store's state, the clock, whether setup is wired, and the acts. */
export interface DevicesModel {
  state: Pick<
    DevicesState,
    "view" | "loaded" | "problem" | "busy" | "errors" | "opened" | "seenAt" | "unticked" | "conversations" | "overlay"
  >;
  now: number;
  /** The setup conversation (WP4) is wired: "Set up with Athena" opens it. */
  setup: (() => void) | null;
  actions: Pick<
    DevicesState,
    "load" | "rename" | "setBeacon" | "openPairing" | "join" | "toggleGrant" | "answer" | "revoke" | "send"
  >;
}

/** What a test or a preview opens the level on; a person always starts on the bare constellation. */
export interface DevicesOpening {
  selected?: string;
  wizard?: DeviceKind;
  branch?: PcBranch;
}

export default function DevicesLevel({ model, opening = {} }: { model: DevicesModel; opening?: DevicesOpening }) {
  const { state } = model;
  if (!state.loaded && state.problem) {
    return (
      <ProblemNote
        title="Athena could not read this computer's devices."
        reason={state.problem}
        onRetry={() => void model.actions.load()}
        retryLabel="Read again"
      />
    );
  }
  if (state.view === null) {
    return (
      <p className="typo-caption" role="status">
        Reading the devices…
      </p>
    );
  }
  return <Devices model={model} opening={opening} />;
}

function Devices({ model, opening }: { model: DevicesModel; opening: DevicesOpening }) {
  const { state } = model;
  const [selected, setSelected] = useState<string | null>(opening.selected ?? null);
  const [wizard, setWizard] = useState<DeviceKind | null>(opening.wizard ?? null);
  const [spent, setSpent] = useState<readonly string[]>([]);
  const adds = useRef<Record<DeviceKind, HTMLButtonElement | null>>({ phone: null, pc: null });
  const refocus = useRef<DeviceKind | null>(null);

  // The fold finished and the sky is live again: the focus goes back to the node it grew from.
  useEffect(() => {
    if (wizard !== null || refocus.current === null) return;
    adds.current[refocus.current]?.focus();
    refocus.current = null;
  }, [wizard]);

  const addRef = useCallback(
    (kind: DeviceKind) => (el: HTMLButtonElement | null) => {
      adds.current[kind] = el;
    },
    [],
  );

  const open = (kind: DeviceKind) => {
    setSelected(null);
    // A phone's window is opened on the press: the person came to scan. A computer's waits for
    // the choice of which side shows the code.
    if (kind === "phone" && !(isLive(state.opened.phone, Date.now(), spent) && state.opened.phone?.url)) {
      void model.actions.openPairing("phone");
    }
    setWizard(kind);
  };

  const closed = useCallback(() => {
    refocus.current = wizard;
    setWizard(null);
  }, [wizard]);

  const answered = useCallback((a: Answered) => setSpent((s) => (s.includes(a.pairingId) ? s : [...s, a.pairingId])), []);

  return (
    <>
      {state.problem ? (
        <ProblemNote
          title="What is drawn below may be out of date."
          reason={state.problem}
          onRetry={() => void model.actions.load()}
          retryLabel="Read again"
        />
      ) : null}
      <section className="devices" aria-label="Devices">
        <div className="devices__stage">
          <Constellation
            model={model}
            selected={selected}
            onSelect={setSelected}
            onAdd={open}
            dim={wizard !== null}
            addRef={addRef}
          />
          {wizard ? (
            <Wizard
              model={model}
              kind={wizard}
              origin={percentOf(ADD_SPOT[wizard])}
              spent={spent}
              onAnswered={answered}
              onClosed={closed}
              initialBranch={opening.branch ?? null}
            />
          ) : null}
        </div>
        <DevicesList model={model} />
        {selected !== null && wizard === null ? (
          <Drawer model={model} selected={selected} onClose={() => setSelected(null)} onAnswered={answered} />
        ) : null}
      </section>
      <section className="mind__section devices__setup" aria-labelledby="devices-setup">
        <h2 id="devices-setup">Set up with Athena</h2>
        <p className="typo-caption">
          Athena can install the private network, open the firewall and find your other computers, asking you before each
          step.
        </p>
        <Button
          size="sm"
          variant="secondary"
          disabledReason={model.setup ? undefined : "Coming next: the setup conversation is not in this build yet."}
          onClick={() => model.setup?.()}
        >
          Set up with Athena
        </Button>
        <p className="typo-caption">The conversation opens in Athena&apos;s own window. Every change she proposes waits for your approval there.</p>
        <Refusal text={model.state.errors.setup} />
      </section>
    </>
  );
}
