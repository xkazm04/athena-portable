/**
 * The Panel's right rail: what the focused page can be asked to do, and what the gate will do
 * about each of it — README section 3.4 (three tiers, one gate) and 3.3.
 *
 * A hairline list rather than a `Table`, which is a measurement rather than a preference: a name,
 * a tier, a class and a transport as four columns in a 22rem rail leaves the tool name about six
 * characters. The Origins module has the whole page and uses the table.
 *
 * Three states this rail owes an answer to, and they are three different facts:
 *
 * - **The daemon is not answering.** Nothing can be proposed at all, so the reason and the one
 *   act that addresses it come first, above the list — `ProblemNote`, never an empty list.
 * - **The page has no bridge.** That is the ordinary case for every site that never heard of
 *   WebMCP (ADR 0008), not a failure: an `EmptyState` saying what does operate such a page.
 * - **Nobody has asked yet.** An empty list before the first `bridge_list` answers is not "no
 *   tools"; it is a question in flight.
 *
 * Local to this module: it renders `PanelModel`'s own tool rows and nothing else could want it.
 */
import { useState } from "react";

import Badge from "@/components/Badge";
import ClassPill, { ClassPicker } from "@/components/ClassPill";
import EmptyState from "@/components/EmptyState";
import ProblemNote from "@/components/ProblemNote";
import SectionCard from "@/components/SectionCard";
import { CLASS_WORD } from "@/lib/classes";

import type { PanelModel, PanelTool } from "../model";

export default function ToolList({ model }: { model: PanelModel }) {
  const [open, setOpen] = useState<string | null>(null);
  const { bridge, tools, trust } = model;
  const firstSights = tools.filter((t) => t.firstSight).length;

  return (
    <>
      {model.daemonReady ? null : (
        <ProblemNote
          title="Athena is offline, so nothing on this page can be proposed."
          reason={model.daemonProblem ?? "daemon_offline"}
          detail="The shell owns the daemon process. Until it answers, nothing here can be asked for."
          onRetry={model.actions.reconnect}
          retryLabel="Reconnect"
        />
      )}

      <SectionCard
        title="What this page can do"
        note={tools.length ? `${tools.length} tools` : undefined}
        padded={tools.length === 0}
      >
        {!model.page ? (
          <EmptyState
            glyph="+"
            title="No page open"
            line="Open a tab in the Browser module and its tools take this rail."
          />
        ) : bridge?.asking && tools.length === 0 ? (
          <p className="typo-caption">Asking the page what it has registered…</p>
        ) : tools.length === 0 ? (
          <EmptyState
            glyph="·"
            title="No bridge on this page"
            line="Nothing was registered here, so Athena operates it with the generic hands."
          />
        ) : (
          <>
            <ul className="tool-list">
              {tools.map((tool) => (
                <Row
                  key={`${tool.tier}:${tool.name}`}
                  tool={tool}
                  origin={trust?.origin ?? ""}
                  open={open === tool.name}
                  onToggle={() => setOpen(open === tool.name ? null : tool.name)}
                  onOverride={(cls) =>
                    trust && model.actions.setOverride(trust.origin, tool.name, cls)
                  }
                />
              ))}
            </ul>
            {firstSights > 0 ? (
              // The whole of act 1 is this sentence, so it is said once under the list rather
              // than nine times inside it.
              <p className="typo-caption">
                {firstSights} of these are <code className="typo-code">GATED</code> because this
                origin has not been seen before.
              </p>
            ) : null}
          </>
        )}
      </SectionCard>
    </>
  );
}

/** The tier a tool came from, in the words README section 3.4 uses for its three rows. */
const TIER_WORD: Record<1 | 2 | 3, string> = {
  1: "page",
  2: "hand",
  3: "connector",
};

function Row({
  tool,
  origin,
  open,
  onToggle,
  onOverride,
}: {
  tool: PanelTool;
  origin: string;
  open: boolean;
  onToggle: () => void;
  onOverride: (cls: PanelTool["overrideCls"]) => void;
}) {
  return (
    <li className={tool.firstSight ? "tool-row tool-row--first-sight" : "tool-row"}>
      <span className="row" style={{ gap: 6 }}>
        <code className="typo-code">{tool.name}</code>
        <Badge tone="neutral" title={`Tier ${tool.tier}`}>
          {TIER_WORD[tool.tier]}
        </Badge>
        <span style={{ marginLeft: "auto" }}>
          <ClassPill
            cls={tool.effectiveCls}
            overridden={tool.overridden}
            expanded={open}
            onClick={origin ? onToggle : undefined}
          />
        </span>
      </span>
      {/* The page's own words about its own tool. Text, never markup (untrusted fences). */}
      <p className="typo-caption">{tool.description}</p>
      <p className="typo-caption">
        {CLASS_WORD[tool.effectiveCls]} · {tool.transport}
        {tool.firstSight ? " · first sight" : ""}
      </p>
      {open ? (
        <ClassPicker
          tool={tool.name}
          declared={tool.declaredCls}
          value={tool.overrideCls}
          allowed={tool.allowed}
          lockedReason={tool.lockedReason}
          onChange={onOverride}
        />
      ) : null}
    </li>
  );
}
