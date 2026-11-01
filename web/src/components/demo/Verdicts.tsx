"use client";
import { Check, ChevronDown, ScanEye, TriangleAlert, Wallet, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { DecisionRow, GuardState } from "@/lib/guard/guard";
import { AnimatedNumber, Badge, Button, Panel, Reveal, StatusPill, cx, type Status } from "@/components/ui";
import { RECORDED_RUN_HREF } from "@/components/site";
import { Receipt } from "./Receipt";
import { hasInjection, headline, isInspectorBlock, isWarning, orderReasons, plainReason, reasonTags, stripWarning } from "./reasons";

export const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
/** Money PayPal actually took: captured rows only (pending and held are committed, not paid). */
export const paidUsd = (rows: { status: string; amountUsd: number }[]) =>
  rows.filter((r) => r.status === "captured").reduce((s, r) => s + r.amountUsd, 0);
const HOLD_MS = 5 * 60_000;

function useNow(active: boolean) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    const first = setTimeout(() => setNow(Date.now()), 0);
    return () => {
      clearInterval(id);
      clearTimeout(first);
    };
  }, [active]);
  return now;
}

/** One reason, labelled by who raised it. Used in disclosures and the reveal dialog. */
export function ReasonLine({ r }: { r: string }) {
  const who = isWarning(r) ? "Warning, did not block" : /^gemini inspector\b/i.test(r) ? "Gemini inspector" : /^inspector\b/i.test(r) ? "Inspector" : "Policy";
  return (
    <li className="flex gap-2.5 [overflow-wrap:anywhere]">
      <span
        aria-hidden
        className={cx("mt-2 size-1.5 shrink-0 rounded-pill", isWarning(r) ? "bg-warning" : isInspectorBlock(r) ? "bg-blocked" : "bg-neutral")}
      />
      <span>
        <span className={cx("font-medium", isWarning(r) ? "text-warning" : isInspectorBlock(r) ? "text-blocked" : "text-ink-muted")}>{who}: </span>
        <span className="text-ink-muted">{stripWarning(r).replace(/^(gemini )?inspector:?\s*/i, "")}</span>
      </span>
    </li>
  );
}

export function Tags({ tags, tone = "blocked" }: { tags: string[]; tone?: "blocked" | "hold" }) {
  if (!tags.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="What broke the rules">
      {tags.map((t) => (
        <li
          key={t}
          className={cx(
            "rounded-xs border px-1.5 py-0.5 text-2xs font-medium tabular-nums",
            tone === "hold" ? "border-hold/30 bg-hold-soft text-hold" : "border-blocked/30 bg-blocked-soft text-blocked",
          )}
        >
          {t}
        </li>
      ))}
    </ul>
  );
}

function Warnings({ reasons }: { reasons: string[] }) {
  const w = reasons.filter(isWarning);
  if (!w.length) return null;
  return (
    <ul className="space-y-1">
      {w.map((r) => (
        <li key={r} className="flex items-start gap-2 text-xs text-warning">
          <TriangleAlert aria-hidden strokeWidth={1.5} className="mt-0.5 size-3.5 shrink-0" />
          <span>{cap(stripWarning(r))}. It did not change this order.</span>
        </li>
      ))}
    </ul>
  );
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Radial countdown to the hold's auto-void. The ring empties; the last 30s turn coral. */
function CountdownRing({ left, verb = "auto-void" }: { left: number; verb?: string }) {
  const reduce = useReducedMotion();
  const mm = Math.floor(left / 60_000);
  const ss = String(Math.floor((left % 60_000) / 1000)).padStart(2, "0");
  const urgent = left < 30_000;
  return (
    <div className="relative size-24 shrink-0 sm:size-28 md:size-32" role="img" aria-label={left > 0 ? `${verb === "expire" ? "Expires" : "Auto-voids"} in ${mm} minutes ${ss} seconds` : "Expired"}>
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
        <circle cx="60" cy="60" r="52" fill="none" stroke="var(--line-strong)" strokeWidth="3" />
        <motion.circle
          cx="60"
          cy="60"
          r="52"
          fill="none"
          stroke={urgent ? "var(--blocked)" : "var(--hold)"}
          strokeWidth="4"
          strokeLinecap="round"
          initial={false}
          animate={{ pathLength: Math.max(0.001, left / HOLD_MS) }}
          transition={reduce ? { duration: 0 } : { duration: 1, ease: "linear" }}
        />
      </svg>
      <div aria-hidden className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cx("figures text-xl font-medium", urgent ? "text-blocked" : "text-ink")}>{left > 0 ? `${mm}:${ss}` : "0:00"}</span>
        <span className="text-2xs text-ink-faint">{left > 0 ? `to ${verb}` : verb === "expire" ? "expired" : "voiding"}</span>
      </div>
    </div>
  );
}

