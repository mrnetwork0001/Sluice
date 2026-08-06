"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ConnectButton } from "./connect-button";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/create", label: "Create Stream" },
  { href: "/payroll", label: "Payroll Run" },
  { href: "/marketplace", label: "Marketplace" },
  { href: "/treasury", label: "Treasury" },
  { href: "/automation", label: "Automation" },
  { href: "/onboard", label: "Get Paid" },
];

export function Nav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  // The landing page is a marketing surface: brand only, no app nav or wallet.
  const isLanding = pathname === "/";

  // Close the mobile menu whenever navigation happens.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const brand = (
    <Link href="/" className="flex items-center">
      <Image
        src="/sluice-wordmark.png"
        alt="Sluice"
        width={306}
        height={96}
        priority
        className="h-7 w-auto"
      />
    </Link>
  );

  if (isLanding) {
    return (
      <header className="sticky top-0 z-10 border-b border-white/[0.06] bg-[#0b0e14]/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center px-4 py-3">{brand}</div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-10 border-b border-white/[0.06] bg-[#0b0e14]/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-8">
          {brand}
          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 lg:flex">
            {links.map((link) => {
              const active = pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    active ? "bg-white/[0.07] text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="hidden lg:block">
          <ConnectButton />
        </div>

        {/* Mobile: everything collapses behind the hamburger */}
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          className="flex h-9 w-9 flex-col items-center justify-center gap-[5px] rounded-lg border border-white/10 bg-white/5 transition-colors hover:bg-white/10 lg:hidden"
        >
          <span
            className={`block h-[2px] w-4 rounded-full bg-zinc-300 transition-transform duration-200 ${
              menuOpen ? "translate-y-[7px] rotate-45" : ""
            }`}
          />
          <span
            className={`block h-[2px] w-4 rounded-full bg-zinc-300 transition-opacity duration-200 ${
              menuOpen ? "opacity-0" : ""
            }`}
          />
          <span
            className={`block h-[2px] w-4 rounded-full bg-zinc-300 transition-transform duration-200 ${
              menuOpen ? "-translate-y-[7px] -rotate-45" : ""
            }`}
          />
        </button>
      </div>

      {menuOpen ? (
        <div id="mobile-menu" className="border-t border-white/[0.06] bg-[#0b0e14] lg:hidden">
          <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3">
            {links.map((link) => {
              const active = pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    active ? "bg-white/[0.07] text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
            <div className="mt-2 border-t border-white/[0.06] pt-3">
              <ConnectButton />
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
