/**
 * Daily settlement — picks the fastest solver and pays them the pot.
 *
 * Settlement is **idempotent and claim-guarded** so it can be triggered from
 * several places without double-paying:
 *   - the Vercel cron (best-effort on Hobby — don't rely on it alone),
 *   - a manual admin call to /api/payout,
 *   - lazily, whenever the app is used (see `maybeSettleStaleDays`).
 *
 * `claimDay` reserves a day before any funds move; the payout is also
 * balance-based (90% of whatever the org currently holds), so even a rare
 * cross-instance double-run just pays the winner a sliver more of the
 * remainder rather than truly paying twice.
 */
import { getStore } from "./store";
import { payoutWinner } from "./payout";
import { todayKey } from "@/lib/utils";

export interface SettleResult {
  day: string;
  status: "paid" | "carried-over" | "already-paid" | "busy" | "error";
  winner?: string;
  amountAtto?: string;
  txHashes?: string[];
  error?: string;
}

/** Settle one finished day. Safe to call repeatedly. */
export async function settleDay(day: string, now = Date.now()): Promise<SettleResult> {
  const store = getStore();

  if (await store.isPaidOut(day)) return { day, status: "already-paid" };

  const solved = (await store.listAttempts(day))
    .filter((a) => a.status === "solved" && typeof a.timeMs === "number")
    .sort((a, b) => (a.timeMs ?? 0) - (b.timeMs ?? 0));

  // No solver → no payout → the pot carries over untouched.
  if (solved.length === 0) return { day, status: "carried-over" };

  // Reserve the day before moving funds.
  if (!(await store.claimDay(day, now))) return { day, status: "busy" };

  const winner = solved[0];
  try {
    const result = await payoutWinner(winner.address);
    await store.markPaidOut(day, { ...result, settledAt: now });
    return {
      day,
      status: "paid",
      winner: result.winner,
      amountAtto: result.amountAtto,
      txHashes: result.txHashes,
    };
  } catch (err) {
    await store.unclaimDay(day); // let it be retried
    return { day, status: "error", error: String(err) };
  }
}

/** Settle every finished day (before today) that hasn't been paid yet. */
export async function settleStaleDays(now = Date.now()): Promise<SettleResult[]> {
  const store = getStore();
  const today = todayKey(new Date(now));
  const days = (await store.listDays()).filter((d) => d < today).sort();
  const results: SettleResult[] = [];
  for (const day of days) {
    if (await store.isPaidOut(day)) continue;
    results.push(await settleDay(day, now));
  }
  return results;
}

// Throttle the lazy trigger so a polled endpoint doesn't hammer the store.
let lastLazyCheck = 0;

/** Fire-and-forget catch-up used from request handlers; runs at most once a
 *  minute per instance and never throws into the caller. */
export async function maybeSettleStaleDays(now = Date.now()): Promise<void> {
  if (now - lastLazyCheck < 60_000) return;
  lastLazyCheck = now;
  try {
    await settleStaleDays(now);
  } catch (err) {
    console.warn("[settle] lazy settlement failed:", err);
  }
}
