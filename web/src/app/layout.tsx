import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/app-shell";

/**
 * Type is doing the identity work here, so it is chosen rather than defaulted.
 *
 * Space Grotesk for display: a grotesque with actual character in its digits and
 * terminals, so headings do not read as a framework default.
 * Inter for body: neutral and highly legible at small sizes.
 * IBM Plex Mono for every number: real tabular figures, which matters when the
 * whole product is balances, rates and addresses that must align in columns.
 */
const display = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const sans = Inter({
  variable: "--font-sans-ui",
  subsets: ["latin"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono-ui",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Sluice - Streaming Payroll on Arc",
  description:
    "Stream USDC salaries block-by-block on Arc. Split, sell, insure, and automate your income streams.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
