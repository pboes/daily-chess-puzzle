"use client";

import * as React from "react";
import { Modal } from "@/components/ui/modal";
import { Timer, Heart, RotateCcw, Trophy, Coins } from "lucide-react";

const SEEN_KEY = "dcp-howto-seen";

/** "How does this puzzle work" modal. Auto-opens once per browser, and can be
 *  reopened from the trigger rendered by `HowToPlayButton`. */
export function useHowToPlay() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) setOpen(true);
    } catch {
      /* ignore */
    }
  }, []);

  const close = React.useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  return { open, openModal: () => setOpen(true), close };
}

const Row = ({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) => (
  <li className="flex items-start gap-2.5">
    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--primary)]" />
    <span className="text-[var(--foreground)]">{children}</span>
  </li>
);

export function HowToPlayModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="How the daily puzzle works">
      <ul className="space-y-2.5">
        <Row icon={Coins}>
          Pay a small entry in Circles to join today&apos;s round — winner takes the pot.
        </Row>
        <Row icon={Timer}>
          The clock starts the moment you press <strong>Play</strong> and never
          stops — solve it as fast as you can.
        </Row>
        <Row icon={Heart}>
          You have <strong>3 lives</strong>. Find the best move for the side to play.
        </Row>
        <Row icon={RotateCcw}>
          A wrong move costs a life and resets the board to the start — but the
          clock keeps running.
        </Row>
        <Row icon={Trophy}>
          <strong>One attempt per day.</strong> The fastest solver at 00:00 UTC
          wins the pot; reloading won&apos;t reset your timer.
        </Row>
      </ul>
    </Modal>
  );
}
