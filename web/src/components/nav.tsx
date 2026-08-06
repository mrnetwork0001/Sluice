"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  return (
    <header className="sticky top-0 z-10 border-b border-white/[0.06] bg-[#0b0e14]/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/sluice-wordmark.png"
              alt="Sluice"
              width={306}
              height={96}
              priority
              className="h-7 w-auto"
            />
            <span className="hidden rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500 ring-1 ring-inset ring-white/10 md:inline">
              Payroll on Arc
            </span>
          </Link>
          <nav className="flex items-center gap-1">
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
        <ConnectButton />
      </div>
    </header>
  );
}
