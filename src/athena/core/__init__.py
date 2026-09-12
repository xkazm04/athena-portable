"""The core: brain, recall, catalog, approvals, ledger, constitution, prompt (README §3.1).

Stdlib only, by ADR 0002. Nothing here imports a provider, a transport or a cloud SDK, so a brain
can be read and a gate can be run on a machine with nothing but Python installed.
"""
