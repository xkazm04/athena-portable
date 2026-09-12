"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@athena/demo-kit/ui";

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <AppShell
      appName="Demo app"
      tagline="Template - copy me, rename me, give me a domain"
      nav={[
        { href: "/", label: "Records", active: pathname === "/" },
        { href: "/activity", label: "Activity", active: pathname === "/activity" },
      ]}
    >
      {children}
    </AppShell>
  );
}
