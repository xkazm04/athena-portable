"""The channels: every way into the daemon that is not the panel's HTTP (README §3.1, §3.5).

A channel is a transport around the one lane. It renders the channel events of
``contracts/channel.py`` for a surface HTTP does not fit — a microphone, another agent — and it
decides nothing: the gate, the approval table and the ledger are the daemon's, and a channel
carries a request to them and carries the answer back.

- :mod:`athena.channels.voice` — PCM16 over a WebSocket on the daemon's port, one backend behind
  a port, the ``TTS:`` first-line rule, barge-in, spoken answers to a card.
"""
