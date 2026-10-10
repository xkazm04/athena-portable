# Accepted gaps (will not re-surface)

- The demo studio (Halden, Mira, Northwind, Kestrel, Pinegrove, Solstice) is fictional by design.
- The three example apps are scratch hosts, not real apps (README section 8).
- Voice needs a backend and a microphone; absent here, it degrades honestly (ADR 0019/0020).
- No real provider is used for connectors. The fake-provider journey (`tests/e2e/test_connectors_journey.py`, J6) covers connect, read, approve, send, decline and revoke through the daemon's real routes; a send to a real Gmail or Notion workspace is not exercised.
