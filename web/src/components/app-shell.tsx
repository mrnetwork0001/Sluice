"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Footer } from "./footer";
import { SidebarContent } from "./sidebar";

/**
 * Two layouts, one app.
 *
 * `/` is a marketing page: brand only, no app chrome, no wallet prompt before a
 * visitor has seen anything. Every other route is the product, which gets the
 * sidebar shell with a persistent Arc connection card.
 */
const COLLAPSE_KEY = "sluice.sidebarCollapsed";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const isLanding = pathname === "/";

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Remember the rail preference; an explicit choice should survive navigation
  // and reloads rather than resetting on every page.
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value;
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  };

  if (isLanding) {
    return (
      <>
        <header className="sticky top-0 z-10 border-b border-white/[0.06] bg-[#0b0e14]/85 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center px-4 py-3">
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
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        <Footer />
      </>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Desktop rail */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 border-r border-white/[0.06] bg-[#0b0e14] transition-[width] duration-200 lg:block ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        <SidebarContent collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/60 lg:hidden"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 left-0 z-40 w-64 border-r border-white/[0.06] bg-[#0b0e14] lg:hidden">
            <SidebarContent onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar: brand + hamburger, since the rail is hidden */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/[0.06] bg-[#0b0e14]/85 px-4 py-3 backdrop-blur lg:hidden">
          <Link href="/" className="flex items-center">
            <Image
              src="/sluice-wordmark.png"
              alt="Sluice"
              width={306}
              height={96}
              className="h-7 w-auto"
            />
          </Link>
          <button
            type="button"
            onClick={() => setDrawerOpen((open) => !open)}
            aria-label={drawerOpen ? "Close menu" : "Open menu"}
            aria-expanded={drawerOpen}
            className="flex h-9 w-9 flex-col items-center justify-center gap-[5px] rounded-lg border border-white/10 bg-white/5 transition-colors hover:bg-white/10"
          >
            <span className="block h-[2px] w-4 rounded-full bg-zinc-300" />
            <span className="block h-[2px] w-4 rounded-full bg-zinc-300" />
            <span className="block h-[2px] w-4 rounded-full bg-zinc-300" />
          </button>
        </header>

        {/* No footer inside the app: it duplicates the sidebar's navigation and
            is a marketing surface for visitors who have not chosen yet. */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
