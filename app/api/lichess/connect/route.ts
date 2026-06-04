import { NextResponse } from "next/server";
import { createPublicClient, getAddress, http } from "viem";
import { gnosis } from "viem/chains";
import { getStore } from "@/lib/server/store";
import { LICHESS_CLIENT_ID, LICHESS_HOST } from "@/lib/lichess";
import { CIRCLES_RPC_URL } from "@/lib/circles-config";

export const dynamic = "force-dynamic";

/**
 * Complete the bilateral handshake and store the link.
 *
 * Body: { address, code, codeVerifier, redirectUri, message?, signature? }
 *   - Lichess side: exchange the OAuth `code` (PKCE) for a token and read the
 *     account → proves control of the Lichess account.
 *   - Circles side: verify the wallet `signature` over `message` (EIP-1271 via
 *     the Safe) → proves control of the Circles address.
 *
 * The token is used only to read the username and is then revoked.
 */
export async function POST(req: Request) {
  let body: {
    address?: string;
    code?: string;
    codeVerifier?: string;
    redirectUri?: string;
    message?: string;
    signature?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { address, code, codeVerifier, redirectUri, message, signature } = body;
  if (!address || !code || !codeVerifier || !redirectUri) {
    return NextResponse.json(
      { error: "address, code, codeVerifier and redirectUri are required" },
      { status: 400 }
    );
  }

  let addr: string;
  try {
    addr = getAddress(address);
  } catch {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  // ── Circles side: verify the wallet signature (best-effort; supports Safe). ──
  let sigVerified = false;
  if (message && signature) {
    try {
      const pc = createPublicClient({ chain: gnosis, transport: http(CIRCLES_RPC_URL) });
      sigVerified = await pc.verifyMessage({
        address: addr as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });
    } catch {
      sigVerified = false;
    }
  }

  // ── Lichess side: exchange the code for a token. ──
  const tokenRes = await fetch(`${LICHESS_HOST}/api/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      client_id: LICHESS_CLIENT_ID,
    }),
  });
  if (!tokenRes.ok) {
    return NextResponse.json({ error: "Lichess token exchange failed" }, { status: 502 });
  }
  const token = (await tokenRes.json())?.access_token as string | undefined;
  if (!token) {
    return NextResponse.json({ error: "No access token from Lichess" }, { status: 502 });
  }

  // Identify the user.
  const accRes = await fetch(`${LICHESS_HOST}/api/account`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const acc = accRes.ok ? await accRes.json() : null;
  const username: string | undefined = acc?.username;
  const lichessId: string | undefined = acc?.id;

  // We only needed identity — revoke the token.
  try {
    await fetch(`${LICHESS_HOST}/api/token`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    /* best effort */
  }

  if (!username || !lichessId) {
    return NextResponse.json({ error: "Could not read Lichess account" }, { status: 502 });
  }

  const conn = {
    username,
    lichessId,
    address: addr.toLowerCase(),
    connectedAt: Date.now(),
    sigVerified,
  };
  await getStore().setLichess(addr.toLowerCase(), conn);

  return NextResponse.json({ ok: true, username, sigVerified });
}
