"use client";

import * as React from "react";
import { Heart, Timer, Trophy } from "lucide-react";
import { formatTime } from "@/lib/utils";
import { STARTING_LIVES } from "@/lib/puzzle";

export function PuzzleHud({
  elapsedMs,
  lives,
  progress,
  total,
}: {
  elapsedMs: number;
  lives: number;
  progress: number;
  total: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/50 px-4 py-3">
      <div className="flex items-center gap-2 font-mono text-2xl font-semibold tabular-nums">
        <Timer className="h-5 w-5 text-[var(--primary)]" />
        {formatTime(elapsedMs)}
      </div>

      <div className="flex items-center gap-1.5">
        {Array.from({ length: STARTING_LIVES }).map((_, i) => (
          <Heart
            key={i}
            className={`h-5 w-5 transition-all ${
              i < lives
                ? "fill-[var(--destructive)] text-[var(--destructive)]"
                : "text-[var(--muted-foreground)]/40"
            }`}
          />
        ))}
      </div>

      <div className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)]">
        <Trophy className="h-4 w-4 text-[var(--accent)]" />
        <span className="tabular-nums">
          {progress}/{total}
        </span>
      </div>
    </div>
  );
}
