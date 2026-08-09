"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { arcTestnet } from "@/lib/arc";
import { CHAIN_LABELS } from "@/lib/wagmi";
import { useStreamIds, useUsdcBalance } from "@/lib/hooks";
import { explorerAddressUrl } from "@/lib/explorer";
import { formatUsdc, shortAddr } from "@/lib/format";

/**
 * App shell navigation.
 *
 * A sidebar rather than a top bar: the app has seven surfaces and grows, and a
 * persistent rail leaves room for the Arc connection card to stay visible on
 * every page - which chain, which address, how much USDC, one click to the
 * explorer.
 */

/**
 * Role-scoped navigation. Employers see the full product; employees see the
 * consumption side - no stream-creation surfaces, no treasury console. This is
 * presentation only: direct URLs still work on purpose (the contracts enforce
 * the real permissions), so hiding a tab can never lock anyone out.
 */
export type Role = "employer" | "employee";
const ROLE_STORAGE_KEY = "sluice-role";

export const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: GridIcon, roles: ["employer", "employee"] },
  { href: "/create", label: "Create Stream", icon: PlusIcon, roles: ["employer"] },
  { href: "/payroll", label: "Payroll Run", icon: UsersIcon, roles: ["employer"] },
  { href: "/marketplace", label: "Marketplace", icon: TagIcon, roles: ["employer", "employee"] },
  { href: "/treasury", label: "Treasury", icon: VaultIcon, roles: ["employer"] },
  { href: "/automation", label: "Automation", icon: BoltIcon, roles: ["employer", "employee"] },
  { href: "/onboard", label: "Get Paid", icon: WalletIcon, roles: ["employee"] },
] as const;

function GridIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}
function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" strokeLinecap="round" />
    </svg>
  );
}
function UsersIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" strokeLinecap="round" />
      <path d="M16 11a3 3 0 1 0 0-6M17.5 19c0-2.2-.9-3.9-2.3-4.8" strokeLinecap="round" />
    </svg>
  );
}
function TagIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M3 11.5V4.5A1.5 1.5 0 0 1 4.5 3h7l9 9-8 8-9.5-9.5z" strokeLinejoin="round" />
      <circle cx="7.5" cy="7.5" r="1.3" />
    </svg>
  );
}
function VaultIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 4v2M12 18v2" strokeLinecap="round" />
    </svg>
  );
}
function BoltIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" strokeLinejoin="round" />
    </svg>
  );
}
function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className}>
      <path d="M15 5 8 12l7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function WalletIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Always-visible Arc connection state: chain, address, balance, explorer. */
function ConnectionCard() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connectAsync, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { data: balance } = useUsdcBalance(address);

  if (!isConnected || !address) {
    return (
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
          Not connected
        </div>
        <button
          onClick={() => connectors[0] && connectAsync({ connector: connectors[0] }).catch(() => {})}
          disabled={!connectors[0] || isPending}
          className="mt-2.5 w-full rounded-md bg-cyan-400 px-3 py-2 text-sm font-medium text-[#06121a] transition-colors hover:bg-cyan-300 disabled:opacity-50"
        >
          {isPending ? "Connecting…" : "Connect Wallet"}
        </button>
      </div>
    );
  }

  const wrongChain = chainId !== arcTestnet.id && chainId !== 84532;

  return (
    <div className="rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
          <span
            className={`h-1.5 w-1.5 rounded-full ${wrongChain ? "bg-amber-400" : "bg-emerald-400"}`}
          />
          {wrongChain ? "Wrong network" : `Connected to ${CHAIN_LABELS[chainId] ?? "chain"}`}
        </span>
      </div>

      {wrongChain ? (
        <button
          onClick={() => switchChainAsync({ chainId: arcTestnet.id }).catch(() => {})}
          disabled={switching}
          className="mt-2.5 w-full rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm font-semibold text-amber-300 transition hover:bg-amber-400/20 disabled:opacity-50"
        >
          {switching ? "Switching…" : "Switch to Arc Testnet"}
        </button>
      ) : (
        <>
          <div className="mt-1.5 font-mono text-xs text-zinc-300">{shortAddr(address)}</div>
          <div className="mt-2.5 text-[10px] uppercase tracking-wider text-zinc-500">Balance</div>
          <div className="font-mono text-lg font-semibold tabular-nums text-emerald-300">
            {balance !== undefined ? formatUsdc(balance as bigint) : "-"}
            <span className="ml-1 text-xs font-normal text-zinc-500">USDC</span>
          </div>
          <a
            href={explorerAddressUrl(chainId, address)}
            target="_blank"
            rel="noreferrer"
            className="mt-2.5 block rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-center text-xs text-zinc-300 transition-colors hover:bg-white/10"
          >
            View on Arcscan ↗
          </a>
        </>
      )}

      <button
        onClick={() => disconnect()}
        className="mt-2 w-full rounded-lg px-3 py-1 text-center text-xs text-zinc-500 transition-colors hover:text-zinc-300"
      >
        Disconnect
      </button>
    </div>
  );
}

