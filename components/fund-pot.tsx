"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/components/wallet/wallet-provider";
import { getPermissionlessGroup } from "@/lib/permissionless-group";
import { ORG_ADDRESS } from "@/lib/circles-config";
import { attoToCrc, crcToAtto, shortenAddress } from "@/lib/utils";
import { Coins, Loader2, Sprout, X, ExternalLink } from "lucide-react";

type Phase = "idle" | "checking" | "building" | "signing" | "done" | "error";

/**
 * Hidden "seed the pot" panel for the organiser. Unlocked by a secret gesture
 * (tap the ♞ logo 5×) or by loading the app with `?fund` in the URL.
 *
 * It reuses the exact same Circles flow as paid entries — `transferGroupCrc`
 * (avatar → org) submitted through the host — so funding the initial pot is an
 * app-native action, no script or manual SDK wiring required. Whatever lands on
 * the org shows up immediately as the live pot.
 */
export function FundPot() {
  const { address, isConnected, sendTransactions } = useWallet();
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState("10");
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [balanceCrc, setBalanceCrc] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [txHash, setTxHash] = React.useState<string | null>(null);

  // Reveal on the secret gesture event or the ?fund / #fund URL flag.
  React.useEffect(() => {
    const reveal = () => setOpen(true);
    window.addEventListener("dcp:unlock-fund", reveal);
    const url = new URL(window.location.href);
    if (url.searchParams.has("fund") || url.hash === "#fund") setOpen(true);
    return () => window.removeEventListener("dcp:unlock-fund", reveal);
  }, []);

  const refreshBalance = React.useCallback(async () => {
    if (!address) return;
    try {
      const bal = await getPermissionlessGroup().balance(address as `0x${string}`);
      setBalanceCrc(attoToCrc(bal.total));
    } catch {
      setBalanceCrc(null);
    }
  }, [address]);

  React.useEffect(() => {
    if (open) refreshBalance();
  }, [open, refreshBalance]);

  const fund = React.useCallback(async () => {
    setError(null);
    setTxHash(null);
    const crc = Number(amount);
    if (!address) {
      setError("Connect your Circles wallet first.");
      setPhase("error");
      return;
    }
    if (!Number.isFinite(crc) || crc <= 0) {
      setError("Enter a positive amount.");
      setPhase("error");
      return;
    }
    try {
      const group = getPermissionlessGroup();
      const atto = crcToAtto(crc);

      setPhase("checking");
      const bal = await group.balance(address as `0x${string}`);
      setBalanceCrc(attoToCrc(bal.total));
      if (bal.total < atto) {
        setError(
          `You only have ${attoToCrc(bal.total)} gCRC available; can't send ${crc}.`
        );
        setPhase("error");
        return;
      }

      setPhase("building");
      const { txs } = await group.transferGroupCrc({
        avatar: address as `0x${string}`,
        to: ORG_ADDRESS,
        amount: atto,
      });

      setPhase("signing");
      const hashes = await sendTransactions(
        txs.map((t) => ({
          to: t.to as string,
          data: (t.data ?? "0x") as string,
          value: (t.value ?? "0").toString(),
        }))
      );
      setTxHash(hashes[hashes.length - 1] ?? null);
      setPhase("done");
      await refreshBalance();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [address, amount, sendTransactions, refreshBalance]);

  if (!open) return null;

  const busy = ["checking", "building", "signing"].includes(phase);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-sm">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sprout className="h-5 w-5 text-[var(--accent)]" />
            Seed the pot
          </CardTitle>
          <button
            onClick={() => setOpen(false)}
            className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--secondary)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-[var(--muted-foreground)]">
            Send group-CRC from your wallet straight to the pot
            <span className="font-mono"> ({shortenAddress(ORG_ADDRESS)})</span>.
            It becomes the carry-over for the next winner.
          </p>

          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="0.1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={busy}
              className="h-11 w-full rounded-md border border-[var(--border)] bg-[var(--secondary)]/40 px-3 font-mono text-lg outline-none focus:ring-2 focus:ring-[var(--ring)]"
            />
            <span className="text-sm font-semibold text-[var(--muted-foreground)]">gCRC</span>
          </div>

          {balanceCrc != null && (
            <p className="text-xs text-[var(--muted-foreground)]">
              Your balance: {balanceCrc} gCRC
            </p>
          )}

          <Button
            variant="accent"
            className="w-full"
            disabled={!isConnected || busy}
            onClick={fund}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {phase === "signing" ? "Confirm in wallet…" : "Preparing…"}
              </>
            ) : (
              <>
                <Coins className="h-4 w-4" />
                Send {amount || "0"} gCRC to the pot
              </>
            )}
          </Button>

          {phase === "done" && (
            <div className="rounded-lg bg-[var(--accent)]/15 px-3 py-2 text-sm text-[var(--accent)]">
              Sent! The pot updates within ~30s.
              {txHash && (
                <a
                  href={`https://gnosisscan.io/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 inline-flex items-center gap-1 underline"
                >
                  view <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}
          {error && (
            <p className="text-xs text-[var(--destructive)]">{error}</p>
          )}
          {!isConnected && (
            <p className="text-xs text-[var(--muted-foreground)]">
              Open inside the Circles app and connect to fund.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
