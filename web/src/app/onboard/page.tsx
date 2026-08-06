"use client";

import { useEffect, useState } from "react";
import { useBalance } from "wagmi";
import { arcTestnet } from "@/lib/arc";
import { explorerAddressUrl, explorerTxUrl, shortHash } from "@/lib/explorer";
import { SLUICE_ADDRESSES } from "@/lib/sluice";
import { useStream, useStreamIds } from "@/lib/hooks";
import { formatUsdc, shortAddr } from "@/lib/format";
import { Badge, Button, Card, CardTitle, PageHeader, inputClass } from "@/components/ui";

/**
 * Employee onboarding with Circle user-controlled wallets.
 *
 * The recipient of payroll is a normal person. Here they get a wallet on Arc
 * secured by a PIN they choose - MPC keyshares, no seed phrase, no extension,
 * and no custody by Sluice. Their salary stream then pays that address.
 */

interface CircleWallet {
  id: string;
  address: string;
  blockchain: string;
  state: string;
}

const STORAGE_KEY = "sluice.circleUserId";

/**
 * Circle provisions the wallet asynchronously: the PIN challenge resolves before
 * listWallets can see it. Polling here is what makes the address actually appear -
 * a single fetch races the provisioning and comes back empty.
 */
const POLL_INTERVAL_MS = 1_500;
const POLL_TIMEOUT_MS = 60_000;

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

/**
 * One salary stream owned by the Circle wallet, withdrawable with a PIN.
 *
 * This is the part that makes the MPC wallet more than an address to receive
 * into: Arc is on Circle's contract-execution allowlist, so the employee's
 * PIN-secured wallet calls Sluice.withdrawFromStream directly. No extension,
 * no seed phrase, and Sluice never touches the funds.
 */
