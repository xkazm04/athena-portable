/**
 * The Origins module's surface — a pure function of `OriginsModel`.
 *
 * The table leads and one origin opens in a rail beside it. That shape is the argument: the
 * question this page answers is a comparison — *which of these have I trusted, which have I ruled
 * on, when was I last there* — and a comparison is a table. The rail is where a single origin's
 * rulings and the two acts that undo them live, because those are about one row and would cost
 * every other row a fold if they were inline.
 *
 * Two states this surface owes different answers to, and never the same one: the table has no
 * rows yet (`EmptyState` — open a page and it takes a row), and the table could not be read
 * (`ProblemNote`, the store's reason verbatim). Rendering a failed read as an empty list is how a
 * broken surface looks fine.
 */
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import ProblemNote from "@/components/ProblemNote";
import SectionCard from "@/components/SectionCard";

import OriginDetail from "./local/OriginDetail";
import OriginTable from "./local/OriginTable";
import type { OriginsModel } from "./model";

export default function OriginsView({ model }: { model: OriginsModel }) {
  const { actions, origins, problem, selected } = model;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Origins"
        title="What Athena may touch"
        caption="Every page she has been on, and your ruling on each."
        meta={
          <>
            <Badge tone={problem ? "error" : origins.length ? "info" : "neutral"}>
              {problem ? "unread" : `${model.trusted} of ${origins.length} trusted`}
            </Badge>
          </>
        }
      />

      {problem ? (
        <ProblemNote
          title="The origins table could not be read, so nothing here can be shown or changed."
          reason={problem}
          detail="The shell owns the store; until it answers, no ruling on this page would be saved."
        />
      ) : origins.length === 0 ? (
        <SectionCard>
          <EmptyState
            glyph="·"
            title={model.loaded ? "No origin seen yet" : "Reading the table…"}
            line={
              model.loaded
                ? "Open a page in the Browser module and it takes a row here."
                : "The shell has not answered store_list yet."
            }
          />
        </SectionCard>
      ) : (
        <div className="split">
          {/* `padded={false}`: the table owns its own edges and its own sideways scroll. */}
          <SectionCard padded={false}>
            <OriginTable origins={origins} selected={selected?.origin ?? null} actions={actions} />
          </SectionCard>

          <aside className="stack origins__rail" style={{ gap: "var(--density-gap)" }}>
            {selected ? (
              <OriginDetail detail={selected} actions={actions} />
            ) : (
              <SectionCard>
                <EmptyState
                  glyph="·"
                  title="Pick a row"
                  line="Its per-tool rulings and Forget open here."
                />
              </SectionCard>
            )}
          </aside>
        </div>
      )}
    </PageShell>
  );
}
