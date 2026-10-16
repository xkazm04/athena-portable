/**
 * The tab strip, the address field and the tools pill — README section 3.1, 3.4 and 3.5, ADR 0088.
 *
 * The one piece of the old Browser module that is still drawn as it was: it is the band above a
 * native page webview (`layout.rs` reserves its 40px as `--strip-height`), the only part of the
 * chrome a page does not cover. Pure functions of the Browser model; the depth stage draws it in
 * the page shape.
 */
import { useState } from "react";

import Badge from "@/components/Badge";
import Button from "@/components/Button";
import { normaliseUrl } from "@/lib/url";
import { NEW_TAB_URL, type BrowserModel, type BrowserTab, type BrowserTools } from "@/modules/browser/model";

/**
 * The strip: the tabs, the way to open another, the address field and the tools pill. It is the
 * only part of this module a page does not cover, so it is its own component: the module bar's
 * Browser draws it above the ledger, and the depth stage draws it as the band above a page.
 */
export function StripView({ model }: { model: BrowserModel }) {
  const { actions, focused, tabs, tools } = model;
  const go = (typed: string) => {
    const url = normaliseUrl(typed);
    if (!url) return;
    if (focused) actions.navigate(focused.id, url);
    else actions.open(url);
  };
  return (
    <div className="tab-strip" data-tauri-drag-region>
      <TabStrip tabs={tabs} onFocus={actions.focus} onClose={actions.close} />
      {/* Outside the rail on purpose: with twenty tabs open, the way to open a twenty-first
          must not itself be something you have to scroll to. */}
      <Button size="sm" variant="ghost" title="New tab" onClick={() => actions.open(NEW_TAB_URL)}>
        +
      </Button>
      <UrlField key={`${focused?.id ?? "none"}:${focused?.url ?? ""}`} url={focused?.url ?? ""} onGo={go} />
      {/* The strip is the only band of this view a page does not cover, so the one fact about
          the page that is worth a permanent 6rem lives here: does the relay see anything. */}
      <ToolCount tools={tools} />
    </div>
  );
}

// -- the strip -----------------------------------------------------------------------------------

/**
 * The focused page's tier-1 surface in one pill, and it is three facts rather than a number.
 * `pending` is nobody has asked yet; `warning` is the relay could not read the page, with the
 * reason verbatim in the title; and a count is a count, where zero is the ordinary answer for
 * every site that never heard of WebMCP — which is a page Athena reaches through her generic hands, gated on first sight.
 */
function ToolCount({ tools }: { tools: BrowserTools | null }) {
  if (!tools) return null;
  if (tools.asking) {
    return (
      <Badge tone="pending" title="Asking the page what it has registered">
        tools
      </Badge>
    );
  }
  if (tools.problem) {
    return (
      <Badge tone="warning" title={`The page did not answer: ${tools.problem}`}>
        no bridge
      </Badge>
    );
  }
  // Counted as the field's summary counts (`appOf`): "1 tool", never "1 tools" or "tool(s)".
  const counted = `${tools.count} tool${tools.count === 1 ? "" : "s"}`;
  return (
    <Badge tone={tools.count ? "success" : "neutral"} title={`${counted} over ${tools.transport ?? "no transport"}`}>
      {counted}
    </Badge>
  );
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
        // The first Escape puts the address back; with nothing typed the field lets go, so the
        // next Escape is the stage's (it never takes a text field's Escape).
        if (e.key === "Escape") {
          if (edit !== null) setEdit(null);
          else e.currentTarget.blur();
        }
      }}
    />
  );
}
