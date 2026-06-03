import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { getStore } from "@/lib/server/store";
import { todayKey } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Begin the player's ONE attempt for today. Requires a paid entry. Idempotent:
 * if they already have an attempt (started or finished), it's returned as-is —
 * the clock never resets, so a reload can't buy a fresh start. Body: { address }.
 *
 * The returned `startedAt` is the server clock; the client renders the timer as
 * `now - startedAt`, and the official solve time is computed server-side at
 * finish.
 */
export async function POST(req: Request) {
  let body: { address?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  let address: string;
  try {
    address = getAddress(body.address).toLowerCase();
  } catch {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const store = getStore();
  const day = todayKey();

  if (!(await store.getEntry(day, address))) {
    return NextResponse.json(
      { error: "Pay the entry fee before starting your attempt" },
      { status: 403 }
    );
  }

  const existing = await store.getAttempt(day, address);
  const attempt = existing ?? (await store.startAttempt(day, address, Date.now()));

  return NextResponse.json({
    ok: true,
    resumed: Boolean(existing),
    attempt,
    serverNow: Date.now(),
  });
}
