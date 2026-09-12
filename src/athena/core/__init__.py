"""The core: the brain, recall, the catalog, approvals, the ledger and the prompt (README §3.1).

Nothing here imports a provider, a transport or a cloud SDK — see ADR 0002. Importing this
package pulls in none of its modules, so a machine with only CPython can open a brain.
"""

from __future__ import annotations
