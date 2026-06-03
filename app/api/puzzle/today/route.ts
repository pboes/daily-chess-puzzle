import { NextResponse } from "next/server";
import { Chess } from "chess.js";
import type { DailyPuzzle } from "@/lib/puzzle";
import { getStore } from "@/lib/server/store";
import { todayKey } from "@/lib/utils";

// Always run fresh so the puzzle (and its `day`) tracks the current UTC day —
// caching the whole response served yesterday's puzzle across the day boundary.
export const dynamic = "force-dynamic";

interface LichessPuzzle {
  game: { pgn: string };
  puzzle: {
    id: string;
    rating: number;
    solution: string[];
    themes: string[];
    fen?: string;
    initialPly: number;
  };
}

/**
 * Derive the puzzle position FEN by replaying the PGN. The solver-to-move
 * position is reached after `initialPly + 1` plies — the last replayed move is
 * the opponent's setup move (Lichess's `lastMove`), after which the solver
 * plays `solution[0]`. (Replaying only `initialPly` lands one move short, which
 * makes the whole solution line illegal.)
 */
function fenFromPgn(pgn: string, initialPly: number): string {
  const chess = new Chess();
  // Lichess PGNs here are space-separated SAN moves without move numbers.
  const moves = pgn.trim().split(/\s+/);
  const upto = Math.min(initialPly + 1, moves.length);
  for (let i = 0; i < upto; i++) {
    try {
      chess.move(moves[i]);
    } catch {
      break;
    }
  }
  return chess.fen();
}

export async function GET() {
  const day = todayKey();
  const store = getStore();
  const noStore = { headers: { "Cache-Control": "no-store, max-age=0" } };

  try {
    // Once a day's puzzle is locked in, everyone gets the same one all day.
    const existing = await store.getPuzzle(day);
    if (existing) return NextResponse.json(existing, noStore);

    // Use a fresh puzzle (the Lichess "daily" is static for long stretches and
    // wouldn't change each UTC day). We lock whatever we draw for the whole day.
    const res = await fetch("https://lichess.org/api/puzzle/next", {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Lichess responded ${res.status}`);
    const data = (await res.json()) as LichessPuzzle;

    const fen = data.puzzle.fen ?? fenFromPgn(data.game.pgn, data.puzzle.initialPly);
    const solverColor = (fen.split(" ")[1] as "w" | "b") ?? "w";

    const puzzle: DailyPuzzle = {
      id: data.puzzle.id,
      day,
      fen,
      solverColor,
      solution: data.puzzle.solution,
      rating: data.puzzle.rating,
      themes: data.puzzle.themes,
    };

    await store.setPuzzle(day, puzzle);
    // Return whatever got locked in (handles a concurrent first write).
    const locked = (await store.getPuzzle(day)) ?? puzzle;
    return NextResponse.json(locked, noStore);
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to load the daily puzzle", detail: String(err) },
      { status: 502 }
    );
  }
}
