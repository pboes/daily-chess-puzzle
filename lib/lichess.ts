/**
 * Lichess OAuth2 (Authorization Code + PKCE) config and browser helpers.
 *
 * Lichess is a public client: no app registration, no client secret — you pick
 * an arbitrary `client_id` and the only accepted challenge method is S256.
 * Authorize at `${host}/oauth`, exchange at `${host}/api/token`, identify via
 * `${host}/api/account`.
 *
 * We run the consent in a popup (Lichess can't be iframed) and exchange the
 * code server-side, so the access token never touches the client.
 */
export const LICHESS_HOST = "https://lichess.org";
export const LICHESS_CLIENT_ID = "daily-chess-duel";
/** Empty scope = identify only (read the public account/username). */
export const LICHESS_SCOPES: string[] = [];

/** Popup callback URL — works on any deployment (preview or prod) since Lichess
 *  doesn't pre-register redirect URIs; authorize & token just have to match. */
export function lichessRedirectUri(): string {
  return `${window.location.origin}/lichess/callback`;
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomString(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return base64url(a);
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function buildAuthorizeUrl(opts: {
  challenge: string;
  state: string;
  redirectUri: string;
}): string {
  const u = new URL(`${LICHESS_HOST}/oauth`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", LICHESS_CLIENT_ID);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  if (LICHESS_SCOPES.length) u.searchParams.set("scope", LICHESS_SCOPES.join(" "));
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("code_challenge", opts.challenge);
  u.searchParams.set("state", opts.state);
  return u.toString();
}

export interface LichessConnection {
  username: string;
  lichessId: string;
  address: string;
  connectedAt: number;
  /** Whether the Circles-side wallet signature was verified (the 2nd handshake). */
  sigVerified: boolean;
}
