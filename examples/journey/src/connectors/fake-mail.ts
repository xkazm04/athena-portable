/**
 * README section 4 — Gmail's stand-in. `search_mail`, `read_mail`, `send_mail`.
 *
 * The real connector is one JSON spec and a broker in another repository. What the journey needs
 * from it is the part this build owns: intent-shaped tools ("search mail", not nine endpoints),
 * reads that are reads, a write that is GATED and allow-listed by recipient, and a record of
 * every call so act 4 can show tier 3 beside tier 1.
 *
 * The mailbox is pre-seeded with the applicant availability replies act 2 searches for, addressed
 * to the studio's shared inbox, because a connector with an empty mailbox proves nothing about a
 * search.
 */
import type { GateTool } from "@athena/bridge/gate";
import { readTool, writeTool, type ConnectorPort } from "./port.ts";

export interface Mail {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly received_at: string;
}

export interface SentMail {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly body: string;
}

export class FakeMail implements ConnectorPort {
  readonly id = "mail";
  readonly allowed = new Set<string>();
  readonly inbox: Mail[] = [];
  readonly sent: SentMail[] = [];
  /** Every call, in order, so a test can assert what was asked as well as what happened. */
  readonly calls: Array<{ name: string; params: Record<string, unknown> }> = [];

  constructor(readonly from: string) {}

  seed(mails: readonly Omit<Mail, "id">[]): void {
    for (const mail of mails) this.inbox.push({ id: `msg_${this.inbox.length + 1}`, ...mail });
  }

  /** Allow one recipient. Section 4: the list is off by default, so every member is deliberate. */
  allow(...addresses: readonly string[]): void {
    for (const address of addresses) this.allowed.add(address.toLowerCase());
  }

  listTools(): GateTool[] {
    return [
      readTool("search_mail", "Messages matching a query, newest first.", { query: { type: "string" } }),
      readTool("read_mail", "One message in full.", { id: { type: "string" } }),
      writeTool("send_mail", "Send one message from the studio inbox.", {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      }),
    ];
  }

  targetOf(name: string, params: Record<string, unknown>): string | null {
    return name === "send_mail" ? String(params.to ?? "").toLowerCase() : null;
  }

  call(name: string, params: Record<string, unknown>): string {
    this.calls.push({ name, params });
    if (name === "search_mail") {
      const query = String(params.query ?? "").toLowerCase();
      const hits = this.inbox.filter((m) =>
        [m.from, m.subject, m.body].some((field) => field.toLowerCase().includes(query)),
      );
      return JSON.stringify({ showing: hits.length, of: this.inbox.length, messages: hits });
    }
    if (name === "read_mail") {
      const hit = this.inbox.find((m) => m.id === String(params.id));
      return hit ? JSON.stringify(hit) : `No message ${String(params.id)}.`;
    }
    if (name === "send_mail") {
      const mail: SentMail = {
        to: String(params.to ?? "").toLowerCase(),
        from: this.from,
        subject: String(params.subject ?? ""),
        body: String(params.body ?? ""),
      };
      this.sent.push(mail);
      return `Sent to ${mail.to}.`;
    }
    throw new Error(`connector:mail has no tool named ${name}`);
  }

  sentTo(address: string): SentMail[] {
    return this.sent.filter((m) => m.to === address.toLowerCase());
  }
}
