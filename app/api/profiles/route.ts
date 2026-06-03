import { NextResponse } from "next/server";
import { getProfiles } from "@/lib/server/profiles";

export const dynamic = "force-dynamic";

/**
 * GET ?addresses=0x..,0x.. → { profiles: { [addressLower]: { name?, image? } } }
 * Resolves Circles profiles (name + avatar) in one batch, server-cached.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("addresses") ?? "";
  const addresses = raw
    .split(",")
    .map((a) => a.trim())
    .filter((a) => /^0x[a-fA-F0-9]{40}$/.test(a));

  if (addresses.length === 0) {
    return NextResponse.json({ profiles: {} });
  }

  const profiles = await getProfiles(addresses.slice(0, 50));
  // Profiles are stable; let the browser cache them briefly.
  return NextResponse.json(
    { profiles },
    { headers: { "Cache-Control": "public, max-age=300" } }
  );
}
