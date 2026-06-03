"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./card";

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <Card
        className="w-full max-w-sm shadow-popup"
        onClick={(e) => e.stopPropagation()}
      >
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--secondary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-[var(--muted-foreground)]">
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
