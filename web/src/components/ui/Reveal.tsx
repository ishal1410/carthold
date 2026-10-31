"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

const tags = {
  div: motion.div,
  section: motion.section,
  article: motion.article,
  li: motion.li,
  header: motion.header,
} as const;

export interface RevealProps {
  as?: keyof typeof tags;
  /** "rise" for content, "stamp" for a verdict landing. */
  variant?: "rise" | "stamp";
  /** Seconds. */
  delay?: number;
  /** Pixels to rise from. */
  y?: number;
  /** Animate when scrolled into view (default) or right on mount. */
  inView?: boolean;
  className?: string;
  children: ReactNode;
}

const ease = [0.16, 1, 0.3, 1] as const;
const snap = [0.32, 0.72, 0, 1] as const;

/** Fade and rise once. Under reduced motion it renders in place, no movement. */
export function Reveal({
  as = "div",
  variant = "rise",
  delay = 0,
  y = 16,
  inView = true,
  className,
  children,
}: RevealProps) {
  const reduce = useReducedMotion();
  const Tag = tags[as];
  if (reduce) {
    return <Tag className={className}>{children}</Tag>;
  }
  // "stamp" is the verdict reveal: lands like a rubber stamp instead of rising.
  const hidden = variant === "stamp" ? { opacity: 0, scale: 1.06 } : { opacity: 0, y, filter: "blur(4px)" };
  const shown = variant === "stamp" ? { opacity: 1, scale: 1 } : { opacity: 1, y: 0, filter: "blur(0px)" };
  return (
    <Tag
      className={className}
      initial={hidden}
      {...(inView ? { whileInView: shown, viewport: { once: true, margin: "0px 0px -10% 0px" } } : { animate: shown })}
      transition={{ duration: variant === "stamp" ? 0.48 : 0.56, delay, ease: variant === "stamp" ? snap : ease }}
    >
      {children}
    </Tag>
  );
}
