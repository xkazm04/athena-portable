---
id: ana
role: Keyboard-first user with low vision; Windows at 150% scaling, high contrast at times
surface_binding: both windows, keyboard only, 125/150% scaling, light theme in sunlight
journeys: [J2, J3, J5]
motivation:
  chore: do the same weekly admin without a mouse or a magnifier
  manual_minutes: 50
  with_app_minutes: 20
senior_bar: a card she can read at 150% in light theme and answer with keys while a screen reader is on
---
# Ana (accessibility lens)

**Background.** Account manager; uses the keyboard for everything and zoom for the rest.
**Voice.** Exact. "If I have to hunt for the focus ring, the product is not finished."

## Expectations
Every control reachable by Tab with a visible focus ring; text at least 12px and 4.5:1 on its real surface;
reduced-motion honoured; a card announces itself to assistive tech and can be answered by A/D or a chord.

## Pet peeves
Focus that vanishes; a window that opens without taking or announcing focus; tiny grey labels; animation she cannot turn off.

## Scored acceptance criteria
1. Every action in both windows has a Tab path and a visible focus ring.
2. Nothing readable is under 12px; text contrast is at least 4.5:1 in both themes.
3. A card arriving is announced (live region) and can be answered without the mouse.
4. At 150% scaling no state is clipped or off-screen.
5. prefers-reduced-motion removes the unroll and pulse animation.
6. Esc always has a defined, non-destructive meaning.