/** Icons-only balance pill, shown when the rail is collapsed. */
function CollapsedConnection() {
  const { address, isConnected, chainId } = useAccount();
  const { data: balance } = useUsdcBalance(address);
  const ok = isConnected && (chainId === arcTestnet.id || chainId === 84532);
  return (
    <div
      title={
        isConnected
          ? `${address} - ${balance !== undefined ? formatUsdc(balance as bigint) : "?"} USDC`
          : "Not connected"
      }
      className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.02]"
    >
      <span
        className={`h-2 w-2 rounded-full ${
          !isConnected ? "bg-zinc-600" : ok ? "bg-emerald-400" : "bg-amber-400"
        }`}
      />
    </div>
  );
}

export function SidebarContent({
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  // Default to the full (employer) view; load the saved choice after mount so
  // the server-rendered markup never mismatches the client.
  const [role, setRole] = useState<Role>("employer");
  useEffect(() => {
    if (window.localStorage.getItem(ROLE_STORAGE_KEY) === "employee") setRole("employee");
  }, []);
  // Smart default: a wallet that receives streams but has never created one is
  // an employee. Only applies while the user has never chosen explicitly, and
  // never writes storage - an ephemeral guess, not a decision.
  const { address } = useAccount();
  const { data: streamRefs } = useStreamIds();
  useEffect(() => {
    if (!address || !streamRefs || window.localStorage.getItem(ROLE_STORAGE_KEY)) return;
    const me = address.toLowerCase();
    const receives = streamRefs.some((ref) => ref.recipient.toLowerCase() === me);
    const employs = streamRefs.some((ref) => ref.employer.toLowerCase() === me);
    if (receives && !employs) setRole("employee");
  }, [address, streamRefs]);
  const pickRole = (next: Role) => {
    setRole(next);
    window.localStorage.setItem(ROLE_STORAGE_KEY, next);
  };
  const links = NAV_LINKS.filter((link) => (link.roles as readonly Role[]).includes(role));

  return (
    <div className="flex h-full flex-col">
      <div className={`flex items-center py-4 ${collapsed ? "justify-center px-2" : "gap-2 px-5"}`}>
        <Link href="/" className="flex min-w-0 items-center" onClick={onNavigate}>
          <Image
            src={collapsed ? "/sluice-mark.png" : "/sluice-wordmark.png"}
            alt="Sluice"
            width={collapsed ? 113 : 306}
            height={96}
            priority
            className={collapsed ? "h-7 w-auto" : "h-7 w-auto"}
          />
        </Link>
        {!collapsed && onToggleCollapse ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Collapse sidebar"
            aria-expanded={true}
            title="Collapse sidebar"
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200"
          >
            <ChevronIcon className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {collapsed && onToggleCollapse ? (
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label="Expand sidebar"
          aria-expanded={false}
          title="Expand sidebar"
          className="mx-auto mb-2 flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200"
        >
          <ChevronIcon className="h-3.5 w-3.5 rotate-180" />
        </button>
      ) : null}

      {/* Role switcher: hidden when collapsed (the filter still applies). */}
      {!collapsed ? (
        <div className="mb-3 px-3">
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/[0.07] bg-white/[0.02] p-1">
            {(["employer", "employee"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => pickRole(option)}
                aria-pressed={role === option}
                className={`rounded-md px-2 py-1.5 text-xs font-medium capitalize transition-colors ${
                  role === option
                    ? "bg-white/[0.08] text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <nav className={`space-y-1 ${collapsed ? "px-2" : "px-3"}`}>
        {links.map((link) => {
          const active = pathname.startsWith(link.href);
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              onClick={onNavigate}
              title={collapsed ? link.label : undefined}
              className={`flex items-center rounded-lg text-sm font-medium transition-colors ${
                collapsed ? "justify-center px-2 py-2.5" : "gap-2.5 px-3 py-2"
              } ${
                active
                  ? "bg-white/[0.07] text-zinc-100"
                  : "text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200"
              }`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${active ? "text-cyan-300" : "text-zinc-500"}`} />
              {collapsed ? <span className="sr-only">{link.label}</span> : link.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* Wallet lives at the bottom of the rail, out of the navigation flow. */}
      <div className={`mt-6 pb-4 ${collapsed ? "px-2" : "px-3"}`}>
        {collapsed ? <CollapsedConnection /> : <ConnectionCard />}
      </div>
    </div>
  );
}
