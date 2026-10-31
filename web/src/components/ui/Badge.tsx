import type { ReactNode } from "react";
import { cx } from "./cx";

export type Tone = "neutral" | "hold" | "paid" | "blocked" | "warning" | "info";

export const toneClasses: Record<Tone, string> = {
  neutral: "bg-neutral-soft text-ink-muted border-line-strong",
  hold: "bg-hold-soft text-hold border-hold/30",
  paid: "bg-paid-soft text-paid border-paid/30",
  blocked: "bg-blocked-soft text-blocked border-blocked/30",
  warning: "bg-warning-soft text-warning border-warning/30",
  info: "bg-info-soft text-info border-info/30",
};

export interface BadgeProps {
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Static metadata chip: store name, "Simulated", "Live". */
export function Badge({ tone = "neutral", icon, className, children }: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-2xs font-medium tracking-wide",
        toneClasses[tone],
        className,
      )}
    >
      {icon && (
        <span aria-hidden className="[&>svg]:size-3">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
