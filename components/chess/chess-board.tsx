"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Chess } from "chess.js";

// react-chessboard relies on @dnd-kit (browser-only) — load it client-side.
const Chessboard = dynamic(
  () => import("react-chessboard").then((m) => m.Chessboard),
  { ssr: false }
);

interface ChessBoardProps {
  fen: string;
  orientation: "white" | "black";
  lastMove: { from: string; to: string } | null;
  /** Return true if the move is accepted (correct & legal). */
  onMove: (from: string, to: string) => boolean;
  /** Disable interaction (between moves / when not playing). */
  disabled?: boolean;
  wrong?: boolean;
}

export function ChessBoard({
  fen,
  orientation,
  lastMove,
  onMove,
  disabled,
  wrong,
}: ChessBoardProps) {
  // Click-to-move: first click selects a piece, second click moves it.
  const [selected, setSelected] = React.useState<string | null>(null);

  // Drop the selection whenever the position changes (a move played, the board
  // reset) or interaction is disabled.
  React.useEffect(() => {
    setSelected(null);
  }, [fen, disabled]);

  // Legal destinations from the selected square, for highlighting.
  const legalTargets = React.useMemo(() => {
    if (!selected) return new Set<string>();
    try {
      return new Set(
        new Chess(fen).moves({ square: selected as never, verbose: true }).map((m) => m.to)
      );
    } catch {
      return new Set<string>();
    }
  }, [selected, fen]);

  const squareStyles = React.useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (lastMove) {
      const tint = { background: "rgba(67, 53, 223, 0.22)" };
      styles[lastMove.from] = { ...tint };
      styles[lastMove.to] = { ...tint };
    }
    if (selected) {
      for (const t of legalTargets) {
        styles[t] = { background: "rgba(67, 53, 223, 0.18)" };
      }
      styles[selected] = { background: "rgba(67, 53, 223, 0.45)" };
    }
    return styles;
  }, [lastMove, selected, legalTargets]);

  const clickSquare = React.useCallback(
    (square: string, hasPiece: boolean) => {
      if (disabled) return;
      if (!selected) {
        if (hasPiece) setSelected(square);
        return;
      }
      if (square === selected) {
        setSelected(null);
        return;
      }
      const moved = onMove(selected, square);
      // On a successful move the position changes and the effect clears the
      // selection. Otherwise, treat clicking another piece as re-selecting it.
      setSelected(moved ? null : hasPiece ? square : null);
    },
    [disabled, selected, onMove]
  );

  return (
    <div
      className={`aspect-square w-full overflow-hidden rounded-xl ring-1 ring-[var(--border)] ${
        wrong ? "animate-shake ring-2 ring-[var(--destructive)]" : ""
      }`}
    >
      <Chessboard
        options={{
          id: "daily-puzzle",
          position: fen,
          boardOrientation: orientation,
          allowDragging: !disabled,
          animationDurationInMs: 200,
          darkSquareStyle: { backgroundColor: "#aeb7d0" },
          lightSquareStyle: { backgroundColor: "#eef1f7" },
          squareStyles,
          onPieceDrop: ({ sourceSquare, targetSquare }) => {
            setSelected(null);
            if (disabled || !targetSquare) return false;
            return onMove(sourceSquare, targetSquare);
          },
          onSquareClick: ({ piece, square }) => clickSquare(square, Boolean(piece)),
        }}
      />
    </div>
  );
}
