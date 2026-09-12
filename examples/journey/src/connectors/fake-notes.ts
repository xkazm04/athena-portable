/**
 * README section 4 — Notion's stand-in. `search`, `read_page`, `append_to_page`, `create_page`.
 *
 * The allow-list here is resources rather than recipients: a page id may be appended to, and a
 * new page may only be created under an allowed parent. Section 4 names both shapes ("recipients
 * or resources") and the difference matters — an agent that may write *somewhere* in a workspace
 * is not the same permission as an agent that may write to one page.
 */
import type { GateTool } from "@athena/bridge/gate";
import { readTool, writeTool, type ConnectorPort } from "./port.ts";

export interface NotePage {
  readonly id: string;
  readonly parent: string | null;
  readonly title: string;
  blocks: string[];
}

export class FakeNotes implements ConnectorPort {
  readonly id = "notes";
  readonly allowed = new Set<string>();
  readonly pages = new Map<string, NotePage>();
  readonly calls: Array<{ name: string; params: Record<string, unknown> }> = [];

  seed(pages: readonly Omit<NotePage, "blocks">[]): void {
    for (const page of pages) this.pages.set(page.id, { ...page, blocks: [] });
  }

  allow(...ids: readonly string[]): void {
    for (const id of ids) this.allowed.add(id);
  }

  listTools(): GateTool[] {
    return [
      readTool("search", "Pages whose title matches a query.", { query: { type: "string" } }),
      readTool("read_page", "One page with its blocks.", { page_id: { type: "string" } }),
      writeTool("append_to_page", "Append one block to a page.", {
        page_id: { type: "string" },
        text: { type: "string" },
      }),
      writeTool("create_page", "Create a page under a parent.", {
        parent_id: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
      }),
    ];
  }

  targetOf(name: string, params: Record<string, unknown>): string | null {
    if (name === "append_to_page") return String(params.page_id ?? "");
    if (name === "create_page") return String(params.parent_id ?? "");
    return null;
  }

  call(name: string, params: Record<string, unknown>): string {
    this.calls.push({ name, params });
    if (name === "search") {
      const query = String(params.query ?? "").toLowerCase();
      const hits = [...this.pages.values()].filter((p) => p.title.toLowerCase().includes(query));
      return JSON.stringify({ showing: hits.length, of: this.pages.size, pages: hits.map((p) => ({ id: p.id, title: p.title })) });
    }
    if (name === "read_page") {
      const page = this.pages.get(String(params.page_id));
      return page ? JSON.stringify(page) : `No page ${String(params.page_id)}.`;
    }
    if (name === "append_to_page") {
      const page = this.pages.get(String(params.page_id));
      if (!page) throw new Error(`No page ${String(params.page_id)}.`);
      page.blocks.push(String(params.text ?? ""));
      return `Appended one block to ${page.title}.`;
    }
    if (name === "create_page") {
      const id = `page_${this.pages.size + 1}`;
      const page: NotePage = {
        id,
        parent: String(params.parent_id ?? ""),
        title: String(params.title ?? ""),
        blocks: [String(params.body ?? "")],
      };
      this.pages.set(id, page);
      return JSON.stringify({ id, title: page.title });
    }
    throw new Error(`connector:notes has no tool named ${name}`);
  }

  childrenOf(parent: string): NotePage[] {
    return [...this.pages.values()].filter((p) => p.parent === parent);
  }
}
