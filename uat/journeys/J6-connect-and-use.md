---
id: J6
title: Connect a service, then use it
promotion: discovery
characters: [mira, jonas]
level: L1+L2
---
# J6 - Connect, then use

**Goal.** Mira has a pile of overdue invoices and the answers are in her mail. She connects Gmail once, asks
Athena to find the overdue mail and read it, turns sending on for the one client she chases today, and approves
the reply. Jonas, who audits what leaves, wants the card, the decline and the ledger row to say exactly what
happened and nothing more.

**Definition of done.** Pasting a client id and secret and pressing Connect completes the consent flow and shows
the connection with the account's own address. A search and a read come back fenced as data. Writes are off
until Mira turns them on and names a recipient; a reply then files a card naming that recipient and the exact
parameters, and approving it sends exactly one message, to exactly that address. A recipient off the list is
refused by name and nothing leaves. Declining runs nothing and is recorded as the person's own decision. A grant
revoked upstream shows as needing a reconnect and the next call is refused. A Notion page never shared with the
integration is reported as unreadable, not invented. Connecting a second account turns writes off and empties
the list, and says so.

**Surface.** `/connectors` (`connect`, `flow`, `settings`, `disconnect`), `/run`, `/decisions`, `/ledger`; the
Connectors module and the decision slip in the desktop.
**Watch for.** The setup cost of a Google client (an accepted scope question, not tested here); a token from the
wrong account kept live with the old recipient list; a card whose recipient differs from what is sent; a read
treated as instructions; a revoked grant shown as healthy.

**Walked by** `tests/e2e/test_connectors_journey.py` against the scripted daemon with fake Gmail and Notion
(`tests/e2e/fake_providers.py`): no real provider, account or credential is used.
