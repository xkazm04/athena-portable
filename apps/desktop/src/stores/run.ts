// TEMPORARY STUB — replaced by the run-loop branch; do not extend.
//
// The run loop (README section 3.2, the turn) is being written on another branch at the same time
// as the two surfaces that render it. This file is the *public surface* of that store and nothing
// else: the types the panel and origins view-models are written against, and enough of a store to
// make them typecheck and render. It performs no I/O, opens no stream and answers no decision.
//
// It exists so the views branch can be gated and reviewed on its own. The run-loop branch replaces
// this whole file; if that merge leaves a name here that the real store does not export, the two
// were written against different contracts and the compiler is the right place to find out.
import { create } from "zustand";

import type { ToolClass } from "@/lib/store";

export type RunStatus = "idle" | "streaming" | "awaiting_decision" | "error";

export type TranscriptKind =
  | "user"
  | "assistant"
  | "tool.call"
  | "tool.result"
  | "decision"
  | "error"
  | "summary";

/** One line of the record. `text` is untrusted: it is displayed, never interpreted. */
export interface TranscriptItem {
  id: string;
  kind: TranscriptKind;
  text: string;
  at: number;
  meta?: Record<string, unknown>;
}

/** A gated call waiting for the user (README section 3.3). */
export interface Decision {
  id: string;
  action: string;
  params: Record<string, unknown>;
  summary: string;
  options: string[];
  captureId: string | null;
  origin: string;
  surface: string;
  createdAt: number;
}

/** One tool of any tier, with the class the gate gave it. Nothing here decides a class. */
export interface ToolRow {
  name: string;
  origin: string;
  description: string;
  /** 1 the page's own tools, 2 the generic hands, 3 a connector (README section 3.4). */
  tier: 1 | 2 | 3;
  declaredCls: ToolClass;
  overrideCls: ToolClass | null;
  effectiveCls: ToolClass;
  transport: string;
}

export interface RunState {
  status: RunStatus;
  transcript: TranscriptItem[];
  pendingDecision: Decision | null;
  lastError: { reason: string; detail: string } | null;
  conversationId: string | null;
  tools: ToolRow[];
}

export const useRun = create<RunState>(() => ({
  status: "idle",
  transcript: [],
  pendingDecision: null,
  lastError: null,
  conversationId: null,
  tools: [],
}));

export interface RunActions {
  send: (message: string) => Promise<void>;
  answer: (approvalId: string, choice: string, answer?: string) => Promise<void>;
  setOverride: (origin: string, tool: string, cls: ToolClass | null) => Promise<void>;
  forgetOrigin: (origin: string) => Promise<void>;
  clear: () => void;
}

// The signatures are the contract; the bodies are the stub. A caller typechecks against
// `RunActions` and gets nothing back, which is what a branch with no run loop should do.
export const runActions: RunActions = {
  send: async () => {},
  answer: async () => {},
  setOverride: async () => {},
  forgetOrigin: async () => {},
  clear: () => {},
};

export async function startRun(): Promise<void> {}
