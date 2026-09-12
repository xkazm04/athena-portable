/**
 * The raw material the seed assembles CVs from: two roles, five criteria each, and a pool of
 * experience sentences per criterion.
 *
 * The pools are the whole trick. A criterion scores by finding its own keywords in the applicant's
 * prose, so which sentences an applicant gets decides their scorecard - which lets the seed place
 * the six borderline applicants exactly, on every machine.
 *
 * What is deliberately absent: age, gender, nationality, photographs, schools, graduation years,
 * and any word that stands in for one. Nothing here is a proxy for a protected attribute.
 */
export interface CriterionSeed {
  id: string;
  name: string;
  description: string;
  weight: number;
  keywords: string[];
  /** Experience sentences that carry this criterion's keywords and no other criterion's. */
  lines: string[];
}

export interface RoleSeed {
  id: string;
  title: string;
  team: string;
  brief: string;
  question: string;
  headlines: string[];
  intros: string[];
  closings: string[];
  answerTails: string[];
  criteria: CriterionSeed[];
}

export const ROLE_SEEDS: RoleSeed[] = [
  {
    id: "role_backend",
    title: "Backend Engineer",
    team: "Platform",
    brief:
      "Owns the ingest and scheduling services. First six months: split the job runner out of the monolith, and keep the on-call load flat while doing it.",
    question: "Describe a system you kept running when it was under more load than it was built for.",
    headlines: [
      "Server-side engineer, mostly queues and correctness.",
      "I like the boring parts of production.",
      "Backend engineer. Small teams, long-lived systems.",
      "Ten years of making other services stop paging.",
      "I build the thing behind the thing.",
    ],
    intros: [
      "I have spent the last {years} years writing server software, most recently at {company}, where the work was steady and the incidents were mine.",
      "{years} years of backend work, the last three at {company} on a team of six shipping to other engineers.",
      "Backend engineer, {years} years in. Most of that at {company}, on systems that had already outlived their first design.",
    ],
    closings: [
      "Outside work I keep one small open-source library alive and answer its issues most weeks.",
      "I am looking for a team where the hard part is the problem rather than the process.",
      "I would rather join something half-built and finish it than arrive after the interesting decisions are made.",
    ],
    answerTails: [
      "It held, but only because we had decided in advance what we were willing to drop.",
      "The fix was unglamorous and it took a fortnight.",
      "Nobody outside the team noticed, which was the point.",
    ],
    criteria: [
      {
        id: "b_dist",
        name: "Distributed systems",
        description:
          "Has run work that spans machines and survived the failure modes that come with it.",
        weight: 3,
        keywords: ["distributed", "replication", "sharding", "consensus", "partition"],
        lines: [
          "Rebuilt the order pipeline as a set of distributed services with replication across two regions.",
          "Owned the sharding strategy when the primary store outgrew a single node.",
          "Introduced a consensus-backed leader election so scheduled work ran exactly once.",
          "Handled partition behaviour explicitly: reads degraded, writes buffered, nothing silently dropped.",
        ],
      },
      {
        id: "b_test",
        name: "Testing discipline",
        description: "Writes the tests that catch the failure, not the tests that raise the number.",
        weight: 2,
        keywords: ["tests", "test suite", "coverage", "property-based", "regression"],
        lines: [
          "Grew the test suite from smoke checks to property-based cases around the pricing rules.",
          "Coverage was never the goal; the tests that mattered were the ones that caught a regression before release.",
          "Wrote characterisation tests before touching a decade-old billing module.",
          "Every bug fix landed with a failing case and the regression it prevented.",
        ],
      },
      {
        id: "b_api",
        name: "API design",
        description: "Designs interfaces other teams can hold onto while they change underneath.",
        weight: 2,
        keywords: ["API", "endpoint", "versioning", "contract"],
        lines: [
          "Designed the public API for the payments integration, including its versioning policy.",
          "Split one overloaded endpoint into three, each with a contract the callers could read.",
          "Kept a deprecation window on every breaking API change, with callers migrated before removal.",
          "The contract came first: shape agreed with the consuming teams, then the implementation.",
        ],
      },
      {
        id: "b_ops",
        name: "Operational ownership",
        description: "Carries the pager for what they ship and improves what wakes them up.",
        weight: 3,
        keywords: ["on-call", "incident", "observability", "SLO", "runbook"],
        lines: [
          "Carried the on-call pager for the ingest service for two years.",
          "Led the incident review after a four-hour outage and rewrote the runbook that missed it.",
          "Added observability that made the slow path obvious instead of arguable.",
          "Set an SLO the team could actually hold, then defended it in planning.",
        ],
      },
      {
        id: "b_comm",
        name: "Collaboration",
        description: "Makes the rest of the team faster, in writing and in person.",
        weight: 2,
        keywords: ["design doc", "mentored", "pairing", "code review", "workshop"],
        lines: [
          "Wrote the design doc that settled a six-month argument about the job boundary.",
          "Mentored two juniors through their first production launch.",
          "Ran a weekly pairing session that halved the time new joiners took to ship.",
          "Made code review a teaching surface rather than a gate.",
        ],
      },
    ],
  },
  {
    id: "role_designer",
    title: "Product Designer",
    team: "Product",
    brief:
      "Owns onboarding and the settings surface. First six months: one research pass on why accounts stall in week two, then the redesign that follows from it.",
    question: "Tell us about a design decision you reversed, and what changed your mind.",
    headlines: [
      "Product designer. I ship, then I watch people use it.",
      "Interfaces for people who did not ask to be here.",
      "Designer, close to engineering, allergic to slide decks.",
      "I make the second version, the one that is actually usable.",
      "Product design, with the evidence still attached.",
    ],
    intros: [
      "I have designed product interfaces for {years} years, most recently at {company}, sitting inside the engineering team rather than beside it.",
      "{years} years in product design. The last stretch at {company}, where I owned one surface end to end.",
      "Designer, {years} years in, most of it at {company} on a product with more users than it had answers for.",
    ],
    closings: [
      "I read the support queue every Monday. It is the cheapest signal there is.",
      "I want to work somewhere the design and the code are the same conversation.",
      "I am at my best on a product that already has users and does not yet have shape.",
    ],
    answerTails: [
      "I was wrong for about three weeks, which is roughly the right amount of time.",
      "The change cost us a sprint and saved the launch.",
      "It is the decision I bring up whenever someone is certain too early.",
    ],
    criteria: [
      {
        id: "d_craft",
        name: "Interaction craft",
        description: "The detail level: states, focus order, what happens when it goes wrong.",
        weight: 3,
        keywords: ["interaction", "affordance", "hierarchy", "keyboard", "accessibility"],
        lines: [
          "Rebuilt the booking flow around one interaction per screen, with a clear hierarchy on each.",
          "Made the whole editor reachable by keyboard before it shipped.",
          "Treated accessibility as a constraint on the first sketch, not an audit at the end.",
          "Every affordance in the toolbar says what it does before you press it.",
        ],
      },
      {
        id: "d_research",
        name: "Research practice",
        description: "Talks to the people who use it, and changes the work when they say something.",
        weight: 3,
        keywords: ["research", "usability", "interviews", "diary study", "participants"],
        lines: [
          "Ran fifteen usability sessions on the onboarding and cut two steps nobody understood.",
          "Recruited participants from the support queue rather than the friendliest customers.",
          "Turned six weeks of interviews into three problem statements the team still uses.",
          "Kept a diary study running through the beta so the changes had evidence behind them.",
        ],
      },
      {
        id: "d_system",
        name: "Systems thinking",
        description: "Builds the parts once and makes them hold up across the product.",
        weight: 2,
        keywords: ["design system", "tokens", "component library", "primitives"],
        lines: [
          "Built the design system that replaced four divergent button styles with one set of tokens.",
          "Maintained the component library as a product, with a changelog and an owner.",
          "Reduced the palette to a set of primitives the engineers could hold in their heads.",
          "Named the tokens after their job rather than their colour.",
        ],
      },
      {
        id: "d_proto",
        name: "Prototyping",
        description: "Answers questions with something clickable instead of an argument.",
        weight: 2,
        keywords: ["prototype", "clickable", "Figma", "spike"],
        lines: [
          "Prototype first, always: a clickable version existed before the first walkthrough.",
          "Built the motion spike in plain HTML because Figma could not answer the question.",
          "Used a rough prototype to kill a feature in week one instead of month four.",
          "Kept a clickable build of every open question in the sprint.",
        ],
      },
      {
        id: "d_writing",
        name: "Written communication",
        description: "Can put the reasoning on paper so the decision survives the meeting.",
        weight: 2,
        keywords: ["case study", "rationale", "documented", "critique", "narrative"],
        lines: [
          "Wrote the case study that convinced the board to fund the redesign.",
          "Documented the rationale for every rejected direction, not only the chosen one.",
          "Ran critique from a written brief so the conversation started at the problem.",
          "Framed the work as a narrative the support team could retell.",
        ],
      },
    ],
  },
];

/** Neutral connective prose. Nothing here carries a criterion keyword. */
export const SECTION_LEADS = [
  "Most recently:",
  "In the last role:",
  "The work I would point at:",
] as const;

export const EARLIER_LEADS = [
  "Earlier, on a smaller team:",
  "Before that:",
  "Two roles back, with far less around me:",
] as const;
