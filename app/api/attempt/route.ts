import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { getStore } from "@/lib/server/store";
import { todayKey } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** GET ?address=0x... → the caller's attempt state for today (for UI gating). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("address");
  if (!raw) return NextResponse.json({ attempt: null, serverNow: Date.now() });

  let address: string;
  try {
    address = getAddress(raw).toLowerCase();
  } catch {
    return NextResponse.json({ attempt: null, serverNow: Date.now() });
  }

  const attempt = await getStore().getAttempt(todayKey(), address);
  return NextResponse.json({ attempt, serverNow: Date.now() });
}
