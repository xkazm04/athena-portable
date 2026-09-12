/**
 * README section 3.3 ("the gate in one page") — the surface, assembled from the real gate.
 *
 * Everything a surface owes a page passes through here and in this order: list what the page
 * registered, build the README section 3.3 manifest from it, decide each tool's class from the
 * page's *flags* (never its preference), claim a call against the per-origin budget, and fence
 * whatever came back before anyone could read it as an instruction. The classification functions
 * are imported from `@athena/bridge/gate` rather than restated, because a second copy of the
 * policy is a second policy.
 *
 * A GATED tool cannot leave this class without a resolved approval that describes this action
 * and these parameters. There is no parameter, no environment variable and no test seam that
 * loosens it: `run` looks the class up itself and the caller does not get to say what it is.
 */
import {
  Budget,
  decide,
  fence,
  freshNonce,
  manifestOf,
  type Decision,
  type GateTool,
  type HostManifest,
  type PageIdentity,
} from "@athena/bridge/gate";
import type { Page } from "@playwright/test";
import { originOf, type AppSpec } from "./apps.ts";
import { ApprovalError, type Approvals, type Card } from "./approvals.ts";
import type { Ledger, LedgerRow } from "./ledger.ts";
import { call, hand, handTools, installBridge, list } from "./relay.ts";

export interface Result {
  readonly output: string;
  /** What a prompt would actually carry: the output, neutralised and fenced (section 3.2). */
  readonly fenced: string;
  readonly row: LedgerRow;
  readonly approval: Card | null;
}

export interface Refused {
  readonly reason: string;
  readonly message: string;
  readonly row: LedgerRow;
}

export class Surface {
  private tools: GateTool[] = [];
  private handNames = new Set<string>();
  private identity: PageIdentity = {};
  private decisions = new Map<string, Decision>();
  /**
   * The per-origin ceiling for this window. The gate's default is 50, which is a *window* of a
   * browsing session; the journey's window is one run that matches fourteen credits and chases a
   * strip of overdue invoices, so the ceiling is stated here rather than the budget being
   * bypassed. `Budget.take` still refuses, and still refuses with `budget_exhausted`.
   */
  readonly budget = new Budget(Number(process.env.JOURNEY_CALL_BUDGET ?? 250));
  /** One nonce for the whole session, which is exactly why `fence` neutralises replayed markers. */
  readonly nonce = freshNonce();

  constructor(
    readonly app: AppSpec,
    readonly page: Page,
    private readonly approvals: Approvals,
    private readonly ledger: Ledger,
  ) {}

  static async open(app: AppSpec, page: Page, approvals: Approvals, ledger: Ledger, url: string): Promise<Surface> {
    const surface = new Surface(app, page, approvals, ledger);
    await installBridge(page);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await surface.settle();
    return surface;
  }

  /**
   * Wait for the registry to stop moving. A page registers its tools from a React effect after
   * hydration, so the first `list` on a fresh navigation is honestly empty — and a surface that
   * read it once would build a manifest of nothing. This is the `toolchange` loop of protocol.md
   * with a deadline: re-list until two consecutive answers agree and at least one tool is there.
   */
  async settle(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let previous = -1;
    for (;;) {
      await this.refresh();
      const count = this.tools.length;
      // A page of its own beyond the hands is what "settled" means for one of the studio's apps.
      // An uninstrumented page never registers one and is settled the moment the hands are in;
      // waiting for a tool it will never publish would be thirty seconds of nothing on every run.
      const wanted = this.app.kind === "static" ? this.handNames.size : count - this.handNames.size;
      if (wanted > 0 && count === previous) return;
      if (Date.now() > deadline) {
        if (wanted > 0) return;
        throw new Error(`${this.app.id}: no tools on ${this.page.url()} within ${timeoutMs} ms`);
      }
      previous = count;
      await this.page.waitForTimeout(250);
    }
  }

  /**
   * Re-run `list`, append the hands, and rebuild the manifest.
   *
   * One list, not two, and that is the production shape: the panel appends the shell's hands to
   * whatever the page registered and hands the single list to `manifestOf`, so a hand and a page
   * tool are classified by the same derivation and land in the same manifest under the same
   * origin. A page that registered nothing therefore has a manifest of exactly the hands, which
   * is what makes a page nobody instrumented operable at all.
   *
   * README section 3.3: the hands are `GATED` on first sight for every new origin whatever their
   * flags imply, so they carry that override. `decide` honours a tightening override and refuses
   * a loosening one, so this can only ever narrow what may run without a card.
   */
  async refresh(): Promise<void> {
    const answer = await list(this.page);
    this.identity = answer.page;
    this.handNames = new Set(await handTools(this.page).then((tools) => tools.map((t) => t.name)));
    // A hand a page already registered under the same name is the page's: it knows its own
    // application and the generic one would be a worse answer with the same spelling.
    const own = new Set(answer.tools.map((tool) => tool.name));
    const hands = (await handTools(this.page)).filter((tool) => !own.has(tool.name));
    for (const tool of hands) this.handNames.add(tool.name);
    this.tools = [...answer.tools, ...hands];
    const overrides = Object.fromEntries([...this.handNames].map((name) => [name, "GATED"]));
    this.decisions = new Map(
      this.tools.map((tool) => [tool.name, decide(tool, this.isHand(tool.name) ? overrides : null)]),
    );
  }

