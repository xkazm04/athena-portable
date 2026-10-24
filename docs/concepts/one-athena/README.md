# One Athena on all your devices

Athena can run on more than one of your computers and still be one Athena: what she learns on one
computer, she knows on the others, and from your phone you can talk to her and answer what she asks
you. This guide is for the person setting it up. You do not need to be technical: Athena walks you
through it herself, and nothing changes on your computer until you say yes.

The design behind this is [ADR 0140](../../adr/0140-one-athena-pairs-devices-over-a-private-overlay.md).

## What you need

- **Athena on each Windows computer** you want to join, and open on each while you set up. Athena
  only reaches the other devices while her window is open.
- **A Tailscale account.** Tailscale is a free private network: it joins your own devices to each
  other, wherever they are, without opening them to the internet. Every device must use the
  **same** account. Signing in is the one step Athena cannot do for you.
- **Your phone** (optional), with the Tailscale app installed from its app store and signed in to
  that same account.

## Setting up a computer

1. In Athena, open **Mind**, then **Devices**, and choose **Set up with Athena**. A conversation
   opens that is only for setting up.
2. Athena checks what this computer already has, then asks before each change. Each change is a
   card you sign; nothing runs until you sign:
   - **Install Tailscale.** Windows may ask whether to allow the installer. Say yes.
   - **Sign in to Tailscale.** Your browser opens Tailscale's sign-in page. Sign in with the same
     account you use everywhere.
   - **Let your other devices reach Athena here.** One Windows firewall rule, for Athena's own port
     and only for your private network. Windows asks for permission.
3. Do the same on your other computer. Athena on each side tells you what the other one is waiting
   for, for example "your laptop is waiting for you to approve it on the Devices page there".

## Joining two computers

1. On the first computer, Athena opens a **pairing window** (you sign the card) and reads you a
   six-letter code. The window stays open for five minutes.
2. On the second computer, type that code on the Devices page. Athena there can tell you the first
   computer's address.
3. The first computer's Devices page asks whether to let the second one in. Approve it. You can
   narrow what it may do (chat, answer cards, share memory) before you approve.
4. The second computer then asks the same in return, on its own Devices page. Approve it there.
   Each computer only ever lets in what its own person approved on its own screen.

## Adding your phone

1. On the computer you want the phone to talk to, turn on **Let your phone reach Athena here** on
   the Devices page (or ask Athena in the setup conversation to open a pairing window for a phone).
2. Scan the QR code with your phone's camera. A page opens: give the phone a name and choose
   **Ask to pair**.
3. On the computer, approve the phone. The phone page then shows **Athena on** that computer:
   anything waiting for your answer first, then your conversation, then a box to write in.
4. To keep it handy, add the page to your home screen from your phone browser's menu.

If the phone says **Athena on (computer) is asleep - open her on that computer**, Athena's window on
that computer is closed. Open it, and the phone works again. If it says it **can't reach** the
computer, check that the computer is on and that Tailscale is signed in on both.

## What is shared, and what never leaves a device

Shared between your paired computers, when you allow memory:

- What Athena remembers: the conversations she keeps, the facts she has learnt, and the ways of
  doing things she has been taught. Each item says which computer it came from.

Never shared, on any device:

- Your approvals and their history, her record of what she spent, and open sessions.
- Your connected accounts (such as mail) and every password or key: these are locked to the one
  computer they were set up on.
- Voice installs and settings.
- Goals, cases and schedules, which stay on each computer for now.

Everything travels only over your private Tailscale network, which encrypts it between your own
devices. Nothing goes through a server of ours, and nothing is open to your home WiFi or the
internet.

## Removing a device

On the Devices page, choose **Revoke** next to the device. It takes effect at once, with no
confirmation: that device's next request is refused. To bring it back, pair it again.

To remove your phone, revoke it on the computer it talks to; the phone page then says it was
removed and forgets its key. You can also clear the page's site data in the phone's browser.

## When something does not work

- **"Not on this computer yet"**: setup steps that change the computer only run on Windows.
- **The firewall step says it was not added**: Windows asked for permission and it was not given.
  Ask Athena to try again and choose **Yes** on the Windows prompt.
- **The other computer is "asleep"**: Athena is closed there, or it is open but not waiting for
  anyone yet. Open Athena there and open a pairing window, then try again.
- **A pairing code "has closed"**: windows last five minutes. Open a new one.
