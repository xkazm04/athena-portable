# 0171. The capabilities block sheds detail before names

Date: 2026-10-25

Amends ADR 0070 (the capabilities block has a total bound). Implements README section 3.2 (the
two-output composer) and section 2 invariant 4 (the block is generated from the registry), beside
ADR 0068 (page and connector text is neutralised).

## Context

ADR 0070 bounds the static `capabilities` block at `CAPABILITIES_CHARS` (12,000) by a prefix cut:
foreign entries are added at full detail in the block's order (class, then name) until the next
would pass the bound, and every entry after it is cut. The same block opens by telling the model
"A name that is not listed here does not exist; asking for it is a dropped call". A cut name is
still registered and the gate accepts it, so past the bound the block told the model that tools it
could call did not exist. ADR 0070's own Consequences name the cost: an origin late in the sort,
which may be the tab the user is on, loses its names. Only the delegated-task path switches host
origins off (`daemon/routes.py`), so a normal turn renders every held host origin.

Core plus one invoices page and three manifests of eight wide tools (24 parameters each) already
cut names: one wide entry renders about 7,000 characters at full detail. The registry's
prompt-assembly standard (technique capability-documentation) holds the roster of names as the
floor and detail as elastic; `.ai/registry-map.json` recorded this as a deviation.

ADR 0070 chose a prefix over a best fit because a prefix keeps the block a pure function of the
registry that a reader can predict. It did not consider shedding detail.

## Decision

A foreign entry has three renderings: full (today's line), signature (name, parameters and cap,
no description) and bare (the registered name alone). Athena's own entries are always full.

- The tier never rises along the block's order. The render chooses split points over the foreign
  entries in that order, each the highest that fits the bound, in this sequence: if every entry
  fits at full, nothing changes; else if every entry fits at signature, the first `a` keep full
  detail and the rest are signatures; else if every entry fits bare, the first `b` are signatures
  and the rest are bare; else the first `c` are bare and the rest are cut as ADR 0070 cut them.
  Fit is measured on the rendered text itself, sentences and footer included, so nothing is
  reserved at its longest any more.
- Bare entries of one origin that are consecutive within a class share one line,
  `` - `host.a.x`, `host.a.y` ``. A bare entry carries only its registered name, which the
  manifest validator holds to the `_TOOL_NAME` slug rule, so no description, parameter label or
  enum value of it reaches the block.
- Each degraded tier is announced by a fixed, counted sentence after the class groups:
  `<k> names are listed without their descriptions: this block had room for their parameters
  only.` and `<k> names are listed by name only, one line per page or connector, without
  parameters or descriptions. Each is addressable and gated as its class says.` ADR 0070's cut
  sentence follows only for a residual cut. The `(showing N of M)` footer stays, with `N`
  counting every name listed at any tier.
- No tier changes a class, a registration or a validator. A block under the bound is byte for
  byte what it was.

## Consequences

- From four held origins to roughly forty origins of hands, the model is told every name it can
  call, the tab the user is on among them. Measured on 2026-10-25 with the test fixtures: core,
  invoices and three wide manifests of 8 render 8,885 characters, 33 of 33 names (2 signatures,
  24 bare; before, 9 of 33); four origins of 20 tools with 240-character descriptions render
  11,950 characters, 87 of 87 names at full or signature (before, 38 of 87); 20 origins of 96
  short tools still cut, but list 467 of 1,929 names bare (before, 241 of 1,929).
- The rule stays predictable and the block hash stays stable: it is a function of the registry
  in the block's order, independent of merge order.
- Monotone tiers cost some room. One wide entry that does not fit as a signature pushes every
  later entry to bare even where a short later entry would have fitted with its parameters; a
  best fit was rejected for the reason ADR 0070 gave.
- A signature or bare entry is still dispatchable, but the model may call a bare one with the
  wrong parameters; the validator refuses those as it always has. A READ `core.describe_tool`
  that returns one entry's full contract on demand is the follow-up, and needs an ADR 0004
  amendment.
- Athena's own entries sort among the foreign ones (`connector.` before `core.` before `host.`),
  so a full core line can follow a degraded connector line within a class; the monotone rule is
  over foreign entries only.
- Rendering searches the split points by bisection, rendering the block about a dozen times for
  a degraded registry; on 1,929 names that took 16 ms on the development machine.
