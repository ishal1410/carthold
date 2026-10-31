import { Ban, CircleCheck, CircleDashed, CircleSlash, Hourglass, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";

export type Status = "allow" | "hold" | "block" | "captured" | "voided" | "unknown";

const spec: Record<Status, { label: string; icon: LucideIcon; className: string }> = {
  allow: { label: "Allowed", icon: ShieldCheck, className: "bg-paid-soft text-paid border-paid/30" },
  hold: { label: "Held", icon: Hourglass, className: "bg-hold-soft text-hold border-hold/40" },
  block: { label: "Blocked", icon: Ban, className: "bg-blocked-soft text-blocked border-blocked/35" },
  captured: { label: "Captured", icon: CircleCheck, className: "bg-paid text-paid-ink border-paid" },
  voided: { label: "Voided", icon: CircleSlash, className: "bg-neutral-soft text-ink-muted border-line-strong" },
  unknown: { label: "Pending", icon: CircleDashed, className: "border-dashed border-line-strong text-ink-muted" },
};

export interface StatusPillProps {
  status: Status;
  /** Override the default word. Keep it short. */
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

/** Decision status: icon plus word, never color alone. An open hold breathes. */
export function StatusPill({ status, label, size = "md", className }: StatusPillProps) {
  const { label: fallback, icon: Icon, className: tone } = spec[status];
  return (
    <span
      data-status={status}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-pill border font-medium whitespace-nowrap",
        size === "sm" ? "h-6 px-2 text-2xs" : "h-7 px-2.5 text-xs",
        tone,
        className,
      )}
    >
      {status === "hold" ? (
        <span aria-hidden className="relative inline-flex size-2">
          <span className="absolute inset-0 rounded-pill bg-hold/60 animate-hold-ring" />
          <span className="relative size-2 rounded-pill bg-hold" />
        </span>
      ) : (
        <Icon aria-hidden strokeWidth={1.75} className={size === "sm" ? "size-3" : "size-3.5"} />
      )}
      <span className={status === "voided" ? "line-through decoration-1" : undefined}>{label ?? fallback}</span>
    </span>
  );
}
