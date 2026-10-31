import type { ReactNode } from "react";
import { cx } from "./cx";

export interface SectionHeaderProps {
  /** Ledger step number, e.g. "01". Shown in mono beside the title. */
  index?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  as?: "h1" | "h2" | "h3";
  id?: string;
  className?: string;
}

export function SectionHeader({ index, title, description, action, as: H = "h2", id, className }: SectionHeaderProps) {
  const size = H === "h1" ? "text-3xl md:text-4xl" : H === "h2" ? "text-2xl md:text-3xl" : "text-xl md:text-2xl";
  return (
    <div className={cx("flex flex-col gap-4 md:flex-row md:items-end md:justify-between", className)}>
      <div className="flex max-w-2xl gap-4">
        {index && (
          <span aria-hidden className="figures pt-1.5 text-sm text-hold">
            {index}
          </span>
        )}
        <div>
          <H id={id} className={cx("font-display font-semibold tracking-tight text-balance text-ink", size)}>
            {title}
          </H>
          {description && <p className="mt-3 text-base text-pretty text-ink-muted md:text-lg">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
