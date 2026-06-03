"use client";

import * as React from "react";
import { useWallet } from "@/components/wallet/wallet-provider";
import { Badge } from "@/components/ui/badge";
import { shortenAddress } from "@/lib/utils";
import { Crown } from "lucide-react";

export function Header() {
  const { address, isConnected } = useWallet();
  const taps = React.useRef<number[]>([]);
  // Show /logo.png when present; fall back to the ♞ glyph until it's added.
  const [hasLogo, setHasLogo] = React.useState(true);

  // Secret gesture: 5 taps on the logo within 3s reveals the "seed the pot"
  // admin panel (see components/fund-pot.tsx).
  const onLogoTap = () => {
    const now = Date.now();
    taps.current = [...taps.current, now].filter((t) => now - t < 3000);
    if (taps.current.length >= 5) {
      taps.current = [];
      window.dispatchEvent(new CustomEvent("dcp:unlock-fund"));
    }
  };

  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between py-5">
      <div className="flex items-center gap-2.5">
        <button
          onClick={onLogoTap}
          aria-label="Daily Chess Duel"
          className={`flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl text-lg text-white shadow-sm ${
            hasLogo ? "" : "bg-[var(--primary)]"
          }`}
        >
          {hasLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/logo.png"
              alt="Daily Chess Duel"
              className="h-full w-full object-cover"
              onError={() => setHasLogo(false)}
            />
          ) : (
            "♞"
          )}
        </button>
        <div className="leading-tight">
          <h1 className="text-base font-bold">Daily Chess Duel</h1>
          <p className="flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
            <Crown className="h-3 w-3 text-[var(--accent)]" />
            Fastest solve wins the pot
          </p>
        </div>
      </div>
      {isConnected ? (
        <Badge variant="success">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          {shortenAddress(address)}
        </Badge>
      ) : (
        <Badge variant="muted">Not connected</Badge>
      )}
    </header>
  );
}
