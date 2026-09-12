"use client";

/**
 * Every capability this app offers an agent, in one place.
 *
 * The app ships without Athena; these are registered and waiting (design 4.6), on
 * `document.modelContext` through `@athena/demo-kit/webmcp` rather than in a chat the app hosts
 * itself. This is the seam three of the four reference apps use (hirelane, ledgerbox, tidycrm) and
 * the one the Athena side panel reads. A browser agent speaks the standard natively and applies
 * the design 5.1 rule from the annotations `useWebMCPTool` writes - `consequentialHint` is GATED,
 * `readOnlyHint` is AUTO, unknown is gated.
 *
 */
import { usePathname, useRouter } from "next/navigation";
import { useWebMCPTool } from "@athena/demo-kit/webmcp";
import { VIEWS, routeFor, type View } from "@/lib/constants";

function viewFor(pathname: string): View {
  if (pathname.startsWith("/activity")) return "activity";
  if (pathname === "/") return "list";
  return "detail";
}

export function HostCapabilities() {
  const router = useRouter();
  const pathname = usePathname();
  const view = viewFor(pathname);

  // A handler has to reach every member of its own enum, and a request it will not serve has to
  // come back as a refusal rather than as a success string. `detail` is a real route
  // (`app/[id]/page.tsx`) that needs a record id, so `id` is part of the schema; without it the
  // call is refused and nothing navigates, because "Opened detail." while sitting on the list is
  // the one answer an agent cannot recover from.
  useWebMCPTool({
    name: "navigate",
    description: 'Open a view by id. "detail" also needs the record id.',
    parameters: [
      { name: "view", type: "string", enum: [...VIEWS], required: true, description: "View to open" },
      {
        name: "id",
        type: "string",
        required: false,
        description: 'Record id. Required when view is "detail"; ignored for the other views.',
      },
    ],
    reversible: true,
    sideEffects: "none",
    handler: ({ view: next, id }) => {
      const decision = routeFor(next, id);
      if (decision.ok) router.push(decision.href);
      return decision;
    },
  });

  // WebMCP has no separate readable channel, so what would have been published as ambient context
  // is a read-only tool the agent calls when it wants the answer. That is the better shape anyway:
  // a readable is stringified into every prompt whether it is needed or not; a tool is asked for.
  useWebMCPTool({
    name: "read_current_view",
    description: "The view the user is looking at right now.",
    reversible: true,
    sideEffects: "none",
    handler: () => view,
    deps: [view],
  });

  return null;
}
