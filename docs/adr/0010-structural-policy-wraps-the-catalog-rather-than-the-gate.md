# 0010. Structural policy wraps the catalog rather than entering the gate

Date: 2026-09-12

## Context

Three refusals in this build are decided from a call's *shape* rather than its parameters, and no
validator can see any of them.

A host tool belongs to one application. README §3.4 gives every page's tools the origin
`host:<app_id>`, and a turn is raised on one tab; a turn pinned to the invoicing app must not be
able to call the support inbox's own tools by naming them. A connector tool is callable only while
the vault says its connection is live, and README §4 fixes that as a per-call question: "a
disconnect takes effect on the next call". And a tool that is not masked into this lane has no
business being addressable from it at all.

None of the three is a fact about the parameters a model passed. A validator is handed
`(params, ctx)` and is registered per tool, so writing these as validators means the same three
checks are appended to every entry the catalog builds — and a manifest merge that forgets one is a
page that can reach into another page's tools, with nothing in review to catch it.

Two obvious places to put them instead, and both are worse.

**Inside `GateHook`.** The gate is one page of code and it is the one page a reviewer reads to
answer "can this execute?". Adding an origin comparison, a lane mask and a vault call to it makes
the gate the place where policy accumulates, and the next structural rule after these three goes
in the same method. A gate that grows special cases is a gate nobody reads in one sitting, which is
how the invariant it exists to hold stops being checkable.

**Inside `Catalog` itself.** `core/catalog.py` is stdlib-only and states the class decision
(ADR 0004); a liveness check is a call into a vault, which is I/O, and the catalog is the one
module that must stay a pure statement of what exists and what class it is.

## Decision

Structural policy is a separate module, `athena/harness/policy.py`, and it reaches the gate through
the port the gate already depends on.

A `Rule` has a validator's signature and refuses with a member of `ERROR_REASONS`.
`StructuralPolicy` is an ordered tuple of them and the first refusal wins, so a name refused for
the wrong cause is impossible: the lane mask is asked before the origin, because "not addressable
here" and "belongs to another application" are different sentences and only one of them is true.

`PolicyCatalog` implements `CatalogPort` over a real catalog. `validate` runs the rules and then
delegates; `classify` delegates untouched, because a structural rule may refuse a call and must
never change what class a tool is. `for_lane` filters once the catalog is bound to a turn with
`for_ctx`, so the capability block names only what this turn may actually call — a prompt that
teaches a tool and then refuses it when the model takes the offer is a prompt that lies.

The gate is not modified. `GateHook` asks its `CatalogPort` the same three questions it asked
before, and the answers now carry policy.

`foreign_token` is deliberately left unminted. It belongs to the minted refs the generic hands hand
out in P6, where a ref issued for one session arriving in another is a real and distinct failure;
spending the reason on a connector that is merely disconnected would leave that one with no name.

## Consequences

A structural rule is added by appending to a tuple, and it applies to every entry in the catalog at
once — including entries merged from a manifest after the policy was built. The rules are pure
functions of `(entry, params, ctx)`, so each is tested on its own with no gate, no catalog and no
SQLite.

`PolicyCatalog` forwards `render_capabilities`, which `CatalogPort` does not declare — the prompt
composer's own narrow catalog port does. That is the cost of the wrapper: it satisfies two ports
that were written separately, and the forward is explicit and named rather than a `__getattr__`
that would forward anything.

A catalog behind the wrapper that offers no `get` is scanned lane by lane to find an entry by name.
That is only reached by a fake in a test; the real catalog has `get`.

With one lane in `Lane`, `lane_enabled` has no reachable refusal today. It is written and asserted
on its accept path anyway, because a second lane is a plausible later commit and a mask nothing
consults is a mask that is wrong the first time it matters.
