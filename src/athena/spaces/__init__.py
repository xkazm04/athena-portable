"""ADR 0225: projects are walled spaces - a brief, paired apps and a wall around their memory.

The files are :mod:`.book` (``<brain>/spaces/<spc_id>.md``, whole-file writes), the seams to the
stamped memory are :mod:`.memory`, the HTTP surface is :mod:`.routes`, and the frame the turn
reads is :func:`.frame.space_frame`. The wire shapes are the contract in
:mod:`athena.contracts.spaces`. Nothing is imported here, so the book can be read by the daemon
and the adopt studio without either importing the other's routes.
"""
