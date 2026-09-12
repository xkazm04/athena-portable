/**
 * The browser module's view-model (README §3.5: "the browser is one module among them").
 *
 * The point of the module-first window is that the browser has no special standing. It is a
 * view-model, fixtures and a pure view, exactly like the record or the approvals inbox — which is
 * what stops the chrome from growing into the thing everything else is arranged around.
 */

export interface TabView {
  label: string;
  title: string;
  url: string;
  appId: string | null;
  /** How many tools this page registered. Zero is a real answer, not a missing one. */
  tools: number;
  active: boolean;
  /** `true` once the daemon accepted the page's manifest. */
  registered: boolean;
}

export interface BrowserModel {
  tabs: TabView[];
  /** What the address field currently holds, which is not always the active tab's url. */
  address: string;
  /** Set while a tab is being opened, so the view can say so rather than look frozen. */
  opening: boolean;
  error: string | null;
}

export interface BrowserActions {
  open(url: string): void;
  close(label: string): void;
  activate(label: string): void;
  refresh(label: string): void;
}

export const fixtures: Readonly<Record<string, BrowserModel>> = Object.freeze({
  empty: { tabs: [], address: "", opening: false, error: null },

  "one page, registered": {
    tabs: [
      {
        label: "page-1",
        title: "Ledgerbox — Invoices",
        url: "https://ledgerbox.example/invoices",
        appId: "ledgerbox",
        tools: 4,
        active: true,
        registered: true,
      },
    ],
    address: "https://ledgerbox.example/invoices",
    opening: false,
    error: null,
  },

  "two tabs, one silent": {
    tabs: [
      {
        label: "page-1",
        title: "Ledgerbox — Invoices",
        url: "https://ledgerbox.example/invoices",
        appId: "ledgerbox",
        tools: 4,
        active: true,
        registered: true,
      },
      {
        // A page that registered nothing is the normal case, and act 2 of the demo is about it.
        label: "page-2",
        title: "Tidycrm",
        url: "https://tidycrm.example",
        appId: null,
        tools: 0,
        active: false,
        registered: false,
      },
    ],
    address: "https://ledgerbox.example/invoices",
    opening: false,
    error: null,
  },

  opening: { tabs: [], address: "https://hirelane.example", opening: true, error: null },

  refused: {
    tabs: [],
    address: "not a url",
    opening: false,
    error: "not a url: not a url",
  },
});
