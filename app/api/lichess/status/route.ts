import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { getStore } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** GET ?address=0x... → the linked Lichess account, if any. */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("address");
  if (!raw) return NextResponse.json({ connected: false });
  let addr: string;
  try {
    addr = getAddress(raw).toLowerCase();
  } catch {
    return NextResponse.json({ connected: false });
  }
  const conn = await getStore().getLichess(addr);
  return NextResponse.json({
    connected: Boolean(conn),
    username: conn?.username ?? null,
    sigVerified: conn?.sigVerified ?? false,
  });
}
