/**
 * @catalog The raised surface, for content that must read as one object.
 *
 * `posture` is house style §3.3 and has one spelling in the whole app: `raised` is the chosen
 * one, `flat` gives up the card fill so a raised sibling has something to be raised against, and
 * `absent` is a dashed placeholder for something that does not exist yet — the only dashed edge
 * the app allows. Three surfaces in the first build invented this independently, with three
 * elevations, three border opacities and two fills.
 */
import type { ReactNode } from "react";

export type Posture = "raised" | "flat" | "absent";

export default function SectionCard({
  title,
  note,
  posture = "raised",
  padded = true,
  action,
  children,
}: {
  title?: string;
  note?: string;
  posture?: Posture;
  padded?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  const classes = ["section-card"];
  if (posture === "flat") classes.push("section-card--flat");
  if (posture === "absent") classes.push("section-card--absent");
  if (!padded) classes.push("section-card--padless");
  return (
    <section className={classes.join(" ")}>
      {title ? (
        <header className="page-section__head" style={{ border: "none", paddingBottom: 0 }}>
          <h2 className="typo-heading">{title}</h2>
          {note ? <span className="typo-caption">{note}</span> : null}
          {action ? <span style={{ marginLeft: "auto" }}>{action}</span> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}
