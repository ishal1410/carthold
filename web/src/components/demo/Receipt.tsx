"use client";
import { Check, Copy, CreditCard } from "lucide-react";
import { useState } from "react";
import type { DecisionRow } from "@/lib/guard/guard";
import { cx } from "@/components/ui";

type Ids = Pick<DecisionRow, "paypalOrderId" | "authorizationId" | "captureId">;

const idsOf = (r: Ids): [string, string][] =>
  (
    [
      ["Order", r.paypalOrderId],
      ["Authorization", r.authorizationId],
      ["Capture", r.captureId],
    ] as [string, string | undefined][]
  ).filter((e): e is [string, string] => !!e[1]);

export const hasReceipt = (r: Ids) => idsOf(r).length > 0;

/** Middle-truncated id: 7KL55…8812C. Full value stays in the title and the copy. */
const short = (id: string) => (id.length > 12 ? `${id.slice(0, 5)}…${id.slice(-5)}` : id);

export function CopyId({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  return (
    <button
      type="button"
      data-copy
      onClick={copy}
      title={`Copy PayPal ${label.toLowerCase()} id ${value}`}
      aria-label={`Copy PayPal ${label.toLowerCase()} id ${value}`}
      className={cx(
        "group/copy inline-flex max-w-full items-center gap-1.5 rounded-xs text-ink-muted transition-colors duration-[var(--duration-fast)] ease-snap hover:text-ink",
        compact ? "h-6 border border-line bg-surface-2 px-1.5 text-2xs" : "h-7 px-1.5 text-xs hover:bg-surface-3",
      )}
    >
      {compact && <span className="text-ink-faint">{label === "Authorization" ? "Auth" : label}</span>}
      <span className="figures truncate">{compact ? `…${value.slice(-6)}` : short(value)}</span>
      {copied ? (
        <Check aria-hidden strokeWidth={1.75} className="size-3 shrink-0 text-paid" />
      ) : (
        <Copy aria-hidden strokeWidth={1.5} className="size-3 shrink-0 opacity-50 group-hover/copy:opacity-100" />
      )}
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}

/** The PayPal side of one decision, shown once per row: order, authorization, capture. */
export function Receipt({ row, className }: { row: Ids; className?: string }) {
  const ids = idsOf(row);
  if (!ids.length) return null;
  return (
    <div className={cx("rounded-md border border-line bg-surface-2 px-3 py-2", className)}>
      <p className="flex items-center justify-between gap-2 text-2xs text-ink-faint">
        <span className="inline-flex items-center gap-1.5">
          <CreditCard aria-hidden strokeWidth={1.5} className="size-3.5" />
          PayPal receipt
        </span>
        <span className="rounded-xs border border-line px-1.5">Sandbox</span>
      </p>
      <dl className="mt-1 divide-y divide-line">
        {ids.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 py-0.5">
            <dt className="text-xs text-ink-muted">{k}</dt>
            <dd className="min-w-0">
              <CopyId label={k} value={v} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** One-line receipt for tables: tiny copy chips. */
export function ReceiptInline({ row }: { row: Ids }) {
  const ids = idsOf(row);
  if (!ids.length) return <span className="text-ink-faint">None</span>;
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1">
      {ids.map(([k, v]) => (
        <CopyId key={k} label={k} value={v} compact />
      ))}
    </span>
  );
}
