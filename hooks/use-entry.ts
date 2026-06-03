"use client";

import * as React from "react";
import { useWallet } from "@/components/wallet/wallet-provider";
import { getPermissionlessGroup } from "@/lib/permissionless-group";
import { ENTRY_FEE_ATTO, ENTRY_FEE_CRC, ORG_ADDRESS } from "@/lib/circles-config";

type EntryPhase =
  | "idle"
  | "checking"
  | "insufficient"
  | "building"
  | "signing"
  | "verifying"
  | "entered"
  | "error";

interface UseEntryResult {
  phase: EntryPhase;
  entered: boolean;
  /** Player's directly-spendable group-CRC (held, not migratable). null until checked. */
  balanceCrc: number | null;
  /** Legacy CRC that's migratable into the group but not yet spendable. */
  migratableCrc: number | null;
  feeCrc: number;
  error: string | null;
  /** Re-read the on-chain balance. */
  refreshBalance: () => Promise<void>;
  /** Pay the entry fee and register for today. */
  payAndEnter: () => Promise<void>;
}

const atto = (v: bigint) => Number(v / 10n ** 12n) / 1e6;

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
      // Spendable = what's actually held in the group (NOT migratable legacy CRC).
      setBalanceCrc(atto(bal.heldTotal));
      setMigratableCrc(atto(bal.migratable));
    } catch (err) {
      console.warn("[entry] balance read failed:", err);
      setBalanceCrc(null);
    }
  }, [address]);

  // Check existing entry + balance when the wallet connects.
  React.useEffect(() => {
    if (!address) {
      setEntered(false);
      setBalanceCrc(null);
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
    setError(null);
    try {
      const group = getPermissionlessGroup();

      setPhase("checking");
      const bal = await group.balance(address as `0x${string}`);
      setBalanceCrc(atto(bal.heldTotal));
      setMigratableCrc(atto(bal.migratable));
      // Only the held balance can be transferred; migratable legacy CRC must be
      // migrated into the group first (done in the Circles app).
      if (bal.heldTotal < ENTRY_FEE_ATTO) {
        setPhase("insufficient");
        const migHint =
          bal.migratable > 0n
            ? ` You have ${atto(bal.migratable)} migratable CRC — migrate it in the Circles app first to use it.`
            : "";
        setError(
          `You need ${ENTRY_FEE_CRC} spendable group-CRC to enter, but only ${atto(
            bal.heldTotal
          )} is available.${migHint}`
        );
        return;
      }

      setPhase("building");
      const { txs } = await group.transferGroupCrc({
        avatar: address as `0x${string}`,
        to: ORG_ADDRESS,
        amount: ENTRY_FEE_ATTO,
      });

      setPhase("signing");
      const hashes = await sendTransactions(
        txs.map((t) => ({
          to: t.to as string,
          data: (t.data ?? "0x") as string,
          value: (t.value ?? "0").toString(),
        }))
      );

      setPhase("verifying");
      // The host returns the batch tx hash(es); try each until the server
      // confirms the CRC transfer into the org.
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

  return {
    phase,
    entered,
    balanceCrc,
    migratableCrc,
    feeCrc: ENTRY_FEE_CRC,
    error,
    refreshBalance,
    payAndEnter,
  };
}
