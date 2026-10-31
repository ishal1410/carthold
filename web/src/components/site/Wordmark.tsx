import { cx } from "@/components/ui";

/** CartHold mark: a held coin (amber ring) with a pause bar through it. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 24 24" aria-hidden className="size-6 shrink-0">
        <circle cx="12" cy="12" r="10" className="fill-hold-soft stroke-hold" strokeWidth="1.5" />
        <rect x="8.5" y="7.5" width="2.2" height="9" rx="1.1" className="fill-hold" />
        <rect x="13.3" y="7.5" width="2.2" height="9" rx="1.1" className="fill-hold" />
      </svg>
      <span className="font-display text-[17px] font-semibold tracking-tight text-ink">CartHold</span>
    </span>
  );
}