  /** Is this name one of the shell's generic hands rather than one of the page's own tools? */
  isHand(name: string): boolean {
    return this.handNames.has(name);
  }

  /** The tier a call on this name is recorded at: the page's own tools are 1, the hands are 2. */
  tierOf(name: string): 1 | 2 {
    return this.isHand(name) ? 2 : 1;
  }

  get origin(): string {
    return originOf(this.app);
  }

  manifest(): HostManifest {
    return manifestOf(this.identity, this.tools);
  }

  names(): string[] {
    return this.tools.map((t) => t.name).sort();
  }

  has(name: string): boolean {
    return this.decisions.has(name);
  }

  decision(name: string): Decision {
    const found = this.decisions.get(name);
    if (!found) throw new Error(`${this.app.id} registered no tool named ${name}`);
    return found;
  }

  classOf(name: string): "AUTO" | "GATED" {
    return this.decision(name).cls;
  }

  gatedNames(): string[] {
    return this.names().filter((n) => this.classOf(n) === "GATED");
  }

  autoNames(): string[] {
    return this.names().filter((n) => this.classOf(n) === "AUTO");
  }

  /** A decision card for a GATED action, before anything runs. */
  propose(name: string, params: Record<string, unknown> = {}): Card {
    if (this.classOf(name) !== "GATED") throw new Error(`${name} is AUTO; a card would be theatre`);
    return this.approvals.request(this.origin, name, params);
  }

  /**
   * Run one tool. The class comes from the gate; the approval, when the class is GATED, must
   * already be granted for exactly this action. Every outcome, refusals included, is one row.
   */
  async run(name: string, params: Record<string, unknown> = {}, approval: Card | null = null): Promise<Result> {
    const cls = this.classOf(name);
    let card: Card | null = null;
    if (cls === "GATED") card = this.approvals.prove(approval?.id ?? null, this.origin, name, params);

    const ticket = this.budget.take(this.origin);
    if (!ticket.ok) throw new Error(`${this.origin}: ${ticket.message}`);

    const tier = this.tierOf(name);
    // Two transports, one gate. A hand goes to the hands namespace and a page tool to the page's,
    // and everything either side of this line — the class, the approval, the budget, the row — is
    // the same code for both.
    const answer = tier === 2 ? await hand(this.page, name, params) : await call(this.page, name, params);
    if (answer.ok !== true) {
      const row = this.ledger.write({
        app: this.app.id,
        tier,
        tool: name,
        cls,
        outcome: "refused",
        reason: answer.reason ?? "unknown",
        approval: card?.id ?? null,
        target: null,
      });
      throw Object.assign(new Error(`${name}: ${answer.error}`), { row });
    }
    const row = this.ledger.write({
      app: this.app.id,
      tier,
      tool: name,
      cls,
      outcome: "ok",
      reason: null,
      approval: card?.id ?? null,
      target: null,
    });
    return { output: answer.output, fenced: fence(answer.output, "untrusted", this.nonce), row, approval: card };
  }

  /** An AUTO read, as JSON when the tool answered JSON. Refuses to run anything GATED. */
  async read<T = unknown>(name: string, params: Record<string, unknown> = {}): Promise<T> {
    const result = await this.run(name, params);
    return parse<T>(result.output);
  }

  /** Card, approve, run — the whole gated path, in the order the daemon runs it. */
  async approveAndRun(name: string, params: Record<string, unknown> = {}): Promise<Result> {
    const card = this.propose(name, params);
    this.approvals.approve(card.id);
    return this.run(name, params, card);
  }

  /**
   * Card, decline, attempt — and the attempt must fail with `user_denied` and touch nothing.
   * The attempt is deliberate: a decline that is only "the runner did not call it" proves the
   * runner's manners, not the gate's.
   */
  async declineAndRun(name: string, params: Record<string, unknown> = {}): Promise<Refused> {
    const card = this.propose(name, params);
    this.approvals.decline(card.id);
    return this.refused(name, params, card);
  }

  /** A GATED tool a caller tried to run with no card at all. Also a refusal, also a row. */
  async runUngated(name: string, params: Record<string, unknown> = {}): Promise<Refused> {
    return this.refused(name, params, null);
  }

  private async refused(name: string, params: Record<string, unknown>, card: Card | null): Promise<Refused> {
    try {
      await this.run(name, params, card);
    } catch (error) {
      if (error instanceof ApprovalError) {
        const row = this.ledger.write({
          app: this.app.id,
          tier: this.tierOf(name),
          tool: name,
          cls: "GATED",
          outcome: "refused",
          reason: error.reason,
          approval: card?.id ?? null,
          target: null,
        });
        return { reason: error.reason, message: error.message, row };
      }
      throw error;
    }
    throw new Error(`${name} executed without a granted approval; the gate did not hold`);
  }
}

/** Tool output is always a string on the wire; most of these answer JSON. Neither is assumed. */
export function parse<T>(output: string): T {
  try {
    return JSON.parse(output) as T;
  } catch {
    return output as unknown as T;
  }
}
