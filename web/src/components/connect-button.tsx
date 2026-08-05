"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { arcTestnet } from "@/lib/arc";
import { CHAIN_LABELS } from "@/lib/wagmi";
import { useUsdcBalance } from "@/lib/hooks";
import { formatUsdc, shortAddr } from "@/lib/format";

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connectAsync, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { data: balance } = useUsdcBalance(address);
  const [menuOpen, setMenuOpen] = useState(false);

  if (!isConnected || !address) {
    const injectedConnector = connectors[0];
    return (
      <button
        onClick={() => injectedConnector && connectAsync({ connector: injectedConnector }).catch(() => {})}
        disabled={!injectedConnector || isPending}
        className="rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:from-cyan-400 hover:to-emerald-400 disabled:opacity-50"
      >
        {isPending ? "Connecting…" : "Connect Wallet"}
      </button>
    );
  }

  // Connected on the wrong chain: one click switches — the wallet is prompted to
  // add Arc Testnet automatically if it doesn't know the chain yet. Base Sepolia
  // is tolerated transiently while a CCTP burn is in flight.
  if (chainId !== arcTestnet.id && chainId !== 84532) {
    return (
      <button
        onClick={() => switchChainAsync({ chainId: arcTestnet.id }).catch(() => {})}
        disabled={switching}
        className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-300 transition hover:bg-amber-400/20 disabled:opacity-50"
      >
        {switching ? "Switching…" : "Switch to Arc Testnet"}
      </button>
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
          <a
            href={`https://testnet.arcscan.app/address/${address}`}
            target="_blank"
            rel="noreferrer"
            className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-zinc-300 hover:bg-white/5"
          >
            View on Arcscan ↗
          </a>
          <a
            href="https://faucet.circle.com"
            target="_blank"
            rel="noreferrer"
            className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-zinc-300 hover:bg-white/5"
          >
            Get testnet USDC ↗
          </a>
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
