"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Coins, Crown, Skull } from "lucide-react";
import { formatTime, shortenAddress } from "@/lib/utils";

/** Trim trailing zeros from a CRC amount for display. */
const fmt = (n: number) => Number(n.toFixed(3)).toString();

interface Profile {
  name?: string;
  image?: string;
}

type Status = "solved" | "playing" | "failed";

interface Row {
  rank: number | null;
  address: string;
  timeMs: number | null;
  status: Status;
}

interface LeaderboardData {
  day: string;
  potCrc: number;
  winnerTakesCrc: number;
  reserveCrc: number;
  entrants: number;
  solvers: number;
  playing: number;
  dnf: number;
  leaderboard: Row[];
  me: { rank: number | null; timeMs: number | null; status: Status } | null;
}

export function Leaderboard({
  address,
  refreshKey,
  pendingMe,
}: {
  address: string | null;
  refreshKey: number;
  /** The player's just-finished solve, shown instantly before the server reload. */
  pendingMe?: { address: string; timeMs: number } | null;
}) {
  const [data, setData] = React.useState<LeaderboardData | null>(null);
  const [profiles, setProfiles] = React.useState<Record<string, Profile>>({});

  const load = React.useCallback(async () => {
    try {
      const q = address ? `?address=${address}` : "";
      const res = await fetch(`/api/leaderboard${q}`, { cache: "no-store" });
      setData(await res.json());
    } catch {
      /* ignore transient errors */
    }
  }, [address]);

  React.useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load, refreshKey]);

  // Resolve Circles profiles for any new addresses on the board (cached, so the
  // 15s poll doesn't re-fetch avatars we already have).
  React.useEffect(() => {
    const addrs = (data?.leaderboard ?? []).map((r) => r.address);
    if (pendingMe) addrs.push(pendingMe.address);
    const missing = addrs.filter((a) => !(a in profiles));
    if (missing.length === 0) return;
    (async () => {
      try {
        const res = await fetch(`/api/profiles?addresses=${missing.join(",")}`);
        const json = await res.json();
        setProfiles((prev) => ({ ...prev, ...json.profiles }));
      } catch {
        /* leave addresses unresolved; we fall back to the short address */
      }
    })();
  }, [data, profiles, pendingMe?.address]);

  const myAddr = address?.toLowerCase();

  // Merge the player's just-finished solve in immediately (optimistic), so they
  // see their result before the server reload reconciles the exact ranking.
  const rows = React.useMemo<Row[]>(() => {
    const base = data?.leaderboard ?? [];
    if (!pendingMe) return base;
    if (base.some((r) => r.address === pendingMe.address && r.status === "solved")) {
      return base;
    }
    const withoutMe = base.filter((r) => r.address !== pendingMe.address);
    const merged: Row[] = [
      ...withoutMe,
      { rank: null, address: pendingMe.address, timeMs: pendingMe.timeMs, status: "solved" },
    ];
    const solved = merged
      .filter((r) => r.status === "solved")
      .sort((a, b) => (a.timeMs ?? 0) - (b.timeMs ?? 0))
      .map((r, i) => ({ ...r, rank: i + 1 }));
    const rest = merged.filter((r) => r.status !== "solved");
    return [...solved, ...rest];
  }, [data, pendingMe]);

  const me =
    data?.me ??
    (pendingMe
      ? {
          rank: rows.find((r) => r.address === pendingMe.address)?.rank ?? null,
          timeMs: pendingMe.timeMs,
          status: "solved" as Status,
        }
      : null);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Crown className="h-5 w-5 text-[var(--accent)]" />
          Today&apos;s Leaderboard
        </CardTitle>
        <Badge variant="success">
          <Coins className="h-3.5 w-3.5" />
          Pot: {fmt(data?.potCrc ?? 0)} CRC
        </Badge>
      </CardHeader>
      <CardContent className="space-y-1">
        {data && (
          <p className="-mt-1 mb-2 text-center text-xs text-[var(--muted-foreground)]">
            Winner takes{" "}
            <span className="font-semibold text-[var(--accent)]">
              {fmt(data.winnerTakesCrc)} CRC
            </span>
            {data.reserveCrc > 0 && (
              <>
                {" "}· {fmt(data.reserveCrc)} CRC rolls into tomorrow
              </>
            )}
          </p>
        )}
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">
            No entrants yet today. Be the first to claim the pot.
          </p>
        ) : (
          rows.map((row) => {
            const isMe = row.address === myAddr;
            const dnf = row.status === "failed";
            const playing = row.status === "playing";
            return (
              <div
                key={row.address}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                  isMe ? "bg-[var(--primary)]/15 ring-1 ring-[var(--primary)]/40" : ""
                } ${dnf ? "opacity-60" : ""}`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      row.status === "solved"
                        ? row.rank === 1
                          ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                          : "bg-[var(--secondary)] text-[var(--muted-foreground)]"
                        : "bg-transparent text-[var(--muted-foreground)]"
                    }`}
                  >
                    {dnf ? (
                      <Skull className="h-3.5 w-3.5" />
                    ) : playing ? (
                      <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--primary)]" />
                    ) : (
                      row.rank
                    )}
                  </span>
                  <Avatar profile={profiles[row.address]} address={row.address} />
                  <span className="min-w-0 truncate font-medium">
                    {profiles[row.address]?.name || shortenAddress(row.address)}
                  </span>
                  {isMe && <Badge>you</Badge>}
                </div>
                {dnf ? (
                  <Badge variant="danger">DNF</Badge>
                ) : playing ? (
                  <Badge variant="muted">Playing…</Badge>
                ) : (
                  <span className="font-mono tabular-nums">{formatTime(row.timeMs ?? 0)}</span>
                )}
              </div>
            );
          })
        )}

        {me && (
          <p className="pt-2 text-center text-xs text-[var(--muted-foreground)]">
            {me.status === "solved"
              ? `Your time today: rank #${me.rank} · ${formatTime(me.timeMs ?? 0)}`
              : me.status === "failed"
                ? "You're out of lives today — DNF. Back tomorrow!"
                : "You're entered — finish your attempt to lock in a time."}
          </p>
        )}
        <p className="pt-1 text-center text-[11px] text-[var(--muted-foreground)]/70">
          {data?.entrants ?? 0} entrant(s) · {data?.solvers ?? 0} solved
          {data && data.playing > 0 ? ` · ${data.playing} playing` : ""}
          {data && data.dnf > 0 ? ` · ${data.dnf} DNF` : ""}
        </p>
      </CardContent>
    </Card>
  );
}

/** Circles avatar — the profile's preview image, or a colour-coded initial. */
function Avatar({ profile, address }: { profile?: Profile; address: string }) {
  const [broken, setBroken] = React.useState(false);
  const letter = (profile?.name?.[0] ?? address[2] ?? "?").toUpperCase();
  // Deterministic hue from the address so fallbacks are stable & distinct.
  const hue = parseInt(address.slice(2, 8), 16) % 360;

  if (profile?.image && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={profile.image}
        alt=""
        onError={() => setBroken(true)}
        className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-[var(--border)]"
      />
    );
  }
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ring-1 ring-[var(--border)]"
      style={{ backgroundColor: `hsl(${hue} 55% 45%)` }}
    >
      {letter}
    </span>
  );
}
