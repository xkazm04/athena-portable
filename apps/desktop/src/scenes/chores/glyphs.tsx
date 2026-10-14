/** The area glyphs — README section 3.5, ADR 0096: a 2D line glyph per area, drawn here (20 by 20, stroke only, currentColor). */
import type { CategoryId } from "@/lib/playbook-taxonomy";

const PATHS: Record<CategoryId | "all", string[]> = {
  all: ["M3 3h6v6H3z", "M11 3h6v6h-6z", "M3 11h6v6H3z", "M11 11h6v6h-6z"],
  health: ["M10 17s-6-3.6-6-8a3.2 3.2 0 0 1 6-1.6A3.2 3.2 0 0 1 16 9c0 4.4-6 8-6 8z", "M5 10h2.5l1.2-2 1.8 4 1.2-2H15"],
  freight: ["M2 5h10v9H2z", "M12 8h3.5L18 11v3h-6", "M5.5 16.5a1.5 1.5 0 1 0 0-.01", "M14.5 16.5a1.5 1.5 0 1 0 0-.01"],
  commerce: ["M4 7h12l-1 10H5z", "M7.5 7V5.5a2.5 2.5 0 0 1 5 0V7"],
  employment: ["M3 7h14v9H3z", "M7.5 7V5h5v2", "M3 11h14"],
  consumer: ["M5 2.5h10v15l-2-1.3-1.7 1.3L10 16.2l-1.3 1.3L7 16.2l-2 1.3z", "M7.5 6.5h5", "M7.5 9.5h5", "M7.5 12.5h3"],
  benefits: ["M10 2.5l6 2.3v4.7c0 3.7-2.6 6.4-6 8-3.4-1.6-6-4.3-6-8V4.8z", "M7.3 10l2 2 3.6-4"],
  housing: ["M3 9.5L10 3.5l7 6", "M5 8v8.5h10V8", "M8.5 16.5v-4.5h3v4.5"],
  public: ["M2.5 7L10 3l7.5 4z", "M4.5 8.5v6", "M8 8.5v6", "M12 8.5v6", "M15.5 8.5v6", "M2.5 16.5h15"],
  construction: ["M3 14h14", "M4.5 14a5.5 5.5 0 0 1 11 0", "M8.5 9V6.5h3V9", "M3 16.5h14"],
  family: ["M6.5 7a2 2 0 1 0 0-.01", "M13.5 6a2.3 2.3 0 1 0 0-.01", "M3 16.5v-2.5a3.5 3.5 0 0 1 7 0v2.5", "M10 16.5V14a3.5 3.5 0 0 1 7 0v2.5"],
};

export default function Glyph({ id, size = 20 }: { id: CategoryId | "all" | null; size?: number }) {
  const paths = PATHS[id ?? "all"];
  return (
    <svg
      className="pa-glyph"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
