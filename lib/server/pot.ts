/**
 * Live pot = the org's on-chain group-CRC balance (carry-over from prior days
 * + every entry fee paid so far). Cached briefly so the 15s leaderboard poll
 * doesn't hammer the staging RPC.
 */
import { getPermissionlessGroup } from "@/lib/permissionless-group";
import { ORG_ADDRESS } from "@/lib/circles-config";

let cache: { value: number; at: number } | null = null;
const TTL_MS = 30_000;

/** Org's spendable group-CRC, in whole CRC. Returns null on RPC failure. */
export async function getPotCrc(now = Date.now()): Promise<number | null> {
  if (cache && now - cache.at < TTL_MS) return cache.value;
  try {
    const group = getPermissionlessGroup();
    // The pot is the org Safe's group-CRC across ALL forms (native ERC1155 from
    // entries + any wrapped reserve left by a previous payout), normalized to
    // demurraged. `heldTotal` excludes migratable legacy CRC.
    const bal = await group.balance(ORG_ADDRESS as `0x${string}`);
    const crc = Number(bal.heldTotal / 10n ** 12n) / 1e6;
    cache = { value: crc, at: now };
    return crc;
  } catch (err) {
    console.warn("[pot] balance read failed:", err);
    return cache?.value ?? null;
  }
}
