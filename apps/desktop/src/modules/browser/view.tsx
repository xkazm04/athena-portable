/**
 * The Browser module's surface — a pure function of `BrowserModel`.
 *
 * **Its first 40px are a contract.** The window has two shapes (`src-tauri/src/layout.rs`): when
 * this module is selected and a tab is open, the chrome webview is clipped to the module bar plus
 * `--strip-height` and a page webview fills everything under it, so the only part of this view
 * the user sees is the tab strip. With no tab open there is no page webview, the chrome webview
 * gets the whole window, and the rest of this view — the header, the stand-in, the empty state —
 * is what fills it. The preview harness always shows all of it.
 *
 * That is why the strip is first and why its height is a variable both this stylesheet and that
 * Rust file spell. Everything below it is written to be read in the two places it can be seen:
 * the harness, and the window with no tab open.
 */
import { useState } from "react";

import Badge from "@/components/Badge";
import Button from "@/components/Button";
import EmptyState from "@/components/EmptyState";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import SectionCard from "@/components/SectionCard";
import Table from "@/components/Table";
import type { Column } from "@/components/Table";
import { normaliseUrl } from "@/lib/url";

import { NEW_TAB_URL, type BrowserModel, type BrowserTab } from "./model";

export default function BrowserView({ model }: { model: BrowserModel }) {
  const { actions, focused, problem, tabs } = model;

  const go = (typed: string) => {
    const url = normaliseUrl(typed);
    if (!url) return;
    if (focused) actions.navigate(focused.id, url);
    else actions.open(url);
  };

  return (
    <div className="module-browser">
      <div className="tab-strip" data-tauri-drag-region>
        <TabStrip tabs={tabs} onFocus={actions.focus} onClose={actions.close} />
        {/* Outside the rail on purpose: with twenty tabs open, the way to open a twenty-first
            must not itself be something you have to scroll to. */}
        <Button size="sm" variant="ghost" title="New tab" onClick={() => actions.open(NEW_TAB_URL)}>
          +
        </Button>
        <UrlField key={`${focused?.id ?? "none"}:${focused?.url ?? ""}`} url={focused?.url ?? ""} onGo={go} />
      </div>

      <div className="module-browser__body">
        <PageShell fill>
          <PageHeader
            eyebrow="Browser"
            title="The pages Athena can see"
            caption="One webview per tab, one profile, one of them on screen."
            meta={
              <>
                <Badge tone={problem ? "error" : tabs.length ? "success" : "neutral"}>
                  {problem ? "unread" : `${tabs.length} open`}
                </Badge>
                {focused ? <Badge tone="info">{focused.host}</Badge> : null}
              </>
            }
          />

          {problem ? (
            <SectionCard title="The tab list could not be read" posture="flat">
              {/* Verbatim, never paraphrased: a reason we cannot explain is still a reason. */}
              <p className="well">{problem}</p>
              <p className="typo-caption">The shell answers once the window has finished starting.</p>
            </SectionCard>
          ) : focused ? (
            <div className="page-stand-in">
              <p className="typo-title">The page draws here</p>
              <p className="typo-caption">
                {focused.url} — a webview of its own, positioned by the shell, not by this page.
              </p>
            </div>
          ) : (
            <EmptyState
              glyph="+"
              title="No tab open"
              line="Open one from the strip above, or launch the shell with ATHENA_START_URL."
              action={
                <Button variant="primary" onClick={() => actions.open(NEW_TAB_URL)}>
                  New tab
                </Button>
              }
            />
          )}

          <SectionCard title="Open tabs" note={`${tabs.length} open`} padded={false}>
            <Table
              columns={columns(actions)}
              rows={tabs}
              rowKey={(t) => t.id}
              empty="No tab is open. The + in the strip opens one."
            />
          </SectionCard>
        </PageShell>
      </div>
    </div>
  );
}

function columns(actions: BrowserModel["actions"]): readonly Column<BrowserTab>[] {
  return [
    {
      key: "title",
      head: "Title",
      render: (t) => (
        <button type="button" className="tab-chip__label focus-ring typo-body" onClick={() => actions.focus(t.id)}>
          {t.title}
        </button>
      ),
    },
    { key: "host", head: "Host", render: (t) => <span className="typo-data">{t.host}</span> },
    { key: "url", head: "Address", render: (t) => <span className="typo-caption truncate">{t.url}</span> },
    {
      key: "state",
      head: "On screen",
      render: (t) => (t.focused ? <Badge tone="success">focused</Badge> : <span className="typo-caption">—</span>),
    },
    {
      key: "close",
      head: "",
      align: "right",
      render: (t) => (
        <Button size="sm" variant="ghost" aria-label={`Close ${t.title}`} onClick={() => actions.close(t.id)}>
          ×
        </Button>
      ),
    },
  ];
}

/**
 * The tabs, scrolling rather than squeezing. A chip has a minimum readable width, so a row that
 * divides itself between however many tabs are open stops being a tab strip at about eight of
 * them: the labels go, then the close buttons overlap, then the newest tab is simply not drawn.
 */
function TabStrip({
  tabs,
  onFocus,
  onClose,
}: {
  tabs: readonly BrowserTab[];
  onFocus: (id: number) => void;
  onClose: (id: number) => void;
}) {
  return (
    <div className="tab-rail" data-tauri-drag-region>
      {tabs.map((tab) => (
        <span
          key={tab.id}
          className={tab.focused ? "tab-chip tab-chip--focused typo-caption" : "tab-chip typo-caption"}
        >
          <button
            type="button"
            className="tab-chip__label focus-ring"
            title={tab.url}
            onClick={() => onFocus(tab.id)}
          >
            {tab.title}
          </button>
          <button
            type="button"
            className="tab-chip__close focus-ring"
            title="Close tab"
            aria-label={`Close ${tab.title}`}
            onClick={() => onClose(tab.id)}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

/**
 * The address field. `edit` is null until the user types and the displayed value falls back to
 * the tab's own URL, so a navigation the page performed shows up with no syncing effect. The
 * draft outlives Enter until the navigation resolves: Rust rejects anything `Url::parse` refuses
 * — a typed phrase with a space, which is what a user produces the moment they treat this as a
 * search box — and clearing the draft first made that failure invisible.
 */
function UrlField({ url, onGo }: { url: string; onGo: (typed: string) => void }) {
  const [edit, setEdit] = useState<string | null>(null);
  const value = edit ?? url;
  return (
    <input
      className="input url-field focus-ring typo-body"
      value={value}
      spellCheck={false}
      placeholder="Address"
      aria-label="Address"
      onChange={(e) => setEdit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onGo(value);
        if (e.key === "Escape") setEdit(null);
      }}
    />
  );
}
