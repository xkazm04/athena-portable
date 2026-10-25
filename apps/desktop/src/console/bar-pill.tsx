/**
 * Where she works, in Main's bar — README section 3.5, ADR 0225.
 *
 * The project pill on the spaces store, at the bar's right end before the window buttons: Main is
 * where the person switches Project most, and the list ("All projects") is one press away. A lazy
 * chunk off the first frame, as the due notice is: the bar is drawn before the list has answered
 * anyway, and the pill's menu and rules are not first-paint weight (`scripts/first-paint.mjs`).
 */
import ProjectPill from "@/components/ProjectPill";
import type { Path } from "@/depth/model";
import { useSpaces } from "@/stores/spaces";

export default function BarPill({ go }: { go: (to: Path) => void }) {
  const spaces = useSpaces((s) => s.spaces);
  const activeId = useSpaces((s) => s.activeId);
  const pending = useSpaces((s) => s.pending);
  const setActive = useSpaces((s) => s.setActive);
  return (
    <ProjectPill
      spaces={spaces}
      activeId={activeId}
      pending={pending}
      onPick={setActive}
      onAll={() => go({ root: "projects" })}
    />
  );
}
