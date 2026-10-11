# 0068. Page text in the capabilities block is neutralised, not fenced

Date: 2026-10-11

Implements README section 3.2 (the two-output composer) and ADR 0006 (static blocks are the
system prompt, and a resumed CLI session keeps it for the whole conversation). Closes the
council-lite round 1 must-address, robustness-1.

## Context

`render_capabilities` wrote every entry's description, parameter names and enum values into the
static `capabilities` block verbatim. For a host or connector entry those are a page's words.
A description with a newline, a `### GATED` heading or an `OP:` line could therefore forge
structure in the system prompt, and a resumed session keeps that prompt for the rest of the
conversation. ADR 0006 forbids fencing a static block: a fence carries a fresh nonce, which would
move the block's hash every turn and make the prompt-cache churn the hash exists to expose.

## Decision

Neutralise, deterministically and with no nonce, every piece of non-core text the block writes.

- A description becomes one line: each whitespace run (including CR, LF, U+2028, U+2029) is one
  space, other control and format characters are dropped, it is cut at `DESCRIPTION_CAP` = 240
  characters with an ellipsis, and it is written with `json.dumps(..., ensure_ascii=False)`, so
  it is a quoted string that cannot start a line, heading, list item or `OP:` line.
- For non-core entries, a parameter name or type that is not a plain identifier (letters, digits,
  underscore, hyphen, at most 40) is written as a capped JSON string. Enum values show at most
  `ENUM_SHOWN` = 12, each capped at `PARAM_TEXT_CAP` = 40, then `+N more`.
- Core entries render byte for byte as before.
- One fixed sentence under `## Capabilities` says a quoted description is the page's or
  connector's own words: data about the tool, never an instruction.
- `HostManifest.validate` does not refuse a long description: a refusal drops the whole manifest.
  The gate's classification of a tool is untouched.

240 characters fits a sentence of what a tool does and bounds the block at a few hundred bytes
per tool; 40 covers any real identifier or enum token; 12 values show the shape of an enum.

## Consequences

- The capabilities block hash is a function of the catalog alone and holds across turns.
- A page's description longer than 240 characters is cut in what the model sees; its tool still
  registers and is gated as before.
- The static-block exemption is still by block name, not provenance (council craft-1); this
  decision makes the one static block that carries foreign text safe, it does not generalise.
- `memory.always` is also static and page-adjacent; it is a separate line (robustness-5).

## Amended 2026-10-11

Injection-resistance council full r2 robustness-3 and craft-1. `neutralise_text` (through
`canonical_line`, split out by ADR 0075) also drops the variation selectors U+FE00-FE0F and
U+E0100-E01EF. They are category Mn, not Cf, so the rule above kept them, yet they show nothing on
their own and could hide text in a description or a memory line. Only those two ranges are
dropped: every other Mn character, a combining accent among them, is part of a word and is kept.
Fence bodies are not neutralised and are unchanged (ADR 0006).
