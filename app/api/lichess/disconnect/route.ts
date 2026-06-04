import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { getStore } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** POST { address } → unlink the Lichess account. */
export async function POST(req: Request) {
  let body: { address?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.address) return NextResponse.json({ error: "address required" }, { status: 400 });
  let addr: string;
  try {
    addr = getAddress(body.address).toLowerCase();
  } catch {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  await getStore().deleteLichess(addr);
  return NextResponse.json({ ok: true });
}
