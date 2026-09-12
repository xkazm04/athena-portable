/**
 * One origin, opened: its facts, its per-tool rulings, and Forget.
 *
 * The rail is where the **tighten-only** rule is spent (README section 3.3, ADR 0018). Every row
 * offers the classes tighter than the one its manifest declared and nothing else, and where that
 * set is empty the row says why rather than showing a control with one position. Two reasons a
 * set can be empty and they are different facts: the tool is already `GATED`, which is as tight
 * as this app goes; or the page is not open, so nothing is known about how it declared the tool
 * and the stored ruling can only be cleared.
 *
 * **Forget is a row delete and asks once, in place** — `ConfirmInline`, never a modal: the row is
 * the context and a dialog over the table covers the evidence the user is deciding from.
 */
import Badge from "@/components/Badge";
import Button from "@/components/Button";
import ClassPill, { ClassPicker } from "@/components/ClassPill";
import ConfirmInline from "@/components/ConfirmInline";
import Facts, { Fact } from "@/components/Facts";
import SectionCard from "@/components/SectionCard";
import StatusDot from "@/components/StatusDot";

import Switch from "./Switch";
import type { OriginDetail as Detail, OriginsActions, OverrideLine } from "../model";

const TIER_WORD: Record<1 | 2 | 3, string> = { 1: "page", 2: "hand", 3: "connector" };

export default function OriginDetail({
  detail,
  actions,
}: {
  detail: Detail;
  actions: OriginsActions;
}) {
  const ruled = detail.overrides.filter((o) => o.overrideCls !== null).length;

  return (
    <>
      <SectionCard
        title={detail.host}
        note={detail.enabled ? "trusted" : "not trusted"}
        action={
          <Switch
            checked={detail.enabled}
            onChange={(next) => actions.setEnabled(detail.origin, next)}
            label={`Athena on ${detail.host}`}
          />
        }
      >
        <Facts>
          <Fact label="origin" value="code">
            {detail.origin}
          </Fact>
          <Fact label="first seen">{detail.firstSeen ?? "—"}</Fact>
          <Fact label="last seen">{detail.lastSeen ?? "—"}</Fact>
          <Fact label="tools" value="code">
            {detail.toolCount ?? "this page is not open"}
          </Fact>
          <Fact label="ruled" value="code">
            {ruled || "none"}
          </Fact>
        </Facts>
      </SectionCard>

      <SectionCard
        title="Per-tool rulings"
        note={detail.offline ? "the page is not open" : `${detail.overrides.length} tools`}
      >
        {detail.overrides.length === 0 ? (
          <p className="typo-caption">
            Nothing to rule on yet. A tool takes a row here once its page registers it.
          </p>
        ) : (
          <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0, gap: 4 }}>
            {detail.overrides.map((row) => (
              <Row
                key={row.tool}
                row={row}
                onChange={(cls) => actions.setOverride(detail.origin, row.tool, cls)}
              />
            ))}
          </ul>
        )}
        {/* Said once under the list rather than on every row it applies to (house style §2). */}
        <p className="typo-caption">
          A ruling can only tighten what the page declared, never loosen it.
        </p>
      </SectionCard>

      <div>
        {/* Keyed on the origin, so a confirm opened for one row is not still open on the next. */}
        <ConfirmInline
          key={detail.origin}
          trigger={(ask) => (
            <Button variant="ghost" size="sm" onClick={ask}>
              Forget {detail.host}
            </Button>
          )}
          confirmLabel="Forget it"
          onConfirm={() => actions.forget(detail.origin)}
        >
          Forget <code className="typo-code">{detail.origin}</code>? Its trust, its{" "}
          {ruled || "no"} rulings and both sightings go with it, and the next visit is a first
          sight again.
        </ConfirmInline>
      </div>
    </>
  );
}

function Row({
  row,
  onChange,
}: {
  row: OverrideLine;
  onChange: (cls: OverrideLine["overrideCls"]) => void;
}) {
  return (
    <li className="override-row">
      <span className="row" style={{ gap: 6 }}>
        <code className="typo-code">{row.tool}</code>
        {row.tier ? <Badge tone="neutral">{TIER_WORD[row.tier]}</Badge> : null}
        <span style={{ marginLeft: "auto" }}>
          {row.effectiveCls ? (
            <ClassPill cls={row.effectiveCls} overridden={row.overrideCls !== null} />
          ) : (
            <span className="typo-label muted">{row.overrideCls ?? "—"}</span>
          )}
        </span>
      </span>

      {row.ignored ? (
        <p className="typo-label row" style={{ gap: 6 }}>
          <StatusDot tone="warning" />
          <span>
            Your <code className="typo-code">{row.overrideCls}</code> is looser than the page now
            declares, so the gate ignores it.
          </span>
        </p>
      ) : null}

      <ClassPicker
        tool={row.tool}
        declared={row.declaredCls}
        value={row.overrideCls}
        allowed={row.allowed}
        lockedReason={row.lockedReason}
        onChange={onChange}
      />
    </li>
  );
}
