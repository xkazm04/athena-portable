// Types for athena-drive.mjs, so the TypeScript e2e suites can import the driver.
import type { Page } from "playwright-core";

export const E2E_IDENTIFIER: string;

export interface Tab {
  id: number;
  label: string;
  url: string;
  title: string;
  focused: boolean;
  nav: number;
}

/** One step she took, as her window shows it: the plain sentence and the tool it was. */
export interface Act {
  /** The tool's registry name (`host.shadowrunr.where_am_i`), from the row's `data-tool`. */
  tool: string;
  /** The plain sentence a person reads. */
  text: string;
  /** The line under it: a sum, the worst one, a reason. */
  sub: string;
  /** "1" when the step went through, "0" when it failed, was held back or declined. */
  ok: string | null;
}

export interface Message {
  who: "you" | "athena" | "other";
  text: string;
  acts: Act[];
}

export interface Slip {
  id: string;
  kind: "card" | "sheet";
  label: string;
  decision?: string;
  pending: boolean;
  text: string;
}

export interface Settled {
  reply: Message | null;
  messages: Message[];
  cards: Slip[];
  errors: string[];
}

export interface OriginView {
  host: string;
  enabled: boolean;
  listed: boolean;
  /** Short tool name to class, from the focused page's "This page offers" list. */
  tools: Record<string, string>;
  footers: string[];
}

export interface LaunchedProcess {
  pid: number;
  identifier: string;
  created: boolean;
  output: () => string;
  exited: () => number | null;
}

export function waitFor<T>(fn: () => T | Promise<T>, options?: { label?: string; timeout?: number; every?: number }): Promise<T>;
export function freePort(): Promise<number>;
export function appDataDirs(identifier: string): string[];

export interface LaunchOptions {
  exe: string;
  identifier?: string;
  cdpPort?: number;
  startUrl?: string;
  env?: Record<string, string>;
  reuse?: boolean;
  bootTimeout?: number;
  detach?: boolean;
}

export function launch(options: LaunchOptions): Promise<AthenaDriver>;
/** `transport`: "raw" (default; page-level CDP, see raw-cdp.mjs) or "playwright". */
export function attach(options?: { cdp?: string; timeout?: number; transport?: "raw" | "playwright" }): Promise<AthenaDriver>;
export function stopInstance(p: { pid: number; identifier: string; created: boolean }): void;

export interface Connection {
  transport: "raw" | "playwright";
  pages(): Page[];
  close(): Promise<void> | void;
}

export class AthenaDriver {
  conn: Connection;
  cdp: string;
  process: LaunchedProcess | null;
  pages(): Page[];
  readonly chrome: Page;
  readonly athena: Page;
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  status(): Promise<Record<string, unknown>>;
  daemon<T = Record<string, unknown>>(route: string, init?: RequestInit): Promise<T>;
  ready(timeout?: number): Promise<Record<string, unknown>>;
  onboard(): Promise<void>;
  register(url: string): Promise<Tab>;
  athenaTab(name: "talk" | "record" | "origins"): Promise<void>;
  origin(host: string): Promise<OriginView | null>;
  retrust(host: string): Promise<OriginView | null>;
  tabs(): Promise<Tab[]>;
  focus(id: number): Promise<void>;
  tools(tabId: number): Promise<{ ok: boolean; page?: Record<string, unknown>; tools?: Array<{ name: string }>; error?: string }>;
  call(tabId: number, name: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  hand(tabId: number, name: string, input?: Record<string, unknown>): Promise<{ ok: boolean; output: string | null; error: string | null }>;
  showAthena(): Promise<void>;
  transcript(): Promise<Message[]>;
  busy(): Promise<boolean>;
  errors(): Promise<string[]>;
  say(text: string, options?: { wait?: boolean; timeout?: number }): Promise<Settled>;
  settle(options?: { after?: number; timeout?: number }): Promise<Settled>;
  cards(): Promise<Slip[]>;
  approve(id: string): Promise<void>;
  decline(id: string): Promise<void>;
  shot(which: "chrome" | "athena", path: string): Promise<string>;
  close(options?: { stop?: boolean }): Promise<void>;
}
