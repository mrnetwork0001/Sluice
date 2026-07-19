"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { TxStatus } from "@/lib/hooks";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5 backdrop-blur-sm ${className}`}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h3 className="text-sm font-semibold tracking-wide text-zinc-200">{children}</h3>
      {hint ? <span className="text-xs text-zinc-500">{hint}</span> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  accent = "text-zinc-100",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: string;
}) {
  return (
    <Card className="min-w-0">
      <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-1.5 truncate font-mono text-2xl font-semibold tabular-nums ${accent}`}>
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs text-zinc-500">{sub}</div> : null}
    </Card>
  );
}

const badgeStyles = {
  cyan: "bg-cyan-400/10 text-cyan-300 ring-cyan-400/25",
  emerald: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25",
  amber: "bg-amber-400/10 text-amber-300 ring-amber-400/25",
  red: "bg-red-400/10 text-red-300 ring-red-400/25",
  zinc: "bg-white/5 text-zinc-400 ring-white/10",
} as const;

export function Badge({
  children,
  tone = "zinc",
}: {
  children: ReactNode;
  tone?: keyof typeof badgeStyles;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${badgeStyles[tone]}`}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger";
  type?: "button" | "submit";
  className?: string;
}) {
  const styles = {
    primary:
      "bg-gradient-to-r from-cyan-500 to-emerald-500 text-zinc-950 hover:from-cyan-400 hover:to-emerald-400 disabled:from-zinc-700 disabled:to-zinc-700 disabled:text-zinc-500",
    ghost:
      "border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10 disabled:text-zinc-600",
    danger:
      "border border-red-400/30 bg-red-400/10 text-red-300 hover:bg-red-400/20 disabled:text-zinc-600",
  } as const;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      {children}
      {hint ? <div className="mt-1 text-xs text-zinc-500">{hint}</div> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 font-mono text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:border-cyan-400/50";

export function TxBanner({ status, onDismiss }: { status: TxStatus; onDismiss: () => void }) {
  if (status.phase === "idle") return null;
  if (status.phase === "approving" || status.phase === "confirming") {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3.5 py-2.5 text-sm text-cyan-200">
        <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
        {status.phase === "approving" ? "Approving USDC…" : "Confirming transaction…"}
      </div>
    );
  }
  if (status.phase === "success") {
    return (
      <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-3.5 py-2.5 text-sm text-emerald-200">
        <span>✓ {status.label}</span>
        <button onClick={onDismiss} className="text-emerald-400/60 hover:text-emerald-300">
          ✕
        </button>
      </div>
    );
  }
  return (
    <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-red-400/20 bg-red-400/5 px-3.5 py-2.5 text-sm text-red-200">
      <span className="min-w-0 break-words">{status.message}</span>
      <button onClick={onDismiss} className="shrink-0 text-red-400/60 hover:text-red-300">
        ✕
      </button>
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: { href: string; label: string } }) {
  return (
    <Card className="flex flex-col items-center gap-2 py-10 text-center">
      <div className="text-sm font-semibold text-zinc-300">{title}</div>
      <div className="max-w-sm text-sm text-zinc-500">{body}</div>
      {action ? (
        <Link
          href={action.href}
          className="mt-2 text-sm font-semibold text-cyan-300 hover:text-cyan-200"
        >
          {action.label} →
        </Link>
      ) : null}
    </Card>
  );
}

export function PageHeader({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-50">{title}</h1>
        {sub ? <p className="mt-1 text-sm text-zinc-500">{sub}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** Vesting progress bar with a flowing gradient. */
export function ProgressBar({ pct, tone = "flow" }: { pct: number; tone?: "flow" | "muted" }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div
        className={
          tone === "flow"
            ? "h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-[width] duration-1000 ease-linear"
            : "h-full rounded-full bg-zinc-600 transition-[width] duration-1000 ease-linear"
        }
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
