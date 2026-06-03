/** Shape of a daily puzzle the client renders. Derived from the Lichess API. */
export interface DailyPuzzle {
  /** Lichess puzzle id (stable per day). */
  id: string;
  /** UTC day this puzzle belongs to, e.g. "2026-06-02". */
  day: string;
  /** FEN of the starting position; the side to move is the solver. */
  fen: string;
  /** Solver = "w" | "b" (side to move in the FEN). */
  solverColor: "w" | "b";
  /** Solution moves in UCI (e.g. "g5g1"); solver plays even indices. */
  solution: string[];
  /** Puzzle rating (difficulty). */
  rating: number;
  /** Lichess themes (e.g. "fork", "mateIn2"). */
  themes: string[];
  /** The opponent's last move (UCI) that led to this position, for highlight. */
  lastMove?: string;
}

export const STARTING_LIVES = 3;
