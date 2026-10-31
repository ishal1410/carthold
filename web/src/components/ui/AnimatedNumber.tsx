"use client";

import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";
import { cx } from "./cx";

export interface AnimatedNumberProps {
  value: number;
  format?: "currency" | "integer";
  currency?: string;
  /** Start value on first mount. Defaults to 0 so the amount ticks up. */
  from?: number;
  className?: string;
}

/** Money ticker. Springs between values; screen readers get the final value only. */
export function AnimatedNumber({ value, format = "currency", currency = "USD", from = 0, className }: AnimatedNumberProps) {
  const reduce = useReducedMotion();
  const spring = useSpring(reduce ? value : from, { stiffness: 140, damping: 24, restDelta: 0.005 });
  const formatter = new Intl.NumberFormat("en-US",
    format === "currency" ? { style: "currency", currency } : { maximumFractionDigits: 0 },
  );
  const text = useTransform(spring, (v) => formatter.format(format === "integer" ? Math.round(v) : v));

  useEffect(() => {
    if (reduce) spring.jump(value);
    else spring.set(value);
  }, [value, reduce, spring]);

  return (
    <span className={cx("figures", className)}>
      <motion.span aria-hidden>{text}</motion.span>
      <span className="sr-only">{formatter.format(value)}</span>
    </span>
  );
}
