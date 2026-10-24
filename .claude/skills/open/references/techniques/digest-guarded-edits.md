# digest-guarded-edits

**When** an agent changes a long document, **expose `edit_<thing>{id, base_digest, find, replace}`:
the exact passage, which must occur exactly once, against the digest of the newest read, with a backup
and validate-or-restore on the backend**, **because** the approval card then shows a readable change
instead of a whole file, and a write made against a stale read is refused instead of clobbering.

## The pair

| Tool | Class | Contract |
|---|---|---|
| `read_<thing>{id, offset?, limit?, show?}` | READ | a page of text plus `digest` (`sha256:<hex>` of the file's bytes), `total_chars`, `next_offset?`, `outline?` on the first page (see result-budget) |
| `edit_<thing>{id, base_digest, find, replace}` | GATED | reads the document; `conflict` unless its digest equals `base_digest`; `find` must occur exactly once (zero or several are refused with the count); writes the whole new text against the same digest; returns `{digest, previous_digest, backup?, changed_chars}` |
| `set_<thing>{id, text, base_digest}` | GATED | replaces whole; for a new file (`base_digest: ""`, accepted only when the file does not exist) or a small one |

To insert, `find` is an anchor sentence and `replace` is the anchor plus the new text.

## Backend rules

1. A name allowlist before any IO (`invalid_params` for `../x`, absolute paths, unlisted docs).
2. Copy the previous bytes to a backup path under the app's data dir, write atomically (temp file plus
   rename in the same directory), then validate the package.
3. On a validation error, restore the previous bytes, keep the backup, and refuse with the first few
   issues as `file: key: reason`.
4. The description says the document must be read first and a stale write is refused.

## Checks

- Backend: get/set round trip, conflict, allowlist refusals, validation failure restores, new file.
- Producer: `edit_*` refuses zero and several matches with the count; a digest mismatch is `conflict`
  and the file is unchanged.
- Harness (keyless): an approved edit lands exactly one passage on the scratch copy, a backup exists;
  a declined card writes nothing and leaves no backup.

## Evidence

Shadowrunr (overlord `3c209e5` `character.doc.get/set`, `39d9d32` `edit_character_doc`): in the live
pilot run 2 the card was filed, approved, the package validated and the backup named; on the real
desktop, an approved card landed `before.replace(find, find + " " + added)` exactly
(`apps/desktop/e2e/desktop/athena-desktop.e2e.test.ts`, "shapes Malakor").

## Registry

`mcp-tools/write-freshness-gate`: "a write needs the hash from the newest read; writes never refresh it"
(agrees). `hitl-approval`: "the decision surface shows the actual content, diff, or disclosed impact"
(agrees: the find/replace pair is the diff).
