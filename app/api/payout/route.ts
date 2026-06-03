import { NextResponse } from "next/server";
import { settleDay, settleStaleDays } from "@/lib/server/settle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Settle the competition and pay winners.
 *
 * Triggered by:
 *   - Vercel Cron (GET, `x-vercel-cron` header) — daily catch-up.
 *   - Manual admin (GET or POST with `Authorization: Bearer <ADMIN_SECRET>`).
 *
 * No `?day=` → settle every unsettled finished day (catch up any the cron
 * missed). `?day=YYYY-MM-DD` → settle just that day. Idempotent and
 * claim-guarded; safe to call repeatedly.
 */
async function settle(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.ADMIN_SECRET;
  const isCron = req.headers.get("x-vercel-cron") != null;
  if (!isCron && (!secret || auth !== `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const day = new URL(req.url).searchParams.get("day");
  if (day) {
    const result = await settleDay(day);
    return NextResponse.json({ ok: result.status !== "error", result });
  }

  const results = await settleStaleDays();
  return NextResponse.json({ ok: true, settled: results });
}

export const GET = settle;
export const POST = settle;
