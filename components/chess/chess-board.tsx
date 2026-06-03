"use client";

import * as React from "react";
import dynamic from "next/dynamic";

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
  const squareStyles = React.useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (lastMove) {
      const tint = { background: "rgba(67, 53, 223, 0.30)" };
      styles[lastMove.from] = tint;
      styles[lastMove.to] = tint;
    }
    return styles;
  }, [lastMove]);

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
            if (disabled || !targetSquare) return false;
            return onMove(sourceSquare, targetSquare);
          },
        }}
      />
    </div>
  );
}
