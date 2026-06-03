import { NextResponse } from "next/server";
import { Chess } from "chess.js";
import type { DailyPuzzle } from "@/lib/puzzle";
import { todayKey } from "@/lib/utils";

// Re-fetch at most once an hour; the Lichess daily puzzle changes once per day.
export const revalidate = 3600;

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

/** Derive the position FEN by replaying the PGN to `initialPly`. */
function fenFromPgn(pgn: string, initialPly: number): string {
  const chess = new Chess();
  // Lichess PGNs here are space-separated SAN moves without numbers.
  const moves = pgn.trim().split(/\s+/);
  for (let i = 0; i < Math.min(initialPly, moves.length); i++) {
    try {
      chess.move(moves[i]);
    } catch {
      break;
    }
  }
  return chess.fen();
}

export async function GET() {
  try {
    const res = await fetch("https://lichess.org/api/puzzle/daily", {
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`Lichess responded ${res.status}`);
    const data = (await res.json()) as LichessPuzzle;

    const fen = data.puzzle.fen ?? fenFromPgn(data.game.pgn, data.puzzle.initialPly);
    const solverColor = (fen.split(" ")[1] as "w" | "b") ?? "w";

    const puzzle: DailyPuzzle = {
      id: data.puzzle.id,
      day: todayKey(),
      fen,
      solverColor,
      solution: data.puzzle.solution,
      rating: data.puzzle.rating,
      themes: data.puzzle.themes,
    };

    return NextResponse.json(puzzle);
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to load the daily puzzle", detail: String(err) },
      { status: 502 }
    );
  }
}
