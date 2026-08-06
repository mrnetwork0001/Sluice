"use client";

import { useEffect, useState } from "react";
import { arcTestnet } from "@/lib/arc";
import { explorerAddressUrl, shortHash } from "@/lib/explorer";
import { SLUICE_ADDRESSES } from "@/lib/sluice";
import { shortAddr } from "@/lib/format";
import { Badge, Button, Card, CardTitle, PageHeader, inputClass } from "@/components/ui";

/**
 * Employee onboarding with Circle user-controlled wallets.
 *
 * The recipient of payroll is a normal person. Here they get a wallet on Arc
 * secured by a PIN they choose — MPC keyshares, no seed phrase, no extension,
 * and no custody by Sluice. Their salary stream then pays that address.
 */

interface CircleWallet {
  id: string;
  address: string;
  blockchain: string;
  state: string;
}

const STORAGE_KEY = "sluice.circleUserId";

async function api<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch("/api/wallet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body as T;
}

export default function OnboardPage() {
  const [userId, setUserId] = useState<string>();
  const [session, setSession] = useState<{ userToken: string; encryptionKey: string }>();
  const [wallets, setWallets] = useState<CircleWallet[]>([]);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID;
  const sluice = SLUICE_ADDRESSES[arcTestnet.id];

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) setUserId(saved);
  }, []);

  /** Refresh session + wallets for an existing user. */
  const refresh = async (id: string) => {
    const fresh = await api<{ userToken: string; encryptionKey: string }>("session", { userId: id });
    setSession(fresh);
    const result = await api<{ wallets: CircleWallet[] }>("wallets", { userToken: fresh.userToken });
    setWallets(result.wallets ?? []);
    return fresh;
  };

  useEffect(() => {
    if (!userId) return;
    refresh(userId).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [userId]);

  /** Create the Circle user, then run the PIN challenge that mints the wallet. */
  const startOnboarding = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setStatus("Creating your Circle account…");
      const created = await api<{ userId: string }>("createUser");
      window.localStorage.setItem(STORAGE_KEY, created.userId);
      setUserId(created.userId);

      setStatus("Opening a secure session…");
      const fresh = await refresh(created.userId);

      setStatus("Preparing your wallet on Arc…");
      const { challengeId } = await api<{ challengeId: string }>("initialize", {
        userToken: fresh.userToken,
      });

      setStatus("Set your PIN in the Circle dialog…");
      const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
      const sdk = new W3SSdk({ appSettings: { appId: appId! } });
      sdk.setAuthentication({ userToken: fresh.userToken, encryptionKey: fresh.encryptionKey });

      await new Promise<void>((resolve, reject) => {
        sdk.execute(challengeId, (sdkError, result) => {
          if (sdkError) {
            reject(new Error(sdkError.message ?? "Wallet setup was cancelled"));
            return;
          }
          void result;
          resolve();
        });
      });

      setStatus("Wallet created — fetching your address…");
      await refresh(created.userId);
      setStatus(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(undefined);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    setUserId(undefined);
    setSession(undefined);
    setWallets([]);
    setError(undefined);
  };

  const arcWallet = wallets.find((wallet) => /ARC/i.test(wallet.blockchain));

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Get paid without a crypto wallet"
        sub="Circle creates a wallet on Arc that you control with a PIN — no seed phrase, no browser extension, no app to install."
      />

      {!appId ? (
        <Card>
          <p className="text-sm text-amber-300">
            NEXT_PUBLIC_CIRCLE_APP_ID is not configured, so wallet onboarding is disabled.
          </p>
        </Card>
      ) : arcWallet ? (
        <Card>
          <CardTitle hint="Circle user-controlled wallet">Your payroll wallet</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="emerald">{arcWallet.state}</Badge>
            <Badge tone="cyan">{arcWallet.blockchain}</Badge>
          </div>
          <div className="mt-4">
            <div className="text-xs uppercase tracking-wider text-zinc-500">Your address on Arc</div>
            <div className="mt-1 break-all font-mono text-lg text-emerald-300">{arcWallet.address}</div>
            <a
              href={explorerAddressUrl(arcTestnet.id, arcWallet.address)}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block font-mono text-xs text-cyan-400 hover:text-cyan-300"
            >
              view on Arcscan ↗
            </a>
          </div>

          <div className="mt-5 rounded-xl border border-cyan-400/15 bg-cyan-400/5 px-4 py-3 text-sm text-zinc-300">
            Give this address to your employer. They open a salary stream to it on{" "}
            <span className="font-mono text-xs">{sluice ? shortAddr(sluice) : "Sluice"}</span>, and
            it vests to you every second. You keep control — Sluice never holds your salary, and the
            keyshares behind this wallet are split between Circle and your PIN.
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="ghost"
              onClick={() => navigator.clipboard?.writeText(arcWallet.address)}
            >
              Copy address
            </Button>
            <Button variant="ghost" onClick={reset}>
              Start over
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <CardTitle>Create your wallet</CardTitle>
          <ol className="mb-4 space-y-2 text-sm text-zinc-400">
            <li>
              <span className="font-mono text-cyan-300">1.</span> Circle creates an account for you
            </li>
            <li>
              <span className="font-mono text-cyan-300">2.</span> You choose a PIN — that PIN, not a
              seed phrase, secures your wallet
            </li>
            <li>
              <span className="font-mono text-cyan-300">3.</span> A wallet appears on Arc, ready to
              receive salary
            </li>
          </ol>
          <Button onClick={startOnboarding} disabled={busy}>
            {busy ? "Working…" : "Create my payroll wallet"}
          </Button>
          {status ? (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3.5 py-2.5 text-sm text-cyan-200">
              <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
              {status}
            </div>
          ) : null}
          {userId && !busy ? (
            <p className="mt-3 font-mono text-xs text-zinc-600">
              Circle user {shortHash(userId)} · session{" "}
              {session ? "active" : "pending"}
            </p>
          ) : null}
        </Card>
      )}

      {error ? (
        <Card className="mt-4">
          <p className="text-sm text-red-300">{error}</p>
        </Card>
      ) : null}

      <Card className="mt-4">
        <CardTitle>Why this matters for payroll</CardTitle>
        <p className="text-sm leading-relaxed text-zinc-400">
          Every other payroll rail assumes the recipient already has a wallet. Most people do not.
          Circle&apos;s user-controlled wallets are MPC: the keyshares are split so that neither
          Circle alone nor Sluice can move your money — only you, with your PIN. Arc is on
          Circle&apos;s contract-execution allowlist, so this wallet can do more than hold USDC: it
          can call Sluice directly to withdraw vested salary.
        </p>
      </Card>
    </div>
  );
}
