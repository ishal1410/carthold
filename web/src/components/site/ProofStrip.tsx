"use client";

import { useInView } from "motion/react";
import { type ReactNode, useRef, useSyncExternalStore } from "react";
import { AnimatedNumber, cx } from "@/components/ui";

export interface ProofFigure {
  value: number;
  /** Whole dollars get a "$" prefix; counts get none. */
  format: "usd" | "count";
  /** Shown after the number, e.g. "of 20". */
  suffix?: string;
  label: string;
  note: ReactNode;
  tone: "paid" | "hold" | "blocked" | "ink";
}

const noop = () => () => {};
const toneText = { paid: "text-paid", hold: "text-hold", blocked: "text-blocked", ink: "text-ink" } as const;

/** A ledger row of real figures. Server HTML carries the final numbers (crawlers, no-JS);
 *  after hydration they reset to 0 and tick up once, when the row scrolls into view. */
export function ProofStrip({ figures, caption }: { figures: ProofFigure[]; caption: string }) {
  const ref = useRef<HTMLDListElement>(null);
  const seen = useInView(ref, { once: true, margin: "0px 0px -15% 0px" });
  // false while server-rendering and hydrating, true after: no effect, no hydration mismatch.
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  return (
    <div>
      <p className="text-sm text-ink-muted">{caption}</p>
      <dl ref={ref} className="mt-5 grid grid-cols-2 border-y border-line lg:grid-cols-4">
        {figures.map((f, i) => (
          <div
            key={f.label}
            className={cx(
              "flex flex-col gap-2 py-6 pr-4",
              i % 2 === 1 && "border-l border-line pl-4 lg:pl-6",
              i >= 2 && "border-t border-line lg:border-t-0",
              i === 2 && "lg:border-l lg:pl-6",
            )}
          >
            <dt className="order-2 text-sm font-medium text-ink">{f.label}</dt>
            <dd className={cx("order-1 text-3xl font-medium tracking-tight md:text-[2.5rem]", toneText[f.tone])}>
              {f.format === "usd" && <span className="figures opacity-60">$</span>}
              {seen ? (
                <AnimatedNumber value={f.value} format="integer" />
              ) : (
                <span className="figures">{hydrated ? 0 : f.value}</span>
              )}
              {f.suffix && <span className="ml-1.5 text-lg font-medium text-ink-muted">{f.suffix}</span>}
            </dd>
            <dd className="order-3 text-xs text-pretty text-ink-faint">{f.note}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
