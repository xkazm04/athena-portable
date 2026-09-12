import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Shell } from "@/components/Shell";
import { HostCapabilities } from "@/components/HostCapabilities";
import { VARIANT } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Demo app",
  description: "Template host app for the Athena Everywhere examples. Ships without Athena.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-variant={VARIANT}>
      <body>
        <Providers>
          {/* Registers the manifest entries. Must be inside the provider, above the pages. */}
          <HostCapabilities />
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
