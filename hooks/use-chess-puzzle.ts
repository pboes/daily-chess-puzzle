"use client";

import * as React from "react";
import { Chess } from "chess.js";
import { type DailyPuzzle, STARTING_LIVES } from "@/lib/puzzle";

export type PuzzleStatus = "ready" | "playing" | "solved" | "failed";

interface UseChessPuzzleResult {
  fen: string;
  status: PuzzleStatus;
  lives: number;
  /** Solver moves completed so far (out of the solver's share of the solution). */
  progress: number;
  totalSolverMoves: number;
  /** Elapsed milliseconds; live while playing. */
  elapsedMs: number;
  /** Set when the last attempt was wrong, to trigger a shake/flash. */
  lastWasWrong: boolean;
  /** Square highlights for the most recent move {from,to}. */
  lastMove: { from: string; to: string } | null;
  /** true while the opponent's auto-reply animates (board is locked). */
  isOpponentMoving: boolean;
  boardOrientation: "white" | "black";
  /** Begin (or resume) the attempt. Pass the server's `startedAt` epoch so the
   *  timer is anchored to the server clock and survives reloads. */
  start: (startedAtEpoch?: number) => void;
  /** Attempt a solver move. Returns true if accepted (correct). */
  attemptMove: (from: string, to: string, promotion?: string) => boolean;
}

const UCI = (m: { from: string; to: string; promotion?: string }) =>
  `${m.from}${m.to}${m.promotion ?? ""}`;

export function useChessPuzzle(puzzle: DailyPuzzle | null): UseChessPuzzleResult {
  const gameRef = React.useRef(new Chess());
  const [fen, setFen] = React.useState(puzzle?.fen ?? "");
  const [status, setStatus] = React.useState<PuzzleStatus>("ready");
  const [lives, setLives] = React.useState(STARTING_LIVES);
  const [progress, setProgress] = React.useState(0);
  const [elapsedMs, setElapsedMs] = React.useState(0);
  const [lastWasWrong, setLastWasWrong] = React.useState(false);
  const [lastMove, setLastMove] = React.useState<{ from: string; to: string } | null>(null);
  const [isOpponentMoving, setIsOpponentMoving] = React.useState(false);

  const startTimeRef = React.useRef<number | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const solveIndexRef = React.useRef(0); // index into puzzle.solution
  // Lives tracked in a ref too, so rapid wrong moves decrement correctly even
  // before React re-renders (a stale `lives` closure could otherwise miss the
  // 3rd loss and never trigger "failed").
  const livesRef = React.useRef(STARTING_LIVES);

  // Solver plays even indices of the solution; opponent the odd ones.
  const totalSolverMoves = puzzle
    ? Math.ceil(puzzle.solution.length / 2)
    : 0;

  const resetBoard = React.useCallback(() => {
    if (!puzzle) return;
    gameRef.current.load(puzzle.fen);
    solveIndexRef.current = 0;
    setFen(puzzle.fen);
    setProgress(0);
    if (puzzle.lastMove) {
      setLastMove({
        from: puzzle.lastMove.slice(0, 2),
        to: puzzle.lastMove.slice(2, 4),
      });
    } else {
      setLastMove(null);
    }
  }, [puzzle]);

  // Load the position whenever the puzzle changes.
  React.useEffect(() => {
    if (!puzzle) return;
    resetBoard();
    setStatus("ready");
    livesRef.current = STARTING_LIVES;
    setLives(STARTING_LIVES);
    setElapsedMs(0);
    startTimeRef.current = null;
  }, [puzzle, resetBoard]);

  // Timer loop (requestAnimationFrame for smooth ms display).
  React.useEffect(() => {
    if (status !== "playing") return;
    const tick = () => {
      if (startTimeRef.current != null) {
        // Anchored to the server's startedAt (Date.now epoch) so a reload
        // resumes the same running clock rather than restarting.
        setElapsedMs(Math.max(0, Date.now() - startTimeRef.current));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [status]);

  const start = React.useCallback(
    (startedAtEpoch?: number) => {
      if (!puzzle || status === "playing") return;
      resetBoard();
      livesRef.current = STARTING_LIVES;
      setLives(STARTING_LIVES);
      const t = startedAtEpoch ?? Date.now();
      startTimeRef.current = t;
      setElapsedMs(Math.max(0, Date.now() - t));
      setStatus("playing");
    },
    [puzzle, status, resetBoard]
  );

  const attemptMove = React.useCallback(
    (from: string, to: string, promotion = "q"): boolean => {
      if (!puzzle || status !== "playing" || isOpponentMoving) return false;

      const expected = puzzle.solution[solveIndexRef.current];
      const game = gameRef.current;

      // Validate legality without mutating on failure.
      let played;
      try {
        played = game.move({ from, to, promotion });
      } catch {
        played = null;
      }
      if (!played) return false;

      const playedUci = UCI({ from, to, promotion });
      const isMate = game.isCheckmate();

      // Accept exact UCI match, or — for the final move — any mating move
      // (Lichess marks puzzles solved on mate regardless of exact line).
      const correct =
        playedUci === expected ||
        playedUci.slice(0, 4) === expected.slice(0, 4) ||
        (isMate && solveIndexRef.current === puzzle.solution.length - 1);

      if (!correct) {
        game.undo();
        livesRef.current -= 1;
        const remaining = livesRef.current;
        setLives(Math.max(0, remaining));
        setLastWasWrong(true);
        setTimeout(() => setLastWasWrong(false), 500);
        if (remaining <= 0) {
          setStatus("failed");
        } else {
          // Reset the board to the start; the timer keeps running.
          resetBoard();
        }
        return false;
      }

      // Correct solver move.
      solveIndexRef.current += 1;
      setProgress((p) => p + 1);
      setFen(game.fen());
      setLastMove({ from, to });

      // Solved?
      if (solveIndexRef.current >= puzzle.solution.length) {
        setStatus("solved");
        return true;
      }

      // Auto-play the opponent's reply after a short beat.
      setIsOpponentMoving(true);
      const replyUci = puzzle.solution[solveIndexRef.current];
      setTimeout(() => {
        const reply = game.move({
          from: replyUci.slice(0, 2),
          to: replyUci.slice(2, 4),
          promotion: replyUci.slice(4) || undefined,
        });
        solveIndexRef.current += 1;
        if (reply) {
          setFen(game.fen());
          setLastMove({ from: reply.from, to: reply.to });
        }
        setIsOpponentMoving(false);
        if (solveIndexRef.current >= puzzle.solution.length) {
          setStatus("solved");
        }
      }, 350);

      return true;
    },
    [puzzle, status, isOpponentMoving, resetBoard]
  );

  return {
    fen,
    status,
    lives,
    progress,
    totalSolverMoves,
    elapsedMs,
    lastWasWrong,
    lastMove,
    isOpponentMoving,
    boardOrientation: puzzle?.solverColor === "b" ? "black" : "white",
    start,
    attemptMove,
  };
}
