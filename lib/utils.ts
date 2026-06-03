import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortenAddress(address?: string | null, chars = 4): string {
  if (!address) return "";
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

/** Format milliseconds as M:SS.mmm for the puzzle timer / leaderboard. */
export function formatTime(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor(ms % 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${millis
    .toString()
    .padStart(3, "0")}`;
}

/** UTC day key, e.g. "2026-06-02". The competition day is a UTC calendar day. */
export function todayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Whole CRC → demurraged atto-CRC (1e18), the unit transferGroupCrc expects. */
export function crcToAtto(crc: number): bigint {
  // 6 decimals of precision is plenty for a fee / seed amount.
  return BigInt(Math.round(crc * 1e6)) * 10n ** 12n;
}

/** Demurraged atto-CRC → whole CRC (number), for display. */
export function attoToCrc(atto: bigint): number {
  return Number(atto / 10n ** 12n) / 1e6;
}
