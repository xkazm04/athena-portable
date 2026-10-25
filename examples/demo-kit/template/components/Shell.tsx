"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@athena/demo-kit/ui";
import { APP_NAME, TAGLINE } from "@/lib/constants";

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <AppShell
      appName={APP_NAME}
      tagline={TAGLINE}
      nav={[
        { href: "/", label: "Records", active: pathname === "/" },
        { href: "/activity", label: "Activity", active: pathname === "/activity" },
      ]}
    >
      {children}
    </AppShell>
  );
}
