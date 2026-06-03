/**
 * Resolve Circles addresses → display profile (name + avatar image) via the
 * Circles RPC batch method `circles_getProfileByAddressBatch`. Server-side so
 * we avoid CORS and can cache; the `previewImageUrl` is a small base64 data URI
 * that renders directly (no IPFS round-trip).
 */
import { CIRCLES_RPC_URL } from "@/lib/circles-config";

export interface PublicProfile {
  name?: string;
  /** A renderable image (base64 data URI or https URL), if any. */
  image?: string;
}

interface RawProfile {
  address: string;
  name?: string;
  previewImageUrl?: string;
  imageUrl?: string;
}

// Profiles rarely change — cache each address for a while.
const cache = new Map<string, { value: PublicProfile; at: number }>();
const TTL_MS = 10 * 60_000;

const pickImage = (p: RawProfile): string | undefined => {
  if (p.previewImageUrl) return p.previewImageUrl;
  if (p.imageUrl && /^https?:\/\//.test(p.imageUrl)) return p.imageUrl;
  return undefined;
};

export async function getProfiles(
  addresses: string[],
  now = Date.now()
): Promise<Record<string, PublicProfile>> {
  const lower = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const out: Record<string, PublicProfile> = {};
  const missing: string[] = [];

  for (const addr of lower) {
    const hit = cache.get(addr);
    if (hit && now - hit.at < TTL_MS) out[addr] = hit.value;
    else missing.push(addr);
  }
  if (missing.length === 0) return out;

  try {
    const res = await fetch(CIRCLES_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "circles_getProfileByAddressBatch",
        params: [missing],
      }),
    });
    const data = await res.json();
    const results: (RawProfile | null)[] = data?.result ?? [];
    missing.forEach((addr, i) => {
      const p = results[i];
      const profile: PublicProfile = p
        ? { name: p.name, image: pickImage(p) }
        : {};
      cache.set(addr, { value: profile, at: now });
      out[addr] = profile;
    });
  } catch (err) {
    console.warn("[profiles] batch fetch failed:", err);
    // Return empty profiles for the missing ones rather than failing the page.
    for (const addr of missing) out[addr] = {};
  }

  return out;
}
