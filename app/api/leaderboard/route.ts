import { NextResponse, after } from "next/server";
import { getAddress } from "viem";
import { getStore } from "@/lib/server/store";
import { getPotCrc } from "@/lib/server/pot";
import { maybeSettleStaleDays } from "@/lib/server/settle";
import { todayKey } from "@/lib/utils";
import { ENTRY_FEE_CRC } from "@/lib/circles-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET ?address=0x... → today's ranking, pot size, and the caller's standing. */
export async function GET(req: Request) {
  // Lazily settle any unsettled past day after the response is sent, so the
  // winner is paid from normal usage even if the cron misses. Safe now that the
  // store is atomic: `claimDay` (SET NX) makes settlement exactly-once and
  // per-key writes can't clobber attempts.
  after(() => maybeSettleStaleDays());

  const store = getStore();
  const day = todayKey();

  const [attempts, entries, livePot] = await Promise.all([
    store.listAttempts(day),
    store.listEntries(day),
    getPotCrc(),
  ]);

  type Status = "solved" | "playing" | "failed";
  type Row = {
    rank: number | null;
    address: string;
    timeMs: number | null;
    status: Status;
  };

  // Every paid entrant appears. Classify by their attempt:
  //   solved  → ranked by time (eligible for the pot)
  //   failed  → out of lives (DNF)
  //   else    → still in it ("playing": entered, not yet finished)
  const attemptByAddr = new Map(attempts.map((a) => [a.address, a]));

  const solved: Array<Row & { sort: number }> = [];
  const playing: Array<Row & { sort: number }> = [];
  const failed: Array<Row & { sort: number }> = [];

  for (const e of entries) {
    const a = attemptByAddr.get(e.address);
    if (a?.status === "solved" && typeof a.timeMs === "number") {
      solved.push({ rank: 0, address: e.address, timeMs: a.timeMs, status: "solved", sort: a.timeMs });
    } else if (a?.status === "failed") {
      failed.push({ rank: null, address: e.address, timeMs: null, status: "failed", sort: a.finishedAt ?? 0 });
    } else {
      playing.push({ rank: null, address: e.address, timeMs: null, status: "playing", sort: e.enteredAt });
    }
  }

  solved.sort((a, b) => a.sort - b.sort).forEach((r, i) => (r.rank = i + 1));
  playing.sort((a, b) => a.sort - b.sort);
  failed.sort((a, b) => a.sort - b.sort);

  const leaderboard: Row[] = [...solved, ...playing, ...failed].map(
    ({ sort, ...r }) => r // eslint-disable-line @typescript-eslint/no-unused-vars
  );

  // Pot = the org's live on-chain balance (carry-over + today's entries). Fall
  // back to today's entry sum if the RPC read fails.
  const potCrc = livePot ?? entries.length * ENTRY_FEE_CRC;
  // Winner takes 90% of the current pot; 10% rolls into tomorrow.
  const reserveCrc = Math.round(potCrc * 0.1 * 1000) / 1000;
  const winnerTakesCrc = Math.round((potCrc - reserveCrc) * 1000) / 1000;

  let me: { rank: number | null; timeMs: number | null; status: Status } | null = null;
  const url = new URL(req.url);
  const addr = url.searchParams.get("address");
  if (addr) {
    try {
      const norm = getAddress(addr).toLowerCase();
      const found = leaderboard.find((r) => r.address === norm);
      if (found) me = { rank: found.rank, timeMs: found.timeMs, status: found.status };
    } catch {
      /* ignore */
    }
  }

  return NextResponse.json(
    {
      day,
      potCrc,
      winnerTakesCrc,
      reserveCrc,
      entrants: entries.length,
      solvers: solved.length,
      playing: playing.length,
      dnf: failed.length,
      leaderboard: leaderboard.slice(0, 50),
      me,
    },
    // Never edge-cache: the pot and rankings must always be live.
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
