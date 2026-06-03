import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { getStore } from "@/lib/server/store";
import { verifyEntryPayment } from "@/lib/server/verify-payment";
import { todayKey } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Record a paid entry for today after verifying the on-chain entry-fee
 * transfer into the org address. Body: { address, txHash }.
 */
export async function POST(req: Request) {
  let body: { address?: string; txHash?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { address, txHash } = body;
  if (!address || !txHash) {
    return NextResponse.json({ error: "address and txHash are required" }, { status: 400 });
  }

  let normalized: string;
  try {
    normalized = getAddress(address);
  } catch {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const store = getStore();
  const day = todayKey();

  // Already entered today? Idempotent success.
  const existing = await store.getEntry(day, normalized.toLowerCase());
  if (existing) {
    return NextResponse.json({ ok: true, alreadyEntered: true, entry: existing });
  }

  // Prevent the same payment tx from unlocking multiple accounts.
  if (await store.isTxUsed(txHash)) {
    return NextResponse.json({ error: "This payment was already used" }, { status: 409 });
  }

  const result = await verifyEntryPayment(txHash, normalized);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Payment verification failed" }, { status: 402 });
  }

  await store.markTxUsed(txHash);
  const entry = {
    address: normalized.toLowerCase(),
    txHash,
    enteredAt: Date.now(),
  };
  await store.addEntry(day, entry);

  return NextResponse.json({ ok: true, entry, payment: result });
}

/** GET ?address=0x... → whether this address has entered today. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = url.searchParams.get("address");
  if (!address) return NextResponse.json({ entered: false });
  let normalized: string;
  try {
    normalized = getAddress(address).toLowerCase();
  } catch {
    return NextResponse.json({ entered: false });
  }
  const entry = await getStore().getEntry(todayKey(), normalized);
  return NextResponse.json({ entered: Boolean(entry), entry });
}