function CircleStream({
  id,
  wallet,
  session,
  appId,
  hasGas,
}: {
  id: bigint;
  wallet: CircleWallet;
  session: { userToken: string; encryptionKey: string };
  appId: string;
  hasGas: boolean;
}) {
  const { stream } = useStream(id);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  const [failed, setFailed] = useState<string>();
  const [txHash, setTxHash] = useState<string>();

  const available = stream?.available ?? 0n;
  const sluice = SLUICE_ADDRESSES[arcTestnet.id];

  /** Circle returns a challenge, not a hash - the hash exists only after broadcast. */
  const pollForHash = async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((done) => setTimeout(done, 2_000));
      const tx = await api<{ txHash?: string; state?: string; errorReason?: string }>(
        "latestTransaction",
        { userToken: session.userToken, walletId: wallet.id },
      );
      if (tx.txHash) {
        setTxHash(tx.txHash);
        setNote(`Withdrawal ${tx.state === "COMPLETE" ? "confirmed" : "submitted"} on Arc.`);
        if (tx.state === "COMPLETE") return;
      }
      if (tx.state === "FAILED") {
        setFailed(tx.errorReason ?? "Circle reported the transaction failed.");
        return;
      }
    }
  };

  const withdraw = async () => {
    setBusy(true);
    setFailed(undefined);
    setTxHash(undefined);
    try {
      setNote("Preparing the withdrawal…");
      const { challengeId } = await api<{ challengeId: string }>("contractExecution", {
        userToken: session.userToken,
        walletId: wallet.id,
        contractAddress: sluice,
        abiFunctionSignature: "withdrawFromStream(uint256,uint256)",
        abiParameters: [id.toString(), available.toString()],
      });

      setNote("Confirm with your PIN…");
      const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
      const sdk = new W3SSdk({ appSettings: { appId } });
      sdk.setAuthentication({
        userToken: session.userToken,
        encryptionKey: session.encryptionKey,
      });

      await new Promise<void>((resolve, reject) => {
        sdk.execute(challengeId, (sdkError, result) => {
          if (sdkError) {
            reject(new Error(sdkError.message ?? "Withdrawal was cancelled"));
            return;
          }
          const state = result ? String(result.status) : "UNKNOWN";
          if (state === "FAILED" || state === "EXPIRED") {
            reject(new Error(`Withdrawal ${state.toLowerCase()}. Please try again.`));
            return;
          }
          resolve();
        });
      });

      setNote("Signed - waiting for Arc to confirm…");
      await pollForHash();
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
      setNote(undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-xs text-zinc-500">Stream #{id.toString()}</div>
          <div className="mt-0.5 font-mono text-lg tabular-nums text-emerald-300">
            {formatUsdc(available)} <span className="text-xs text-zinc-500">USDC claimable</span>
          </div>
        </div>
        <Button onClick={withdraw} disabled={busy || available === 0n || !hasGas}>
          {busy ? "Working…" : "Withdraw with PIN"}
        </Button>
      </div>
      {note ? <p className="mt-2 text-xs text-cyan-300">{note}</p> : null}
      {txHash ? (
        <a
          href={explorerTxUrl(arcTestnet.id, txHash)}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block font-mono text-xs text-cyan-400 hover:text-cyan-300"
        >
          {shortHash(txHash)} - view on Arcscan ↗
        </a>
      ) : null}
      {failed ? <p className="mt-2 text-xs text-red-300">{failed}</p> : null}
    </div>
  );
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

  /** Poll until Circle reports the provisioned wallet, or we give up. */
  const waitForWallet = async (userToken: string): Promise<CircleWallet[]> => {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    for (let attempt = 1; ; attempt += 1) {
      const result = await api<{ wallets: CircleWallet[] }>("wallets", { userToken });
      const found = result.wallets ?? [];
      if (found.length > 0) {
        setWallets(found);
        return found;
      }
      if (Date.now() >= deadline) return found;
      setStatus(`Circle is provisioning your wallet on Arc… (${attempt})`);
      await new Promise((done) => setTimeout(done, POLL_INTERVAL_MS));
    }
  };

  /** Create the Circle user, then run the PIN challenge that mints the wallet. */
  const startOnboarding = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setStatus("Creating your Circle account…");
      // Resume the saved user rather than minting a new one. Creating a fresh
      // user on every attempt strands the wallet made by the previous attempt.
      const saved = window.localStorage.getItem(STORAGE_KEY) ?? undefined;
      const created = await api<{ userId: string }>("createUser", saved ? { userId: saved } : {});
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
          // Only a definitive failure should abort. The callback legitimately
          // fires with IN_PROGRESS or PENDING while Circle is still provisioning,
          // and it can fire with no result at all - in those cases the wallet
          // poll below is the real source of truth, not this status.
          const state = result ? String(result.status) : "UNKNOWN";
          if (state === "FAILED" || state === "EXPIRED") {
            reject(new Error(`Wallet setup ${state.toLowerCase()}. Please try again.`));
            return;
          }
          resolve();
        });
      });

      setStatus("Wallet created - fetching your address…");
      const found = await waitForWallet(fresh.userToken);
      if (found.length === 0) {
        throw new Error(
          "Your PIN is set, but Circle has not published the wallet yet. It is still being " +
            "provisioned - reload this page in a moment and it will appear.",
        );
      }
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

  // Reads are provider-based, so the Circle wallet's streams and gas balance
  // resolve without any injected wallet being connected.
  const { data: streamRefs } = useStreamIds();
  const { data: gasBalance } = useBalance({
    address: arcWallet?.address as `0x${string}` | undefined,
    chainId: arcTestnet.id,
    query: { enabled: Boolean(arcWallet), refetchInterval: 10_000 },
  });
  const myStreams = (streamRefs ?? []).filter(
    (ref) => ref.recipient.toLowerCase() === arcWallet?.address.toLowerCase(),
  );
  const hasGas = (gasBalance?.value ?? 0n) > 0n;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Get paid without a crypto wallet"
        sub="Circle creates a wallet on Arc that you control with a PIN - no seed phrase, no browser extension, no app to install."
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
            it vests to you every second. You keep control - Sluice never holds your salary, and the
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

          {session && appId ? (
            <div className="mt-6 border-t border-white/[0.06] pt-5">
              <CardTitle hint="signed with your PIN">Withdraw your salary</CardTitle>
              {!hasGas ? (
                <p className="mb-3 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3.5 py-2.5 text-sm text-amber-200">
                  This wallet holds no USDC yet. On Arc, USDC pays the gas, so it needs a small
                  balance before it can send a withdrawal - ask your employer to send a little, or
                  claim some at{" "}
                  <a
                    href="https://faucet.circle.com"
                    target="_blank"
                    rel="noreferrer"
                    className="text-cyan-400 hover:text-cyan-300"
                  >
                    faucet.circle.com
                  </a>
                  .
                </p>
              ) : null}
              {myStreams.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  No salary streams point at this address yet. Once your employer opens one, it
                  shows up here and you can withdraw straight from this wallet.
                </p>
              ) : (
                <div className="space-y-2">
                  {myStreams.map((ref) => (
                    <CircleStream
                      key={ref.id.toString()}
                      id={ref.id}
                      wallet={arcWallet}
                      session={session}
                      appId={appId}
                      hasGas={hasGas}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </Card>
      ) : (
        <Card>
          <CardTitle>Create your wallet</CardTitle>
          <ol className="mb-4 space-y-2 text-sm text-zinc-400">
            <li>
              <span className="font-mono text-cyan-300">1.</span> Circle creates an account for you
            </li>
            <li>
              <span className="font-mono text-cyan-300">2.</span> You choose a PIN - that PIN, not a
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
          Circle alone nor Sluice can move your money - only you, with your PIN. Arc is on
          Circle&apos;s contract-execution allowlist, so this wallet can do more than hold USDC: it
          can call Sluice directly to withdraw vested salary.
        </p>
      </Card>
    </div>
  );
}
