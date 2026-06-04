"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useWallet } from "@/components/wallet/wallet-provider";
import {
  buildAuthorizeUrl,
  lichessRedirectUri,
  pkceChallenge,
  randomString,
} from "@/lib/lichess";
import { CheckCircle2, Link2, Loader2, ShieldCheck, Unlink } from "lucide-react";

type Phase =
  | "idle"
  | "signing"
  | "authorizing"
  | "connecting"
  | "connected"
  | "error";

export function LichessConnect() {
  const { address, isConnected, isMiniappHost, signMessage } = useWallet();
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [username, setUsername] = React.useState<string | null>(null);
  const [sigVerified, setSigVerified] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Load existing connection for this address.
  React.useEffect(() => {
    if (!address) {
      setUsername(null);
      setPhase("idle");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/lichess/status?address=${address}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.connected) {
          setUsername(data.username);
          setSigVerified(Boolean(data.sigVerified));
          setPhase("connected");
        } else {
          setPhase("idle");
        }
      } catch {
        if (!cancelled) setPhase("idle");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

  const connect = React.useCallback(async () => {
    if (!address) return;
    setError(null);

    // Open the consent popup *synchronously* on the click so the browser keeps
    // the user-gesture. Opening it after an await (e.g. signing first) is what
    // gets popups blocked even on hosts that allow them — a false negative.
    const popup = window.open("about:blank", "lichess-oauth", "width=480,height=720");
    if (!popup) {
      setError(
        "Your Circles host blocked the Lichess sign-in window. We'll switch to the tab-based flow."
      );
      setPhase("error");
      return;
    }

    // ── Circles side: prove the address by signing (host only). ──
    const nonce = randomString(8);
    const message = `Link my Lichess account to Circles ${address}\nnonce: ${nonce}`;
    let signature: string | undefined;
    if (isMiniappHost) {
      setPhase("signing");
      try {
        signature = (await signMessage(message)).signature;
      } catch {
        popup.close();
        setError("Wallet signature was declined.");
        setPhase("error");
        return;
      }
    }

    // ── Lichess side: drive the already-open popup to the OAuth consent (PKCE). ──
    const verifier = randomString(32);
    const challenge = await pkceChallenge(verifier);
    const state = randomString(16);
    const redirectUri = lichessRedirectUri();
    const authUrl = buildAuthorizeUrl({ challenge, state, redirectUri });

    setPhase("authorizing");
    popup.location.href = authUrl;

    const onMessage = async (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      if (ev.data?.type !== "lichess-oauth") return;
      window.removeEventListener("message", onMessage);
      const { code, state: returned, error: oauthErr } = ev.data;
      if (oauthErr || !code) {
        setError("Lichess authorization was cancelled.");
        setPhase("error");
        return;
      }
      if (returned !== state) {
        setError("Authorization state mismatch — please retry.");
        setPhase("error");
        return;
      }
      setPhase("connecting");
      try {
        const res = await fetch("/api/lichess/connect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            address,
            code,
            codeVerifier: verifier,
            redirectUri,
            message,
            signature,
          }),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          setUsername(data.username);
          setSigVerified(Boolean(data.sigVerified));
          setPhase("connected");
        } else {
          setError(data.error ?? "Could not link your Lichess account.");
          setPhase("error");
        }
      } catch {
        setError("Could not link your Lichess account.");
        setPhase("error");
      }
    };
    window.addEventListener("message", onMessage);
  }, [address, isMiniappHost, signMessage]);

  const disconnect = React.useCallback(async () => {
    if (!address) return;
    await fetch("/api/lichess/disconnect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
    });
    setUsername(null);
    setSigVerified(false);
    setPhase("idle");
  }, [address]);

  const busy = ["signing", "authorizing", "connecting"].includes(phase);
  const phaseLabel =
    phase === "signing"
      ? "Confirm in your wallet…"
      : phase === "authorizing"
        ? "Authorize on Lichess…"
        : "Linking…";

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5 text-[var(--primary)]" />
          Lichess
        </CardTitle>
        {username && (
          <Badge variant="success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {username}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {username ? (
          <>
            <p className="text-sm text-[var(--muted-foreground)]">
              Linked to{" "}
              <span className="font-semibold text-[var(--foreground)]">{username}</span>
              {sigVerified && (
                <span className="ml-1 inline-flex items-center gap-1 text-[var(--accent)]">
                  <ShieldCheck className="h-3.5 w-3.5" /> wallet-verified
                </span>
              )}
              .
            </p>
            <Button variant="outline" size="sm" onClick={disconnect}>
              <Unlink className="h-4 w-4" /> Disconnect
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-[var(--muted-foreground)]">
              Connect your Lichess account — sign with your Circles wallet and
              authorize on Lichess to link the two.
            </p>
            <Button
              className="w-full"
              disabled={!isConnected || busy}
              onClick={connect}
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {phaseLabel}
                </>
              ) : (
                <>
                  <Link2 className="h-4 w-4" />
                  Connect Lichess
                </>
              )}
            </Button>
            {!isConnected && (
              <p className="text-xs text-[var(--muted-foreground)]">
                Connect your Circles wallet first.
              </p>
            )}
          </>
        )}
        {error && <p className="text-xs text-[var(--destructive)]">{error}</p>}
      </CardContent>
    </Card>
  );
}
