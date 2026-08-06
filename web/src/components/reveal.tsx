"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Reveals its children when they scroll into view.
 *
 * Designed so the worst failure is "no animation", never "invisible content".
 * Content starts VISIBLE and is only hidden once the client has confirmed it is
 * below the fold and an observer is watching it. Anything that goes wrong -
 * no IntersectionObserver, reduced-motion, a jump-scroll that skips the element
 * past the viewport, a hydration hiccup - leaves the content on screen.
 *
 * That last case is not hypothetical: jumping straight to the bottom of the page
 * (deep link, anchor, restored scroll position) moves mid-page elements from
 * below the viewport to above it without ever intersecting, so an
 * intersection-only implementation would strand them permanently hidden.
 * The visibility check on every scroll, plus a failsafe timer, covers it.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  /** Stagger in ms, to cascade siblings rather than popping them together. */
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<"visible" | "armed" | "revealed">("visible");

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") return; // stay visible

    // Above the fold on first paint: never hide it, so nothing flashes.
    if (node.getBoundingClientRect().top < window.innerHeight * 0.85) return;

    setPhase("armed");

    let settled = false;
    const reveal = () => {
      if (settled) return;
      settled = true;
      setPhase("revealed");
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      clearTimeout(failsafe);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) reveal();
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );
    observer.observe(node);

    // Catches elements the observer skipped past during a jump-scroll: if the
    // element is anywhere at or above the viewport bottom, it has been seen.
    const onScroll = () => {
      const rect = node.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) reveal();
      else if (rect.bottom <= 0) reveal(); // scrolled past entirely
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    // Last resort: content is never left hidden, whatever happened.
    const failsafe = setTimeout(reveal, 3000);

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      clearTimeout(failsafe);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`${phase === "armed" ? "reveal" : phase === "revealed" ? "reveal-in" : ""} ${className}`}
      style={phase === "revealed" && delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
