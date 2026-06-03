"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChessBoard } from "@/components/chess/chess-board";
import { PuzzleHud } from "@/components/chess/puzzle-hud";
import { Leaderboard } from "@/components/leaderboard";
import { useWallet } from "@/components/wallet/wallet-provider";
import { useEntry } from "@/hooks/use-entry";
import { useChessPuzzle } from "@/hooks/use-chess-puzzle";
import { type DailyPuzzle } from "@/lib/puzzle";
import { formatTime } from "@/lib/utils";
import { Coins, Loader2, Play, Sparkles, Wallet, XCircle } from "lucide-react";

interface Attempt {
  address: string;
  startedAt: number;
  status: "started" | "solved" | "failed";
  timeMs?: number;
  lives?: number;
}

export function Game() {
  const { address, isConnected, isMiniappHost } = useWallet();
  const entry = useEntry();
  const [puzzle, setPuzzle] = React.useState<DailyPuzzle | null>(null);
  const [puzzleError, setPuzzleError] = React.useState<string | null>(null);
  const [lbKey, setLbKey] = React.useState(0);

  // Server-side attempt state (the single source of truth for "one per day").
  const [attempt, setAttempt] = React.useState<Attempt | null>(null);
  const [attemptLoaded, setAttemptLoaded] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const finishedRef = React.useRef(false);

  const game = useChessPuzzle(puzzle);

  // Load today's puzzle once.
  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/puzzle/today", { cache: "no-store" });
        if (!res.ok) throw new Error("Could not load today's puzzle");
        setPuzzle(await res.json());
      } catch (err) {
        setPuzzleError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  // Once entered, fetch the player's attempt. Resume a live one, or lock a
  // finished one. This is what enforces a single attempt across reloads.
  React.useEffect(() => {
    if (!address || !entry.entered) {
      setAttempt(null);
      setAttemptLoaded(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/attempt?address=${address}`, { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        setAttempt(data.attempt ?? null);
        setAttemptLoaded(true);
        // Resume an in-progress attempt: re-anchor the clock to the server start.
        if (data.attempt?.status === "started" && puzzle) {
          finishedRef.current = false;
          game.start(data.attempt.startedAt);
        }
      } catch {
        if (!cancelled) setAttemptLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, entry.entered, puzzle]);

  // Begin the one attempt: ask the server to stamp the start, then run the clock.
  const onStart = React.useCallback(async () => {
    if (!address || starting) return;
    setStarting(true);
    try {
      const res = await fetch("/api/attempt/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      if (res.ok && data.attempt) {
        setAttempt(data.attempt);
        if (data.attempt.status === "started") {
          finishedRef.current = false;
          game.start(data.attempt.startedAt);
        }
      }
    } finally {
      setStarting(false);
    }
  }, [address, starting, game]);

  // Finalize the attempt server-side exactly once when it ends. Retry on
  // failure so a lost network call can't leave the attempt stuck as "started"
  // (which would wrongly show the player as still playing / let them resume).
  React.useEffect(() => {
    if (game.status !== "solved" && game.status !== "failed") return;
    if (finishedRef.current || !address) return;
    finishedRef.current = true;
    const solved = game.status === "solved";
    const lives = game.lives;
    let cancelled = false;
    (async () => {
      for (let attemptNo = 0; attemptNo < 6 && !cancelled; attemptNo++) {
        try {
          const res = await fetch("/api/attempt/finish", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ address, solved, lives }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.attempt) setAttempt(data.attempt);
            setLbKey((k) => k + 1);
            return;
          }
        } catch {
          /* transient — retry below */
        }
        await new Promise((r) => setTimeout(r, 1000 * (attemptNo + 1)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [game.status, game.lives, address]);

  // What the overlay should show. Live game end-state takes priority this
  // session; otherwise a finished server attempt locks the player out.
  const liveEnded = game.status === "solved" || game.status === "failed";
  const lockedOutcome =
    !liveEnded && (attempt?.status === "solved" || attempt?.status === "failed")
      ? attempt
      : null;
  const showOverlay = game.status !== "playing";

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* ---- Board column ---- */}
      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[var(--primary)]" />
            Daily Puzzle
          </CardTitle>
          {puzzle && (
            <div className="flex items-center gap-2">
              <Badge variant="muted">★ {puzzle.rating}</Badge>
              <Badge>{puzzle.solverColor === "w" ? "White to move" : "Black to move"}</Badge>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {puzzleError && (
            <p className="rounded-lg bg-[var(--destructive)]/15 px-3 py-2 text-sm text-[var(--destructive)]">
              {puzzleError}
            </p>
          )}

          {(game.status === "playing" || liveEnded) && (
            <PuzzleHud
              elapsedMs={game.elapsedMs}
              lives={game.lives}
              progress={game.progress}
              total={game.totalSolverMoves}
            />
          )}

          <div className="relative">
            {puzzle ? (
              <ChessBoard
                fen={game.fen}
                orientation={game.boardOrientation}
                lastMove={game.lastMove}
                onMove={game.attemptMove}
                disabled={game.status !== "playing" || game.isOpponentMoving}
                wrong={game.lastWasWrong}
              />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-[var(--secondary)]/40">
                <Loader2 className="h-8 w-8 animate-spin text-[var(--muted-foreground)]" />
              </div>
            )}

            {puzzle && showOverlay && (
              <Overlay>
                <GateContent
                  liveStatus={game.status}
                  liveElapsedMs={game.elapsedMs}
                  lockedOutcome={lockedOutcome}
                  entry={entry}
                  isConnected={isConnected}
                  isMiniappHost={isMiniappHost}
                  attemptLoaded={attemptLoaded}
                  starting={starting}
                  onStart={onStart}
                />
              </Overlay>
            )}
          </div>

          {puzzle && game.status === "playing" && (
            <p className="text-center text-xs text-[var(--muted-foreground)]">
              3 lives · a wrong move costs a life &amp; resets the board — but the
              clock keeps running
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---- Side column ---- */}
      <div className="space-y-5">
        <Leaderboard address={address} refreshKey={lbKey} />
      </div>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-[var(--background)]/82 backdrop-blur-sm">
      <div className="w-full max-w-xs px-4 text-center">{children}</div>
    </div>
  );
}

function Solved({ timeMs }: { timeMs: number }) {
  return (
    <div className="space-y-3">
      <div className="text-4xl">🏆</div>
      <h3 className="text-lg font-semibold">Solved!</h3>
      <p className="font-mono text-2xl font-bold text-[var(--accent)]">{formatTime(timeMs)}</p>
      <p className="text-sm text-[var(--muted-foreground)]">
        Your time is locked in. Fastest at 00:00 UTC wins the pot.
      </p>
    </div>
  );
}

function Failed({ timeMs }: { timeMs?: number }) {
  return (
    <div className="space-y-3">
      <XCircle className="mx-auto h-10 w-10 text-[var(--destructive)]" />
      <h3 className="text-lg font-semibold">Out of lives</h3>
      <p className="text-sm text-[var(--muted-foreground)]">
        You used all three lives{typeof timeMs === "number" ? ` after ${formatTime(timeMs)}` : ""}.
        That was your one attempt for today — come back tomorrow.
      </p>
    </div>
  );
}

function GateContent({
  liveStatus,
  liveElapsedMs,
  lockedOutcome,
  entry,
  isConnected,
  isMiniappHost,
  attemptLoaded,
  starting,
  onStart,
}: {
  liveStatus: string;
  liveElapsedMs: number;
  lockedOutcome: Attempt | null;
  entry: ReturnType<typeof useEntry>;
  isConnected: boolean;
  isMiniappHost: boolean;
  attemptLoaded: boolean;
  starting: boolean;
  onStart: () => void;
}) {
  // End-of-attempt this session.
  if (liveStatus === "solved") return <Solved timeMs={liveElapsedMs} />;
  if (liveStatus === "failed") return <Failed timeMs={liveElapsedMs} />;

  // Finished a prior session (reload) — locked out for the day.
  if (lockedOutcome?.status === "solved") return <Solved timeMs={lockedOutcome.timeMs ?? 0} />;
  if (lockedOutcome?.status === "failed") return <Failed timeMs={lockedOutcome.timeMs} />;

  // Not in the Circles host.
  if (!isMiniappHost) {
    return (
      <div className="space-y-3">
        <Wallet className="mx-auto h-9 w-9 text-[var(--primary)]" />
        <h3 className="text-base font-semibold">Open in the Circles app</h3>
        <p className="text-sm text-[var(--muted-foreground)]">
          This mini-app runs inside the Circles host, which connects your wallet
          and signs the entry payment.
        </p>
      </div>
    );
  }

  // Connected but not entered → pay gate.
  if (!entry.entered) {
    const busy = ["checking", "migrating", "building", "signing", "verifying"].includes(
      entry.phase
    );
    return (
      <div className="space-y-3">
        <Coins className="mx-auto h-9 w-9 text-[var(--accent)]" />
        <h3 className="text-base font-semibold">Enter today&apos;s competition</h3>
        <p className="text-sm text-[var(--muted-foreground)]">
          Pay <span className="font-semibold text-[var(--foreground)]">{entry.feeCrc} group-CRC</span>{" "}
          to play today. One attempt, 3 lives — fastest solve wins the pot.
        </p>
        {entry.balanceCrc != null && (
          <p className="text-xs text-[var(--muted-foreground)]">
            Spendable: {entry.balanceCrc} gCRC
            {entry.needsMigration && (
              <span className="block text-[11px] opacity-80">
                We&apos;ll migrate ~{entry.feeCrc} gCRC of your CRC to cover the entry.
              </span>
            )}
          </p>
        )}
        <Button
          variant="accent"
          className="w-full"
          disabled={!isConnected || busy}
          onClick={entry.payAndEnter}
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {phaseLabel(entry.phase)}
            </>
          ) : (
            <>
              <Coins className="h-4 w-4" />
              {entry.needsMigration
                ? `Migrate & Play (${entry.feeCrc} gCRC)`
                : `Pay ${entry.feeCrc} gCRC & Play`}
            </>
          )}
        </Button>
        {entry.error && <p className="text-xs text-[var(--destructive)]">{entry.error}</p>}
      </div>
    );
  }

  // Entered, no attempt yet → start gate (still loading attempt state? spinner).
  if (!attemptLoaded) {
    return <Loader2 className="mx-auto h-7 w-7 animate-spin text-[var(--muted-foreground)]" />;
  }

  return (
    <div className="space-y-3">
      <Sparkles className="mx-auto h-9 w-9 text-[var(--primary)]" />
      <h3 className="text-base font-semibold">You&apos;re in!</h3>
      <p className="text-sm text-[var(--muted-foreground)]">
        One attempt today, with <span className="font-semibold text-[var(--foreground)]">3 lives</span>.
        A wrong move costs a life and resets the board — but the clock starts the
        instant you press play and never stops, even if you reload. So be ready.
      </p>
      <Button className="w-full" disabled={starting} onClick={onStart}>
        {starting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Starting…
          </>
        ) : (
          <>
            <Play className="h-4 w-4" />
            Start the clock
          </>
        )}
      </Button>
    </div>
  );
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case "checking":
      return "Checking balance…";
    case "migrating":
      return "Migrating CRC…";
    case "building":
      return "Preparing transfer…";
    case "signing":
      return "Confirm in wallet…";
    case "verifying":
      return "Verifying payment…";
    default:
      return "Working…";
  }
}
