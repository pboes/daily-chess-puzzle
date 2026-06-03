import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { getStore } from "@/lib/server/store";
import { todayKey } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Finalize the player's attempt — exactly once. The solve time is computed
 * server-side (`finishedAt - startedAt`), so the client can't report a fake
 * time. Body: { address, solved, lives }.
 */
export async function POST(req: Request) {
  let body: { address?: string; solved?: boolean; lives?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.address || typeof body.solved !== "boolean") {
    return NextResponse.json(
      { error: "address and solved are required" },
      { status: 400 }
    );
  }

  let address: string;
  try {
    address = getAddress(body.address).toLowerCase();
  } catch {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const store = getStore();
  const day = todayKey();

  const attempt = await store.finishAttempt(day, address, {
    solved: body.solved,
    lives: Math.max(0, Math.min(3, Math.floor(body.lives ?? 0))),
    finishedAt: Date.now(),
  });

  if (!attempt) {
    return NextResponse.json(
      { error: "No attempt to finish — start one first" },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true, attempt });
}
