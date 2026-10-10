# 0061. A recipient item is one address

Date: 2026-10-10

Amends `connectors/service.py` (`check_egress`) and `connectors/providers/gmail.py`
(`build_send_body`), after ADR 0021. Found by the gmail-and-notion-connectors lite council
(run 2026-10-10-gmail-and-notion-connectors-lite-r1, robustness: "The recipient allow-list accepts
a multi-address string whose last address is in angle brackets").

## Context

`_normal` took the text after the last `<` when a string ended in `>`. A `to` item
`evil@x.com, <ok@me.com>` therefore normalised to `ok@me.com` and passed an allow-list of
`['ok@me.com']`, while `build_send_body` wrote the unsplit string into `To`, so Gmail delivered to
both. The second gate behind the approval card checked one thing and sent another.

## Decision

- One item of `to` or `cc` is exactly one address.
- `check_egress` refuses a value that the stdlib `email.utils.getaddresses` parses to more than
  one address or to none, whose parsed address is not the whole of what the value says, or that
  carries CR or LF. The reason names the value and asks for one address per item. Such a value is
  never split and partly sent.
- The `To` and `Cc` headers are built only from the bare addresses that one parse yields
  (`connectors/addresses.py`, shared by the gate and the provider), so the addresses checked are
  the addresses sent. A value the parse refuses raises in `build_send_body` as defence in depth.
- A display name stays legal, including a quoted one with a comma: `"Doe, Jane" <jane@x.com>` is
  one address. The display name is not sent.
- No `strict` keyword is used, as Python 3.11 is supported.

## Consequences

A model that wants two recipients lists two items, as the schema already says. The card shows the
raw string, which now always equals the one address that will receive the mail. The display name
a person wrote is dropped from the header. A rare legal address the stdlib parser cannot read,
such as a quoted local part with spaces, is refused rather than guessed at.

## Alternatives that lost

- **Split the string and check each part.** The card shows the raw string, and a split would send
  to addresses a person may not have read as separate recipients.
- **Check only, and send the raw string.** Leaves the checked and the sent values free to differ.
- **`getaddresses(strict=True)`.** Not available on every supported Python.
