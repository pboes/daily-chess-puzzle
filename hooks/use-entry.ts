"use client";

import * as React from "react";
import { useWallet } from "@/components/wallet/wallet-provider";
import { getPermissionlessGroup } from "@/lib/permissionless-group";
import { ENTRY_FEE_ATTO, ENTRY_FEE_CRC, ORG_ADDRESS } from "@/lib/circles-config";

type EntryPhase =
  | "idle"
  | "checking"
  | "insufficient"
  | "migrating"
  | "building"
  | "signing"
  | "verifying"
  | "entered"
  | "error";

interface UseEntryResult {
  phase: EntryPhase;
  entered: boolean;
  /** Directly-spendable group-CRC (held). null until checked. */
  balanceCrc: number | null;
  /** Legacy CRC migratable into the group — only relevant when held < fee. */
  migratableCrc: number | null;
  /** True when held < fee but held + migratable ≥ fee (we'll migrate first). */
  needsMigration: boolean;
  feeCrc: number;
  error: string | null;
  refreshBalance: () => Promise<void>;
  /** Pay the entry fee (migrating in-app first if needed) and register. */
  payAndEnter: () => Promise<void>;
}

const atto = (v: bigint) => Number(v / 10n ** 12n) / 1e6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toTx = (t: { to: unknown; data?: unknown; value?: unknown }) => ({
  to: t.to as string,
  data: (t.data ?? "0x") as string,
  value: (t.value ?? "0").toString(),
});

export function useEntry(): UseEntryResult {
  const { address, sendTransactions } = useWallet();
  const [phase, setPhase] = React.useState<EntryPhase>("idle");
  const [entered, setEntered] = React.useState(false);
  const [balanceCrc, setBalanceCrc] = React.useState<number | null>(null);
  const [migratableCrc, setMigratableCrc] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refreshBalance = React.useCallback(async () => {
    if (!address) return;
    try {
      const group = getPermissionlessGroup();
      const bal = await group.balance(address as `0x${string}`);
      setBalanceCrc(atto(bal.heldTotal));
      setMigratableCrc(atto(bal.migratable));
    } catch (err) {
      console.warn("[entry] balance read failed:", err);
      setBalanceCrc(null);
    }
  }, [address]);

  React.useEffect(() => {
    if (!address) {
      setEntered(false);
      setBalanceCrc(null);
      setMigratableCrc(null);
      setPhase("idle");
      return;
    }
    let cancelled = false;
    (async () => {
      setPhase("checking");
      try {
        const res = await fetch(`/api/enter?address=${address}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.entered) {
          setEntered(true);
          setPhase("entered");
        } else {
          setPhase("idle");
        }
      } catch {
        if (!cancelled) setPhase("idle");
      }
      await refreshBalance();
    })();
    return () => {
      cancelled = true;
    };
  }, [address, refreshBalance]);

  const payAndEnter = React.useCallback(async () => {
    if (!address) {
      setError("Connect your Circles wallet first.");
      setPhase("error");
      return;
    }
    const avatar = address as `0x${string}`;
    setError(null);
    try {
      const group = getPermissionlessGroup();

      setPhase("checking");
      let bal = await group.balance(avatar);
      setBalanceCrc(atto(bal.heldTotal));
      setMigratableCrc(atto(bal.migratable));

      // If the held balance can't cover the fee, migrate just enough in-app
      // (legacy CRC → score group) before paying — no Circles App detour.
      if (bal.heldTotal < ENTRY_FEE_ATTO) {
        if (bal.heldTotal + bal.migratable < ENTRY_FEE_ATTO) {
          setPhase("insufficient");
          setError(
            `You need ${ENTRY_FEE_CRC} group-CRC to enter, but only ${atto(
              bal.heldTotal
            )} is spendable (even after migrating ${atto(bal.migratable)}).`
          );
          return;
        }

        setPhase("migrating");
        const needed = ENTRY_FEE_ATTO - bal.heldTotal;
        const migTarget = needed + needed / 5n; // 20% buffer for routing/demurrage slip
        const mig = await group.migration({ avatar, amount: migTarget });
        if (mig.amount === 0n || mig.txs.length === 0) {
          setPhase("insufficient");
          setError(
            "Couldn't route enough migratable CRC to cover the entry. Try a wallet with more group-CRC."
          );
          return;
        }
        await sendTransactions(mig.txs.map(toTx));

        // Confirm the migration landed (poll held balance briefly).
        for (let i = 0; i < 6; i++) {
          bal = await group.balance(avatar);
          setBalanceCrc(atto(bal.heldTotal));
          setMigratableCrc(atto(bal.migratable));
          if (bal.heldTotal >= ENTRY_FEE_ATTO) break;
          await sleep(2500);
        }
        if (bal.heldTotal < ENTRY_FEE_ATTO) {
          setPhase("error");
          setError("Migration didn't bring in enough spendable CRC yet — please try again.");
          return;
        }
      }

      setPhase("building");
      const { txs } = await group.transferGroupCrc({
        avatar,
        to: ORG_ADDRESS,
        amount: ENTRY_FEE_ATTO,
      });

      setPhase("signing");
      const hashes = await sendTransactions(txs.map(toTx));

      setPhase("verifying");
      let ok = false;
      let lastErr = "Payment could not be verified.";
      for (const hash of hashes) {
        const res = await fetch("/api/enter", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address, txHash: hash }),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          ok = true;
          break;
        }
        lastErr = data.error ?? lastErr;
      }

      if (ok) {
        setEntered(true);
        setPhase("entered");
        await refreshBalance();
      } else {
        setError(lastErr);
        setPhase("error");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [address, sendTransactions, refreshBalance]);

  const needsMigration =
    balanceCrc != null &&
    balanceCrc < ENTRY_FEE_CRC &&
    balanceCrc + (migratableCrc ?? 0) >= ENTRY_FEE_CRC;

  return {
    phase,
    entered,
    balanceCrc,
    migratableCrc,
    needsMigration,
    feeCrc: ENTRY_FEE_CRC,
    error,
    refreshBalance,
    payAndEnter,
  };
}
