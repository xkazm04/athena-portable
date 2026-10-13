# Scan lenses — reference for /scan-sweep

One section per lens. `Match` is the same keyword rule the Personas app uses
to bundle lenses for a context — apply it to the context's attributes when no
explicit `--lenses` list was passed.

## code-optimizer — Code Optimizer ⚡

Group: technical
Match: `/performance|render|bundle|query|slow|cache|optim/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Identifies performance bottlenecks and optimization opportunities

Anchor examples:
- Reduce bundle size
- Optimize database queries
- Improve render performance

## security-auditor — Security Auditor 🔒

Group: technical
Match: `/auth|login|token|secret|password|credential|session|encrypt|permission/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Identifies security vulnerabilities and best practice violations

Anchor examples:
- XSS prevention
- SQL injection risks
- Authentication gaps

## architecture-analyst — Architecture Analyst 🏗️

Group: technical
Match: `/architect|module|component|layer|service|pattern|coupling|abstract/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Evaluates system architecture and suggests structural improvements

Anchor examples:
- Reduce coupling
- Improve modularity
- Better separation of concerns

## test-strategist — Test Strategist 🧪

Group: technical
Match: `/test|spec|coverage|mock|assert|e2e|integration|unit/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Identifies gaps in test coverage and suggests testing strategies

Anchor examples:
- Missing edge cases
- Integration test gaps
- E2E scenarios

## dependency-auditor — Dependency Auditor 📦

Group: technical
Match: `/package|dependency|import|library|version|npm|cargo/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Analyzes dependencies for updates, vulnerabilities, and bloat

Anchor examples:
- Outdated packages
- Unused dependencies
- Version conflicts

## ux-reviewer — UX Reviewer 🎨

Group: user
Match: `/ui|ux|component|page|view|form|modal|button|layout|style/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Reviews user experience patterns and suggests improvements

Anchor examples:
- Loading states
- Error handling UX
- Navigation clarity

## accessibility-checker — Accessibility Checker ♿

Group: user
Match: `/a11y|accessibility|aria|wcag|screen.?reader|keyboard|contrast/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Identifies accessibility issues and WCAG compliance gaps

Anchor examples:
- Missing ARIA labels
- Color contrast
- Keyboard navigation

## mobile-specialist — Mobile Specialist 📱

Group: user
Match: `/mobile|responsive|viewport|touch|swipe|tablet/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Evaluates mobile experience and responsive design

Anchor examples:
- Touch targets
- Viewport handling
- Mobile performance

## error-handler — Error Handler 🚨

Group: user
Match: `/error|exception|catch|boundary|fallback|retry|toast|alert/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Reviews error handling, recovery flows, and user messaging

Anchor examples:
- Graceful degradation
- Retry logic
- Error boundaries

## onboarding-designer — Onboarding Designer 🎯

Group: user
Match: `/onboard|wizard|setup|welcome|tutorial|getting.?started/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Evaluates first-time user experience and onboarding flows

Anchor examples:
- Setup wizards
- Progressive disclosure
- Empty states

## feature-scout — Feature Scout 🔭

Group: business
Match: `/feature|roadmap|missing|todo|placeholder|future/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Identifies missing features and enhancement opportunities

Anchor examples:
- Competitive features
- User-requested features
- Market gaps

## monetization-advisor — Monetization Advisor 💰

Group: business
Match: `/billing|payment|subscription|plan|pricing|tier|premium/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Suggests revenue optimization and pricing strategies

Anchor examples:
- Premium features
- Usage limits
- Conversion funnels

## analytics-planner — Analytics Planner 📊

Group: business
Match: `/analytics|tracking|event|metric|telemetry|log/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Plans analytics instrumentation and data collection

Anchor examples:
- Event tracking
- Funnel analysis
- User behavior insights

## documentation-auditor — Documentation Auditor 📝

Group: business
Match: `/doc|readme|comment|api.?doc|jsdoc|guide/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Reviews documentation completeness and quality

Anchor examples:
- API docs
- README quality
- Code comments

## growth-hacker — Growth Hacker 🚀

Group: business
Match: `/share|referral|invite|social|viral|notification/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Identifies growth opportunities and viral mechanics

Anchor examples:
- Sharing features
- Referral programs
- Network effects

## tech-debt-tracker — Tech Debt Tracker 🏦

Group: mastermind
Match: `/debt|legacy|workaround|hack|deprecated|fixme|todo/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Catalogs technical debt and prioritizes repayment

Anchor examples:
- Legacy code
- Missing abstractions
- Workarounds

## innovation-catalyst — Innovation Catalyst 💡

Group: mastermind
Match: `/ai|ml|machine.?learn|llm|agent|automat|innovat/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Suggests innovative approaches and paradigm shifts

Anchor examples:
- AI integration
- New architectures
- Emerging patterns

## risk-assessor — Risk Assessor ⚠️

Group: mastermind
Match: `/risk|single.?point|scale|failover|backup|disaster|recovery/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Identifies project risks and mitigation strategies

