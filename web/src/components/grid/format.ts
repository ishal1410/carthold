import type { Verdict } from "../../lib/policy/policy";

/** ISO -> local HH:MM:SS. */
export const formatTime = (iso: string) => new Date(iso).toTimeString().slice(0, 8);

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const formatUsd = (n: number) => usd.format(n);

/** Remaining ms -> M:SS ("expired" at or below 0). */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "expired";
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const VERDICT_CLASS: Record<Verdict, string> = {
  allow: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  hold: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  block: "bg-red-500/15 text-red-300 ring-red-500/30",
};

/** Copy sorted newest-first by ISO time (input untouched, so AG Grid sees immutable data). */
export const newestFirst = <T extends { time: string }>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));

export const correctMark = (ok: boolean) => (ok ? "✓" : "✗");

/** Human labels for guard row statuses. Unknown future statuses fall through to the raw string. */
const STATUS_LABEL: Record<string, string> = {
  pending: "Authorizing",
  blocked: "Blocked",
  held: "Held",
  captured: "Paid",
  voided: "Voided",
  error: "PayPal error",
  unknown: "Unclear",
};
export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;

/** Status chip + free-text search shared by the decision grid and its phone card list. */
export function filterDecisions<T extends { status: string; merchant: string; items: string; reasons: string[] }>(
  rows: readonly T[],
  status: string,
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (status === "all" || r.status === status) &&
      (!q || [r.merchant, r.items, statusLabel(r.status), ...r.reasons].some((v) => v.toLowerCase().includes(q))),
  );
}

/** Scorecard "All" order: attacks, then benign, each by id. Copy; input untouched. */
export const attacksFirst = <T extends { id: string; label: string }>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => (a.label === b.label ? a.id.localeCompare(b.id) : a.label === "attack" ? -1 : 1));
