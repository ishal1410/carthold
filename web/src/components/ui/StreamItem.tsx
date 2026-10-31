"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import type { Tone } from "./Badge";
import { cx } from "./cx";

const dot: Record<Tone, string> = {
  neutral: "bg-neutral",
  hold: "bg-hold",
  paid: "bg-paid",
  blocked: "bg-blocked",
  warning: "bg-warning",
  info: "bg-info",
};

const titleTone: Record<Tone, string> = {
  neutral: "text-ink",
  hold: "text-hold",
  paid: "text-paid",
  blocked: "text-blocked",
  warning: "text-warning",
  info: "text-ink",
};

export interface StreamItemProps {
  tone?: Tone;
  /** Timestamp or step label, shown in mono. */
  time?: ReactNode;
  title: ReactNode;
  /** Position in the list; drives the 50ms stagger (capped). */
  index?: number;
  className?: string;
  children?: ReactNode;
}

/** One trace line. Render inside an <ol> or <ul>; it writes itself in like a log. */
export function StreamItem({ tone = "neutral", time, title, index = 0, className, children }: StreamItemProps) {
  const reduce = useReducedMotion();
  return (
    <motion.li
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: Math.min(index, 12) * 0.05, ease: [0.16, 1, 0.3, 1] }}
      className={cx("relative grid grid-cols-[auto_1fr] gap-x-3 py-2.5", className)}
    >
      <span aria-hidden className="relative mt-1.5 flex size-2 justify-center">
        <span className={cx("size-2 rounded-pill", dot[tone])} />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className={cx("text-sm font-medium", titleTone[tone])}>{title}</span>
          {time && <span className="figures text-2xs text-ink-faint">{time}</span>}
        </div>
        {children && <div className="mt-1 text-sm text-ink-muted break-words">{children}</div>}
      </div>
    </motion.li>
  );
}