Anchor examples:
- Single points of failure
- Scaling risks
- Data loss scenarios

## integration-planner — Integration Planner 🔗

Group: mastermind
Match: `/api|webhook|integration|sync|external|third.?party|oauth/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Plans system integrations and API design

Anchor examples:
- Third-party APIs
- Webhook design
- Data synchronization

## devops-optimizer — DevOps Optimizer 🔧

Group: mastermind
Match: `/ci|cd|deploy|docker|pipeline|build|monitor|infra/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Optimizes build, deploy, and operations workflows

Anchor examples:
- CI/CD pipelines
- Docker optimization
- Monitoring gaps

## bounty-hunter — Bounty Hunter 🏴‍☠️

Group: technical
Match: `/exploit|vulnerab|race.?condition|edge.?case|logic.?flaw|inconsisten|data.?leak|bounty/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Scans for exploitable bugs, logic flaws, and edge cases that qualify for bug bounty programs — pricing anomalies, data inconsistencies, rule violations, race conditions, and UI/logic mismatches

Anchor examples:
- Pricing calculation errors
- Race conditions in state updates
- Inconsistent validation rules
- Edge cases in boundary logic
- Data leaks between user contexts

## business-strategist — Business Strategist 💼

Group: business
Match: `/business.?value|monetiz|conversion|retention|competitor|workflow.?friction|revenue|value.?prop/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Finds pure business-value opportunities: monetization, conversion, user retention, missing features competitors have, pricing/packaging surfaces, and workflow friction that costs users money or time. Thinks like a product manager, not an engineer — proposes WHAT to build for value, not refactors.

Anchor examples:
- Add usage-based billing tier
- Reduce onboarding drop-off step
- Export reports customers ask for
- Surface ROI metrics on dashboard

## visual-craft — Visual Craft 🖌️

Group: user
Match: `/ui|design|layout|component|style|token|theme|typography|spacing|css|tailwind|chrome|panel|card/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Judges how a surface LOOKS against the design system it belongs to — the half `ux-reviewer` does not own. Hierarchy that does not rank (two things at one weight when one is the point), spacing off the scale, an ad-hoc color/border/radius where a semantic token exists, sibling surfaces whose chrome disagrees, a control whose size or prominence misstates its consequence. The test is not "is this pretty" but "does this obey the system the rest of the product obeys, and does its emphasis match its importance" — both of which are checkable against the repo's own tokens and its neighbouring surfaces

Anchor examples:
- Ad-hoc color where a semantic token exists
- Two sibling panels with different card chrome
- A destructive action styled identically to a benign one

## state-coverage — State Coverage 🕳️

Group: user
Match: `/state|empty|loading|skeleton|fallback|offline|first.?run|quota|limit|degraded|error|retry/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Enumerates every state a surface can actually enter — empty, first-run, loading, partial, error, unauthorized, over-quota, degraded-dependency, stale — and finds the ones nobody designed. The characteristic failure is not a crash: it is a screen that renders as though nothing is wrong. For each data source ask the three questions separately: what shows when it returns ZERO rows, when it FAILS, and when it NEVER RETURNS — and treat any two of those rendering identically as the finding

Anchor examples:
- An empty list that renders as a successful screen
- A load failure indistinguishable from no data
- A spinner with no timeout and no failure state

## copy-auditor — Copy Auditor ✍️

Group: user
Match: `/copy|label|message|text|wording|microcopy|tooltip|placeholder|error|notice|empty/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Reads the words the product says to a person, as code that ships to a human. Three defects in descending cost: copy asserting a behaviour the code no longer has — a stale capability claim is worse than silence, because a reader trusts it and acts on it; a message that MISDIRECTS, naming a cause that is not this one or prescribing a remedy that cannot help (a transient write failure reported as "not found" tells the user to stop when they should retry); and terminology that drifts between two surfaces for one concept. Treat a wrong sentence with the seriousness of a wrong branch

Anchor examples:
- UI copy describing a mechanism that was removed
- "Not found" for a write that actually failed
- Two names for one concept across sibling panels

## observability-auditor — Observability Auditor 🔭

Group: technical
Match: `/log|audit|trace|metric|telemetry|monitor|debug|catch|swallow|silent|record/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Asks the operator's question: when this goes wrong unattended, what will exist afterwards to say so? Hunts swallowed errors (an empty catch on a path whose failure changes an outcome), privileged or irreversible acts with no audit row, a failure path that returns BEFORE the record its success path writes — so the outcome most needing evidence is the one that leaves none — and counters that only reconcile when everything worked. Distinct from `analytics-planner`, which measures the product: this asks whether a FAILURE leaves a trace

