import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "success" | "muted" | "danger";

const styles: Record<Variant, string> = {
  default: "bg-[var(--primary)]/15 text-[var(--primary)] border-[var(--primary)]/30",
  success: "bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/30",
  muted: "bg-[var(--muted)] text-[var(--muted-foreground)] border-[var(--border)]",
  danger: "bg-[var(--destructive)]/15 text-[var(--destructive)] border-[var(--destructive)]/30",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        styles[variant],
        className
      )}
      {...props}
    />
  );
}
