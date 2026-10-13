# Fathom

## Philosophy
The app's complexity sits in depths, not tabs. Athena is a light in deep water: a bell drawn in SVG, with one tendril for each app or account she may touch. The surface holds her, the conversation and the slips waiting for your signature. Apps, Chores, Accounts, Voice, Mind and Ledger are lights on the seabed below her; you dive into one and rise back out. Setup opens the same surface: choosing an engine lights her core, switching apps on lights her tendrils, a voice adds ripples, and then she wakes.

## How it stays readable at scale
- **Fixed frame.** One 16:9 frame, so 1280×800 and 2560×1440 show the same composition. Under 760 px it becomes a vertical scroll.
- **Same split at every depth.** Place and key art on the left, content on the right. A marquee shows whatever you hover in display type.
- **Always visible:** a breadcrumb, a "Rise to …" button, a depth gauge, and a dock that keeps Athena one click away. Escape always rises one level.
- **Three-move reach.** Every capability is at most three moves down, such as an app's gated `chase` tool or a chore's bench run.

## The wow moment
She rises out of the dark. Hover a layer and her tendrils lean toward it while its name fills the centre. Ask for the overdue invoices: tool calls run down the tape, her core turns pink, and a slip slides in. Press A and it is stamped APPROVED, then moves to the ledger.

## Known limits
- Sends, reconnects and installs are simulated locally, and the page labels them as simulated.
- The light theme was cut.
- Orbs on the chore field are nudged apart so labels stay readable, so their positions are approximate.
- `?fresh` replays setup; `?ready#/chores/carrier-refunds/run` deep-links.
