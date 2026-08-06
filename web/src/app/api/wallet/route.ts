import { NextRequest, NextResponse } from "next/server";
import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";

/**
 * Circle user-controlled wallets - employee onboarding without a seed phrase.
 *
 * Payroll's recipient is a normal person, not a crypto user. Circle provisions
 * an MPC wallet on Arc that the EMPLOYEE controls (a keyshare behind their PIN);
 * Sluice never holds custody of anyone's salary.
 *
 * The API key must never reach the browser, so every privileged call lives here.
 * The browser only ever receives a short-lived userToken + encryptionKey, which
 * is exactly what Circle's Web SDK expects.
 */

const ARC_TESTNET = "ARC-TESTNET";

function client() {
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) throw new Error("CIRCLE_API_KEY is not configured on the server.");
  return initiateUserControlledWalletsClient({ apiKey });
}

const uuid = () => crypto.randomUUID();

export async function POST(request: NextRequest) {
  let action = "";
  try {
    const body = (await request.json()) as {
      action?: string;
      userId?: string;
      userToken?: string;
    };
    action = body.action ?? "";
    const circle = client();

    switch (action) {
      /** Create the employee's Circle user record (idempotent per userId). */
      case "createUser": {
        const userId = body.userId ?? uuid();
        try {
          await circle.createUser({ userId });
        } catch (error) {
          // Already existing is fine - onboarding must be resumable.
          const message = error instanceof Error ? error.message : "";
          if (!/exist/i.test(message)) throw error;
        }
        return NextResponse.json({ userId });
      }

      /** Short-lived session credentials for the browser SDK. */
      case "session": {
        if (!body.userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
        const response = await circle.createUserToken({ userId: body.userId });
        return NextResponse.json({
          userToken: response.data?.userToken,
          encryptionKey: response.data?.encryptionKey,
        });
      }

      /**
       * Start wallet creation on Arc. Returns a challengeId the browser SDK
       * executes - that step is where the employee sets their PIN and the
       * keyshares are generated. The server never sees the PIN.
       */
      case "initialize": {
        if (!body.userToken) {
          return NextResponse.json({ error: "userToken required" }, { status: 400 });
        }
        const response = await circle.createUserPinWithWallets({
          userToken: body.userToken,
          blockchains: [ARC_TESTNET as never],
          accountType: "EOA",
        });
        return NextResponse.json({ challengeId: response.data?.challengeId });
      }

      /** The employee's Arc wallets once the challenge has completed. */
      case "wallets": {
        if (!body.userToken) {
          return NextResponse.json({ error: "userToken required" }, { status: 400 });
        }
        const response = await circle.listWallets({ userToken: body.userToken });
        const wallets = (response.data?.wallets ?? []).map((wallet) => ({
          id: wallet.id,
          address: wallet.address,
          blockchain: wallet.blockchain,
          state: wallet.state,
        }));
        return NextResponse.json({ wallets });
      }

      /**
       * Build a contract-execution challenge so the employee's Circle wallet can
       * call Sluice directly - e.g. withdrawFromStream. Arc is on Circle's
       * contract-execution allowlist, which is what makes payroll (not just
       * transfers) possible from a wallet the employee controls with a PIN.
       */
      case "contractExecution": {
        const { userToken, walletId, contractAddress, abiFunctionSignature, abiParameters } =
          body as unknown as {
            userToken?: string;
            walletId?: string;
            contractAddress?: string;
            abiFunctionSignature?: string;
            abiParameters?: unknown[];
          };
        if (!userToken || !walletId || !contractAddress || !abiFunctionSignature) {
          return NextResponse.json(
            { error: "userToken, walletId, contractAddress and abiFunctionSignature are required" },
            { status: 400 },
          );
        }
        const response = await circle.createUserTransactionContractExecutionChallenge({
          userToken,
          walletId,
          contractAddress,
          abiFunctionSignature,
          abiParameters: (abiParameters ?? []) as never,
          fee: { type: "level", config: { feeLevel: "MEDIUM" } } as never,
        });
        return NextResponse.json({ challengeId: response.data?.challengeId });
      }

      /**
       * Newest transaction for a wallet, so the UI can surface the Arc tx hash
       * once Circle has broadcast it. Circle returns a challenge, not a hash -
       * the hash only exists after the MPC signature is submitted onchain.
       */
      case "latestTransaction": {
        const { userToken, walletId } = body as unknown as {
          userToken?: string;
          walletId?: string;
        };
        if (!userToken || !walletId) {
          return NextResponse.json(
            { error: "userToken and walletId are required" },
            { status: 400 },
          );
        }
        const response = await circle.listTransactions({
          userToken,
          walletIds: [walletId],
          pageSize: 1,
        });
        const tx = (response.data?.transactions ?? [])[0];
        return NextResponse.json({
          id: tx?.id,
          state: tx?.state,
          txHash: tx?.txHash,
          errorReason: tx?.errorReason,
        });
      }

      /** Status of a user (has a PIN been set, do wallets exist yet). */
      case "status": {
        if (!body.userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
        const response = await circle.getUser({ userId: body.userId });
        return NextResponse.json({
          pinStatus: response.data?.user?.pinStatus,
          status: response.data?.user?.status,
        });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message.slice(0, 300), action }, { status: 500 });
  }
}
