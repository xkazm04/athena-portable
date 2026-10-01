---
id: J5
title: Work in Main - apps, tabs, connectors, theme
promotion: discovery
characters: [mira, jonas, priya, ana]
level: L1+L2
---
# J5 - Workday in Main

**Goal.** Main is where I browse my real apps. I register an app, open several tabs, see what each page
offers her, switch theme, look at connectors, and change setup, with her window staying alive beside it.

**Definition of done.** I can register and open an app, switch between tabs, see "this page offers N tools"
and whether she has hands or tools there, flip the theme (both windows follow), see connector state honestly,
resize Main from 900x600 up, and close it knowing what happens to her.

**Surface.** Browser, Connectors, Setup modules; tab strip; `layout.rs`; theme in settings; window buttons.
**Watch for.** Closing Main quits the whole app; the page area is a native webview (nothing of hers draws over it);
900x600 layout; theme disagreement between windows; engine probe states.
