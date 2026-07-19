"use client";

import { useState } from "react";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { CHAIN_LABELS } from "@/lib/wagmi";
import { useUsdcBalance } from "@/lib/hooks";
import { formatUsdc, shortAddr } from "@/lib/format";

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectors, connectAsync, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { chains, switchChain } = useSwitchChain();
  const { data: balance } = useUsdcBalance(address);
  const [menuOpen, setMenuOpen] = useState(false);

  if (!isConnected || !address) {
    const injectedConnector = connectors.find((connector) => connector.id !== "mock");
    const demoConnector = connectors.find((connector) => connector.id === "mock");
    return (
      <div className="flex items-center gap-2">
        {demoConnector ? (
          <button
            onClick={() => connectAsync({ connector: demoConnector }).catch(() => {})}
            disabled={isPending}
            className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-sm font-medium text-zinc-300 transition hover:bg-white/10 disabled:opacity-50"
            title="Connects the seeded anvil employee account — local demo, no wallet extension needed"
          >
            Demo wallet
          </button>
        ) : null}
        <button
          onClick={() => injectedConnector && connectAsync({ connector: injectedConnector }).catch(() => {})}
          disabled={!injectedConnector || isPending}
          className="rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:from-cyan-400 hover:to-emerald-400 disabled:opacity-50"
        >
          {isPending ? "Connecting…" : "Connect Wallet"}
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen((open) => !open)}
        className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-sm hover:bg-white/10"
      >
        <span className="hidden font-mono tabular-nums text-emerald-300 sm:inline">
          {balance !== undefined ? `${formatUsdc(balance as bigint)} USDC` : "—"}
        </span>
        <span className="font-mono text-zinc-200">{shortAddr(address)}</span>
        <span className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-[11px] font-medium text-cyan-300 ring-1 ring-inset ring-cyan-400/25">
          {CHAIN_LABELS[chainId] ?? `Chain ${chainId}`}
        </span>
      </button>
      {menuOpen ? (
        <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-white/10 bg-zinc-900 p-2 shadow-xl">
          <div className="px-2 pb-2 pt-1 text-xs uppercase tracking-wider text-zinc-500">
            Network
          </div>
          {chains.map((chain) => (
            <button
              key={chain.id}
              onClick={() => {
                switchChain({ chainId: chain.id });
                setMenuOpen(false);
              }}
              className={`block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white/5 ${
                chain.id === chainId ? "text-cyan-300" : "text-zinc-300"
              }`}
            >
              {chain.id === chainId ? "● " : "○ "}
              {CHAIN_LABELS[chain.id] ?? chain.name}
            </button>
          ))}
          <div className="my-1 border-t border-white/10" />
          <button
            onClick={() => {
              disconnect();
              setMenuOpen(false);
            }}
            className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-red-300 hover:bg-white/5"
          >
            Disconnect
          </button>
        </div>
      ) : null}
    </div>
  );
}
