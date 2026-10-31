import type { ElementType, ReactNode } from "react";
import { cx } from "./cx";

export type PanelTone = "default" | "hold" | "paid" | "blocked";

const glow: Record<PanelTone, string> = {
  default: "",
  hold: "glow-hold",
  paid: "glow-paid",
  blocked: "glow-blocked",
};

const shellTone: Record<PanelTone, string> = {
  default: "",
  hold: "edge-hold",
  paid: "border-paid/25",
  blocked: "border-blocked/30",
};

export interface PanelProps {
  as?: ElementType;
  tone?: PanelTone;
  /** Inner padding. Turn off for tables that run edge to edge. */
  padded?: boolean;
  className?: string;
  coreClassName?: string;
  children: ReactNode;
  id?: string;
  "aria-labelledby"?: string;
  "aria-label"?: string;
}

/** Double-bezel container: hairline shell around a raised core. Never nest Panels. */
export function Panel({
  as: Tag = "section",
  tone = "default",
  padded = true,
  className,
  coreClassName,
  children,
  ...rest
}: PanelProps) {
  return (
    <Tag className={cx("bezel", shellTone[tone], className)} {...rest}>
      <div className={cx("bezel-core h-full", glow[tone], padded && "p-5 md:p-6", coreClassName)}>{children}</div>
    </Tag>
  );
}

export interface PanelHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  id?: string;
  className?: string;
}

export function PanelHeader({ title, description, action, id, className }: PanelHeaderProps) {
  return (
    <header className={cx("mb-4 flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h3 id={id} className="font-display text-xl font-semibold tracking-tight text-ink">
          {title}
        </h3>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
