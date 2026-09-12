"""Per-provider request shapes and answer parsing (README §4; ADR 0021).

Every module here is pure in the one way that matters: it builds a URL and a body and reads an
answer apart, and it never holds a credential, opens a socket or imports the vault. The one
outbound door is the ``Request`` callable a provider is handed — the vault's own ``request`` —
which attaches the credential, refuses a host outside the spec and caps the answer.

A provider's ``execute`` returns the plain text of a read or the one sentence of a write. The
fence, the cap and the gate around it belong to :mod:`athena.connectors.service`.
"""

from athena.connectors.providers import gmail, notion

__all__ = ["gmail", "notion"]