/** approve = release (capture), reject = cancel (void, or drop an order the buyer has not approved), paypal = open PayPal. */
export type Decide = (row: DecisionRow, a: "approve" | "reject" | "paypal") => void;

/** The open hold: the one thing on this screen that needs a human. */
function HoldCard({ row, now, busy, simulated, fixture, nudge, viewOnly, onDecide }: {
  row: DecisionRow;
  now: number;
  busy: boolean;
  simulated: boolean;
  /** Recorded run: mock ids, and no PayPal to approve in. */
  fixture: boolean;
  /** The PayPal popup closed without an approval: show the judge hint as a notice. */
  nudge: boolean;
  /** Opened from a shared link: only the tab that started the run holds the owner token. */
  viewOnly: boolean;
  onDecide: Decide;
}) {
  const reduce = useReducedMotion();
  const left = row.expiresAt && now ? Math.max(0, new Date(row.expiresAt).getTime() - now) : HOLD_MS;
  const why = reasonTags(row.reasons);
  const plain = orderReasons(row.reasons).filter((r) => !isWarning(r) && !/^buyer approved in PayPal$/.test(r));
  const payer = row.status === "awaiting_payer";
  return (
    <Reveal variant="stamp" inView={false} className="relative">
      {!reduce && (
        // Arrival pulse: one amber ring expands off the card, once.
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-lg border border-hold"
          initial={{ opacity: 0.7, scale: 1 }}
          animate={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: 1.2, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
        />
      )}
      <Panel as="article" tone="hold" aria-label={`${payer ? "Waiting for PayPal approval" : "Held in PayPal"}: ${usd(row.amountUsd)} at ${row.merchant}`}>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status="hold" label={payer ? "Waiting for PayPal approval" : "Held in PayPal"} />
          {simulated && <SimBadge />}
        </div>
        {viewOnly && (
          <p className="mt-3 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink">
            View only. Only the tab that started this run can approve, release or cancel it.
          </p>
        )}
        <div className="mt-5 flex items-start justify-between gap-5">
          <div className="min-w-0">
            <AnimatedNumber value={row.amountUsd} className="block text-money text-ink" />
            <p className="mt-3 font-display text-xl font-semibold tracking-tight text-ink">{row.merchant}</p>
            <p className="mt-0.5 text-sm text-ink-muted [overflow-wrap:anywhere]">{row.items}</p>
          </div>
          <CountdownRing left={left} verb={payer ? "expire" : "auto-void"} />
        </div>
        <div className="mt-5 space-y-2.5 border-t border-line pt-4">
          <p className="text-sm text-ink-muted">
            {payer
              ? "Nothing is held yet. Approve the payment as the buyer in PayPal; CartHold then authorizes it and you release or cancel it. If nobody approves, it expires."
              : "Authorized with PayPal, not taken. Release it to pay, or cancel. If nobody decides, the authorization voids itself."}
          </p>
          {why.length ? <Tags tags={why} tone="hold" /> : plain.map((r) => <p key={r} className="text-xs text-ink-muted">{plainReason(r)}</p>)}
          <Warnings reasons={row.reasons} />
          {payer && !viewOnly && <JudgeHint nudge={nudge} />}
          {fixture && !payer && (
            <p className="text-sm font-medium text-paid">Click Release to see the capture.</p>
          )}
        </div>
        <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          {payer ? (
            <Button variant="approve" size="lg" icon={<Wallet strokeWidth={2} />} loading={busy} disabled={viewOnly} onClick={() => onDecide(row, "paypal")} className="max-sm:px-4 max-sm:text-sm">
              {busy ? "Working" : "Approve with PayPal"}
            </Button>
          ) : (
            <Button variant="approve" size="lg" icon={<Check strokeWidth={2} />} loading={busy} disabled={viewOnly} onClick={() => onDecide(row, "approve")}>
              {busy ? "Working" : `Release ${usd(row.amountUsd)}`}
            </Button>
          )}
          <Button variant="ghost" size="lg" disabled={busy || viewOnly} onClick={() => onDecide(row, "reject")} className="max-sm:px-4">
            <span className="inline-flex items-center gap-1.5">
              <X aria-hidden strokeWidth={1.75} className="size-4" />
              Cancel
            </span>
          </Button>
        </div>
        <Receipt row={row} mock={fixture} className="mt-4" />
      </Panel>
    </Reveal>
  );
}

/** The agent is scripted in Simulated mode, but its PayPal sandbox order is real (QA2 #3). */
function SimBadge() {
  return (
    <span title="The agent is scripted. The guard and the PayPal sandbox order are real.">
      <Badge tone="hold">Simulated agent</Badge>
    </span>
  );
}

/** QA2 #1: a judge without a sandbox buyer login needs a way forward. */
function JudgeHint({ nudge }: { nudge: boolean }) {
  return (
    <p role={nudge ? "status" : undefined} className={cx("text-xs text-ink-muted", nudge && "rounded-md border border-info/30 bg-surface-2 px-3 py-2 text-sm text-ink")}>
      {nudge && "PayPal closed without an approval. "}
      Judges: the sandbox buyer login is in the Devpost testing instructions. No login?{" "}
      <Link href={RECORDED_RUN_HREF} className="text-info underline underline-offset-4">
        Watch the recorded run
      </Link>{" "}
      to see a full authorize → release → capture.
    </p>
  );
}

function PendingCard({ row, simulated }: { row: DecisionRow; simulated: boolean }) {
  return (
    <Panel as="article" aria-busy="true" aria-label={`Authorizing ${usd(row.amountUsd)} at ${row.merchant}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status="unknown" label="Authorizing" />
          {simulated && <SimBadge />}
        </div>
        <span className="figures text-lg text-ink">{usd(row.amountUsd)}</span>
      </div>
      <p className="mt-3 text-sm font-medium text-ink">{row.merchant}</p>
      <p className="text-xs text-ink-muted">{row.items}</p>
      <p className="mt-3 flex items-center gap-2 text-xs text-ink-muted">
        <span aria-hidden className="size-1.5 animate-shimmer rounded-pill bg-hold" />
        Checks passed. Waiting for PayPal to authorize the funds.
      </p>
      <Receipt row={row} className="mt-3" />
    </Panel>
  );
}

const PILL: Record<string, { status: Status; label?: string }> = {
  blocked: { status: "block" },
  captured: { status: "captured", label: "Paid" },
  voided: { status: "voided" },
  error: { status: "unknown", label: "PayPal error" },
  unknown: { status: "unknown", label: "Unclear" },
  expired: { status: "voided", label: "Expired" },
  cancelled: { status: "voided", label: "Cancelled" },
};

/** The few words a collapsed verdict needs: why it was stopped, or how it settled. A view-only tab did not decide. */
export function gist(row: DecisionRow, viewOnly = false): string {
  const who = viewOnly ? "the run's owner" : "you";
  if (row.status === "blocked") return hasInjection(row) ? "followed hidden text" : (reasonTags(row.reasons)[0] ?? plainReason(headline(row.reasons)));
  if (row.status === "cancelled") return `cancelled by ${who}`;
  // Checked before "expired" / "auto-voided": a shutdown sweep is not a timeout.
  if (row.decision === "system-voided" && row.status === "voided") return "voided: server restarted";
  if (row.decision === "system-voided" && row.status === "expired") return "expired: server restarted";
  if (row.status === "expired") return "PayPal approval timed out";
  if (row.reasons.includes("rejected by user")) return `rejected by ${who}`;
  if (row.reasons.some((r) => /^auto-voided/.test(r))) return "timed out";
  if (row.status === "captured") return row.verdict === "hold" ? `approved by ${who}` : "auto-paid, under limit";
  if (row.status === "error" || row.status === "unknown") return "check PayPal";
  return "";
}

/** Every settled verdict: a one-line chip that opens into the full story. */
function VerdictChip({ row, simulated, fixture, viewOnly, onReveal }: { row: DecisionRow; simulated: boolean; fixture: boolean; viewOnly: boolean; onReveal: (row: DecisionRow) => void }) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const pill = PILL[row.status] ?? { status: "unknown" as Status, label: String(row.status) };
  const blocked = row.status === "blocked";
  const lead = headline(row.reasons);
  const all = orderReasons(row.reasons);
  const id = `chip-${row.id}`;
  return (
    <Reveal variant={blocked ? "stamp" : "rise"} inView={false} y={8} className="rounded-md border border-line bg-surface-1 shadow-raise">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors duration-[var(--duration-fast)] ease-snap hover:bg-surface-2"
      >
        <StatusPill status={pill.status} label={pill.label} size="sm" />
        <span className={cx("figures shrink-0 text-sm", blocked ? "text-ink-muted line-through decoration-blocked/60" : "text-ink")}>{usd(row.amountUsd)}</span>
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="text-ink">{row.merchant}</span>
          {gist(row, viewOnly) && <span className="text-ink-faint"> / {gist(row, viewOnly)}</span>}
        </span>
        <ChevronDown aria-hidden strokeWidth={1.5} className={cx("size-4 shrink-0 text-ink-faint transition-transform duration-[var(--duration-base)] ease-snap", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={id}
            initial={reduce ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
            className="space-y-3 border-t border-line px-3 pt-3 pb-3.5"
          >
            <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted [overflow-wrap:anywhere]">
              {row.items}
              {simulated && <SimBadge />}
            </p>
            {blocked && (
              <>
                <p className="font-display text-base font-semibold leading-snug tracking-tight text-ink [overflow-wrap:anywhere]">{plainReason(lead)}</p>
                <Tags tags={reasonTags(row.reasons).filter((t) => t !== "followed hidden text" || !hasInjection(row))} />
                {all.length > 1 && (
                  <details className="group text-xs">
                    <summary className="cursor-pointer list-none text-ink-faint hover:text-ink [&::-webkit-details-marker]:hidden">
                      <span className="underline decoration-line-strong underline-offset-4">All {all.length} reasons</span>
                    </summary>
                    <ul className="mt-2 space-y-1.5">
                      {all.map((r) => (
                        <ReasonLine key={r} r={r} />
                      ))}
                    </ul>
                  </details>
                )}
                <Button variant={hasInjection(row) ? "reject" : "ghost"} size="sm" icon={<ScanEye strokeWidth={1.5} />} onClick={() => onReveal(row)}>
                  {hasInjection(row) ? "Reveal the hidden text" : "See why it was blocked"}
                </Button>
              </>
            )}
            {(row.status === "error" || row.status === "unknown") && (
              <p className="text-xs text-warning">
                {row.status === "unknown" && "Still counted against your budget until PayPal confirms. "}
                {row.reasons.at(-1)}
              </p>
            )}
            {!blocked && row.status !== "error" && row.status !== "unknown" && all.length > 0 && (
              <ul className="space-y-1.5 text-xs">
                {all.map((r) => (isWarning(r) ? <ReasonLine key={r} r={r} /> : <li key={r} className="text-ink-muted">{plainReason(r)}</li>))}
              </ul>
            )}
            <Receipt row={row} mock={fixture} />
          </motion.div>
        )}
      </AnimatePresence>
    </Reveal>
  );
}

export function VerdictStack({ guard, busy, simulated, fixture = false, nudged = null, viewOnly = false, onDecide, onReveal }: {
  guard: GuardState;
  busy: Record<string, boolean>;
  simulated: boolean;
  fixture?: boolean;
  /** Row whose PayPal popup closed without an approval. */
  nudged?: string | null;
  viewOnly?: boolean;
  onDecide: Decide;
  onReveal: (row: DecisionRow) => void;
}) {
  const now = useNow(guard.pendingHolds.length > 0);
  const newest = [...guard.rows].reverse();
  const isLive = (r: DecisionRow) => r.status === "held" || r.status === "pending" || r.status === "awaiting_payer";
  const live = newest.filter(isLive);
  const settled = newest.filter((r) => !isLive(r));
  return (
    <section aria-labelledby="verdict-h" className="flex flex-col gap-3">
      <h2 id="verdict-h" className="sr-only">
        Guard verdicts
      </h2>
      {!guard.rows.length && (
        <div className="rounded-lg border border-dashed border-line-strong px-5 py-10 text-center">
          <p className="text-sm text-ink-muted">No payment attempts yet.</p>
          <p className="mt-1 text-xs text-ink-faint">When the agent tries to pay, the guard&apos;s decision lands here.</p>
        </div>
      )}
      <ul className="flex flex-col gap-4" aria-live="polite">
        {live.map((r) => (
          <li key={r.id}>
            {r.status === "held" || r.status === "awaiting_payer" ? (
              <HoldCard row={r} now={now} busy={!!busy[r.id]} simulated={simulated} fixture={fixture} nudge={nudged === r.id} viewOnly={viewOnly} onDecide={onDecide} />
            ) : (
              <PendingCard row={r} simulated={simulated} />
            )}
          </li>
        ))}
      </ul>
      {settled.length > 0 && (
        <>
          <h3 className="mt-2 text-xs text-ink-faint">
            {live.length ? "Already decided" : "Decisions"} ({settled.length})
          </h3>
          <ul className="flex flex-col gap-2" aria-live="polite">
            {settled.map((r) => (
              <li key={r.id}>
                <VerdictChip row={r} simulated={simulated} fixture={fixture} viewOnly={viewOnly} onReveal={onReveal} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
