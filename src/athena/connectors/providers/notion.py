"""Notion: four intent-shaped tools over the REST API (README §4; ADR 0021).

Page ids are compared de-hyphenated, so an id pasted with or without dashes is the same page and
the same allow-list entry. A block type this module does not render is named in brackets rather
than dropped, so the model can see there was something it did not get.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

__all__ = ["API", "BLOCK_CHARS", "Request", "execute", "normalize_id", "render_blocks", "title_of"]

API = "https://api.notion.com/v1"
#: Notion refuses a rich-text run longer than this, so a long append is split, never cut.
BLOCK_CHARS = 2000
CHILDREN_PAGE = 100

Request = Callable[[str, str, Any], tuple[int, Any]]

_PREFIX = {
    "heading_1": "# ",
    "heading_2": "## ",
    "heading_3": "### ",
    "bulleted_list_item": "- ",
    "numbered_list_item": "1. ",
    "to_do": "- [ ] ",
    "quote": "> ",
}


def normalize_id(value: str) -> str:
    return value.strip().lower().replace("-", "")


def rich_text(node: Any) -> str:
    if not isinstance(node, list):
        return ""
    parts = []
    for run in node:
        if isinstance(run, Mapping):
            if isinstance(run.get("plain_text"), str):
                parts.append(run["plain_text"])
            elif isinstance(run.get("text"), Mapping):
                parts.append(str(run["text"].get("content", "")))
    return "".join(parts)


def title_of(page: Any) -> str:
    if not isinstance(page, Mapping):
        return ""
    properties = page.get("properties")
    if isinstance(properties, Mapping):
        for prop in properties.values():
            if isinstance(prop, Mapping) and prop.get("type") == "title":
                text = rich_text(prop.get("title"))
                if text:
                    return text
    if isinstance(page.get("title"), list):
        return rich_text(page["title"])
    return ""


def render_search(body: Any) -> str:
    if not isinstance(body, Mapping) or not isinstance(body.get("results"), list):
        return ""
    lines = []
    for item in body["results"]:
        if isinstance(item, Mapping):
            kind, item_id = item.get("object", "page"), item.get("id", "")
            lines.append(f"- {kind}: {title_of(item) or '(untitled)'}\n  id: {item_id}")
    return "\n".join(lines)


def render_blocks(body: Any) -> str:
    if not isinstance(body, Mapping) or not isinstance(body.get("results"), list):
        return ""
    lines: list[str] = []
    for block in body["results"]:
        if not isinstance(block, Mapping):
            continue
        kind = str(block.get("type", ""))
        payload = block.get(kind)
        text = rich_text(payload.get("rich_text")) if isinstance(payload, Mapping) else ""
        if text:
            lines.append(f"{_PREFIX.get(kind, '')}{text}")
        elif kind:
            lines.append(f"[{kind}]")
    return "\n".join(lines)


def paragraphs(text: str, limit: int = BLOCK_CHARS) -> list[dict[str, Any]]:
    chunks = [text[i : i + limit] for i in range(0, max(len(text), 1), limit)] or [""]
    return [
        {
            "object": "block",
            "type": "paragraph",
            "paragraph": {"rich_text": [{"type": "text", "text": {"content": chunk}}]},
        }
        for chunk in chunks
    ]


def execute(request: Request, tool: str, params: Mapping[str, Any]) -> tuple[bool, str]:
    """Run one tool. ``(ok, text)``: a read's text, a write's sentence, or a refusal's reason."""
    if tool == "search":
        limit = max(1, int(params.get("max_results", 5) or 5))
        status, body = request(
            "POST", f"{API}/search", {"query": str(params["query"]), "page_size": limit}
        )
        if status >= 300:
            return False, f"Notion answered {status} to the search"
        return True, render_search(body) or "Nothing matched."
    if tool == "read_page":
        page_id = normalize_id(str(params["page_id"]))
        status, page = request("GET", f"{API}/pages/{page_id}", None)
        if status >= 300:
            return False, f"Notion answered {status} to the page read"
        status, blocks = request(
            "GET", f"{API}/blocks/{page_id}/children?page_size={CHILDREN_PAGE}", None
        )
        if status >= 300:
            return False, f"Notion answered {status} to the block read"
        return True, f"# {title_of(page) or '(untitled)'}\n\n{render_blocks(blocks)}"
    if tool == "append_to_page":
        page_id = normalize_id(str(params["page_id"]))
        status, _ = request(
            "PATCH",
            f"{API}/blocks/{page_id}/children",
            {"children": paragraphs(str(params["text"]))},
        )
        if status >= 300:
            return False, f"Notion answered {status} to the append"
        return True, f"appended {len(str(params['text']))} characters to page {page_id}"
    if tool == "create_page":
        parent = normalize_id(str(params["parent_page_id"]))
        page_body: dict[str, Any] = {
            "parent": {"type": "page_id", "page_id": parent},
            "properties": {
                "title": {"title": [{"type": "text", "text": {"content": str(params["title"])}}]}
            },
        }
        if params.get("text"):
            page_body["children"] = paragraphs(str(params["text"]))
        status, created = request("POST", f"{API}/pages", page_body)
        if status >= 300:
            return False, f"Notion answered {status} to the create"
        new_id = created.get("id", "") if isinstance(created, Mapping) else ""
        return True, f"created page {new_id} under {parent}"
    return False, f"notion has no tool {tool!r}"
