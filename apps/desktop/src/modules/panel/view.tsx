/**
 * The Panel module's surface — a pure function of `PanelModel`.
 *
 * This is the home module, and what it is *about* is one sentence: **you and Athena, on the page
 * in front of you, with the gate between you.** So the page is two columns — the conversation,
 * which is the act, and the page's own capabilities, which are the reference — and the gate
 * appears in both: as the class on every tool in the rail, and as the card the turn stops on.
 *
 * Three decisions this layout makes, and the arguments for them:
 *
 * - **The conversation leads and the rail is 22rem.** The first build put seven surfaces in a
 *   380px column and the column became the ceiling (README section 3.5). Given the whole window
 *   the right answer is not seven columns; it is one wide thing and one narrow one, and the wide
 *   one is the thing the user is doing.
 * - **`PageShell fill`, and the two columns scroll independently.** This is the one module whose
 *   body is a viewport-height workspace and the documented exception the `fill` prop exists for.
 *   Below 60rem the columns stack, the rail stops scrolling on its own and only the transcript
 *   keeps its own scroller — which is the shape the preview harness is checked in at 700px.
 * - **The header renders outside every conditional.** Offline, no page, no bridge and a turn in
 *   flight are states of the *body*; a frame that disappears when the daemon dies reads as a
 *   crash rather than as a daemon that died.
 */
import Badge from "@/components/Badge";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";

import ChatPane from "./local/ChatPane";
import ToolList from "./local/ToolList";
import type { PanelModel } from "./model";

/** The word the badge carries for each state of the run loop. Never a paraphrase of a reason. */
const STATUS_WORD = {
  idle: "ready",
  streaming: "working",
  awaiting_decision: "waiting on you",
  error: "failed",
} as const;

const STATUS_TONE = {
  idle: "success",
  streaming: "info",
  awaiting_decision: "warning",
  error: "error",
} as const;

export default function PanelView({ model }: { model: PanelModel }) {
  const { bridge, page, trust } = model;

  return (
    <PageShell fill>
      <PageHeader
        eyebrow="Panel"
        title={page ? page.host : "No page open"}
        caption="Ask for something on this page; the gate stops what has to be answered."
        meta={
          <>
            <Badge tone={model.daemonReady ? STATUS_TONE[model.status] : "error"}>
              {model.daemonReady ? STATUS_WORD[model.status] : "offline"}
            </Badge>
            {trust ? (
              <Badge tone={trust.enabled ? "success" : "warning"} title={trust.origin}>
                {trust.enabled ? "trusted" : trust.known ? "not trusted" : "first sight"}
              </Badge>
            ) : null}
            {page ? (
              <Badge
                tone={bridge?.transport ? "info" : "neutral"}
                title={bridge?.problem ?? page.url}
              >
                {bridge?.asking
                  ? "listing"
                  : (bridge?.transport ?? "no bridge")}
              </Badge>
            ) : null}
          </>
        }
      />

      <div className="panel">
        <ChatPane model={model} />
        <aside className="panel__rail" aria-label="What this page can do">
          <ToolList model={model} />
        </aside>
      </div>
    </PageShell>
  );
}