Anchor examples:
- A catch that discards the only signal of a failure
- A privileged mutation with no audit row
- A failure path that skips the history write its success path makes

## parity-auditor — Parity Auditor ⚖️

Group: technical
Match: `/valid|gate|guard|sync|mirror|client|server|dual|sibling|normal|both|pair/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Hunts ONE rule with TWO implementations where only one was fixed — the class that survives every other lens, because each site reads correct in isolation and only the pair is wrong. Client validation against server; a gate against the debit it guards; a normalizer applied on every read and not on the write; two verbs of one route enforcing different contracts; a doc's stated rule against the code. The method is inverted from the other lenses: do not grep for a defect shape, grep for the SHARED SYMBOL and diff its call sites. On a codebase already swept a few times this is the highest-yield lens in the package, and the signal to stop a given grep is the SECOND clean result, not the fifth

Anchor examples:
- A normalizer on every read and none on the write
- Two verbs of one route, only one shape-checking its input
- A required argument passed at two of nine call sites

## registry-conformance — Registry Conformance 📚

Group: technical
Match: `/registry|golden.?path|technique|convention|standard|doctrine|ai-registry/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

Compares the code against the organization's AI-registry knowledge (golden paths, techniques, applications) that governs this context and turns each named deviation into a backlog item carrying the technique it violates and the prescribed fix. Only meaningful when the repo declares a registry; otherwise reports nothing

Anchor examples:
- Adopt the registry's stale-response guard technique
- Replace hand-rolled retry with the governed pattern
- Record a deviation the standard names

## architecture-challenger — Architecture Challenger 🧗

Group: challenge
Match: none — runs only under `--challenge` (slot A), never in another strategy's package, and does not count toward the coverage denominator

Names the ONE structural move that would stop this context being the reason something else is hard, and argues it from the tree. Not a smell list and not "reduce coupling": a specific seam with its cost counted — the rule implemented twice that should be one module, the synchronous path that should be a job, the hand-maintained list that should be derived from its ground truth, the state machine hiding in booleans, the store call leaking through three layers. The card is M or L, carries a declared write set and 3-8 behaviour cases a builder writes as failing tests first. A move whose benefit cannot be written as cases is not a card yet

Anchor examples:
- Collapse two implementations of one rule into one module with a contract test
- Replace a boolean cluster with an explicit state machine and its transition table
- Derive a hand-maintained registry from the ground truth it mirrors

## ux-elevation — UX Elevation 🪜

Group: challenge
Match: none — runs only under `--challenge` (slot B), never in another strategy's package, and does not count toward the coverage denominator

The experience LEAP, not a polish: the flow that takes five steps and should take one, the decision a user makes blind although the app already holds the data, the surface that reports a state it should let you act on, the missing mode (compare, bulk, undo, preview, resume). Judged from the user's job, then grounded in the code that would carry it — the data is already there, or the card says where it comes from. The acceptance cases are the logic under the surface (the state it enters, the action it enables, the call it makes) plus one journey where the repo can drive a browser. Both themes, all locales and the repo's design system bind the build exactly as they bind any other UI change

Anchor examples:
- Turn a read-only status panel into the place the next action is taken
- Add a compare mode over records the user today opens one at a time
- Put the evidence behind a score next to the score, where the decision is made

<!-- Lenses 1-23 were generated from personas' scan_agents.toml by
     scripts/skills/scan-agents-to-skills.mjs; that generator lives in the Personas repo and writes
     into ITS tree, never into this one, so THIS FILE IS THE SOURCE for /scan-sweep and is edited by
     hand. Adding a lens here does not reach the Personas app's own scanner — mirror it into that
     TOML if the two should agree. -->

## ui-perfectionist — UI Perfectionist ✨

Group: user
Match: `/ui|css|style|layout|component|scene|motion|transition|animation|spacing|theme|panel|view/i` (against the context's name, description, keywords, tech stack, API surface, and file paths)

The project-local lens this repo adds (not in the shared registry copy). It reads one surface the way a person with a ruler and a stopwatch would, and owns what `visual-craft` and `ux-reviewer` leave between them: spacing off the token scale or inconsistent between siblings (a 10px where the scale says 8 or 12, uneven gaps in one row, padding that differs by one pixel between twin controls), alignment and baseline slips, a hard clip or layout jump where content arrives, a state change with no transition or a transition on the wrong property (anything but transform and opacity in a hot path, `transition: all`, a duration or easing that is not a motion token), enter without exit, focus and hover states that jump, reduced-motion and Calm paths that leave a surface broken, and a flow with one click too many or no feedback after one. Every claim is checkable from the CSS and the component: the value, the token it should be, the sibling it disagrees with

Anchor examples:
- A gap or padding off the spacing scale, or different between two sibling rows
- A state swap (empty to loaded, open to closed) that jumps instead of easing
- A hover or focus state with no transition while its siblings have one
- A control whose size, weight or position misstates its importance
