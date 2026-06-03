"use client";

import * as React from "react";
import { useWallet } from "@/components/wallet/wallet-provider";
import { getPermissionlessGroup } from "@/lib/permissionless-group";
import { buildEntryTransferTxs, type SimpleTx } from "@/lib/entry-transfer";
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
      const bal = await group.balance(avatar);
      setBalanceCrc(atto(bal.heldTotal));
      setMigratableCrc(atto(bal.migratable));

      // Build the whole entry as a SINGLE batch the host signs once. If the
      // held balance can't cover the fee, prepend an in-app migration (legacy
      // CRC → score group) — it mints native group-CRC to the avatar, which the
      // appended transfer then spends, all atomically. No Circles App detour,
      // and no second signature.
      let txs: SimpleTx[];
      if (bal.heldTotal >= ENTRY_FEE_ATTO) {
        setPhase("building");
        txs = await buildEntryTransferTxs(group, avatar, ORG_ADDRESS, ENTRY_FEE_ATTO);
      } else {
        if (bal.heldTotal + bal.migratable < ENTRY_FEE_ATTO) {
          setPhase("insufficient");
          setError(
            `You need ${ENTRY_FEE_CRC} group-CRC to enter, but only ${atto(
              bal.heldTotal + bal.migratable
            )} is available.`
          );
          return;
        }

        setPhase("migrating");
        // Migrate the shortfall (beyond what's held) + 20% buffer, capped at
        // what's actually migratable.
        let migTarget = ENTRY_FEE_ATTO - bal.heldTotal + ENTRY_FEE_ATTO / 5n;
        if (migTarget > bal.migratable) migTarget = bal.migratable;
        const mig = await group.migration({ avatar, amount: migTarget });
        if (mig.amount === 0n || mig.txs.length === 0) {
          setPhase("insufficient");
          setError(
            "Couldn't route enough migratable CRC to cover the entry. Try a wallet with more group-CRC."
          );
          return;
        }
        // Entry transfer accounting for the native the migration will mint.
        const entryTxs = await buildEntryTransferTxs(
          group,
          avatar,
          ORG_ADDRESS,
          ENTRY_FEE_ATTO,
          mig.amount
        );
        txs = [...mig.txs.map(toTx), ...entryTxs];
      }

      setPhase("signing");
      const hashes = await sendTransactions(txs);

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
