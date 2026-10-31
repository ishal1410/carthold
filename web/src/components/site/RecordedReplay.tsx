"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { FIXTURE_MANDATE, FIXTURE_REQUEST, FIXTURE_STEPS, type FixtureRun } from "@/components/demo/fixtures";
import recorded from "@/components/demo/fixture-run.json";
import { AnimatedNumber, Badge, Button, Panel, StatusPill, StreamItem, cx } from "@/components/ui";
import type { Status } from "@/components/ui";

const run = recorded as FixtureRun;
type Row = FixtureRun["rows"][number];

type Ev =
  | { kind: "think"; step: number; text: string }
  | { kind: "read"; step: number; slug: string }
  | { kind: "propose"; step: number; summary: string; total: number }
  | { kind: "verdict"; step: number; row: Row };

const STEP_MS = 700;

function buildEvents(): Ev[] {
  const ev: Ev[] = [];
  FIXTURE_STEPS.forEach((s, i) => {
    const step = i + 1;
    const row = run.rows[i];
    ev.push({ kind: "think", step, text: s.think });
    if (s.read) ev.push({ kind: "read", step, slug: s.read });
    const total = s.order.items.reduce((sum, it) => sum + it.quantity * it.unitPriceUsd, 0);
    const summary = s.order.items.map((it) => `${it.quantity} x ${it.name}`).join(", ");
    ev.push({ kind: "propose", step, summary: `${s.order.merchant}: ${summary}`, total });
    if (row) ev.push({ kind: "verdict", step, row });
  });
  return ev;
}

const statusOf: Record<string, Status> = { blocked: "block", captured: "captured", held: "hold", voided: "voided" };
const verdictWord: Record<string, string> = { blocked: "Refused", captured: "Paid", held: "Held for you" };

function headline(row: Row): string {
  const inspector = row.reasons.find((r) => r.startsWith("inspector:"));
  if (inspector) return "The order follows hidden text on the store page.";
  if (row.status === "captured") return "Inside your rules and under the $25 ask-me limit, so it paid right away.";
  if (row.status === "held") return "Over the $25 ask-me limit. PayPal holds the money until you decide.";
  return row.reasons[0] ? row.reasons[0].charAt(0).toUpperCase() + row.reasons[0].slice(1) + "." : "";
}

const events = buildEvents();

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

/** Auto-playing replay of the recorded guard run (fixture-run.json). Pausable; static under reduced motion. */
export function RecordedReplay() {

  const reduce = Boolean(useReducedMotion());
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.25 });
  const [count, setCount] = useState(1);
  const [playing, setPlaying] = useState(true);

  const done = count >= events.length;
  const shown = reduce ? events.length : count;

  useEffect(() => {
    if (reduce || !playing || !inView || done) return;
    const id = window.setTimeout(() => setCount((c) => c + 1), STEP_MS);
    return () => window.clearTimeout(id);
  }, [reduce, playing, inView, done, count]);

  const visible = events.slice(0, shown);
  const verdicts = visible.flatMap((e) => (e.kind === "verdict" ? [e.row] : []));
  const sum = (status: string) => verdicts.filter((r) => r.status === status).reduce((s, r) => s + r.amountUsd, 0);

  const toggle = () => {
    if (done) {
      setCount(1);
      setPlaying(true);
    } else setPlaying((p) => !p);
  };

  return (
    <div ref={ref} className="grid gap-6 lg:grid-cols-12 lg:gap-10">
      <div className="lg:col-span-5">
        <div className="lg:sticky lg:top-24">
          <Panel as="div" aria-label="Recorded run summary">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">Recorded run</Badge>
              <span className="text-xs text-ink-faint">Real guard code, mock PayPal ids</span>
            </div>
            <p className="mt-5 text-sm text-ink-muted">The shopper asked</p>
            <blockquote className="mt-1 font-display text-xl font-medium tracking-tight text-pretty text-ink">
              &ldquo;{FIXTURE_REQUEST}&rdquo;
            </blockquote>
            <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Rules for this run">
              {[
                `${usd(FIXTURE_MANDATE.budgetUsd)} budget`,
                `Auto-pay up to ${usd(FIXTURE_MANDATE.approvalThresholdUsd)}`,
                `${usd(FIXTURE_MANDATE.perItemCapUsd)} per item`,
                `${FIXTURE_MANDATE.maxQuantity} of any item`,
              ].map((r) => (
                <li key={r} className="figures rounded-pill border border-line px-2.5 py-1 text-2xs text-ink-muted">
                  {r}
                </li>
              ))}
            </ul>

            <dl className="mt-6 grid grid-cols-3 border-t border-line pt-5">
              {[
                { label: "Paid", value: sum("captured"), cls: "text-paid" },
                { label: "Held", value: sum("held"), cls: "text-hold" },
                { label: "Refused", value: sum("blocked"), cls: "text-blocked" },
              ].map((t, i) => (
                <div key={t.label} className={cx(i > 0 && "border-l border-line pl-4")}>
                  <dt className="text-xs text-ink-muted">{t.label}</dt>
                  <dd className={cx("mt-1 text-xl md:text-2xl", t.cls)}>
                    <span className="figures opacity-60">$</span>
                    <AnimatedNumber value={t.value} format="integer" />
                  </dd>
                </div>
              ))}
            </dl>

            {!reduce && (
              <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-5">
                <span className="figures text-xs text-ink-faint" aria-live="polite">
                  {verdicts.length} of {run.rows.length} decisions
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggle}
                  icon={done ? <RotateCcw strokeWidth={1.75} /> : playing ? <Pause strokeWidth={1.75} /> : <Play strokeWidth={1.75} />}
                >
                  {done ? "Replay" : playing ? "Pause" : "Play"}
                </Button>
              </div>
            )}
          </Panel>
        </div>
      </div>

      <ol className="lg:col-span-7" aria-label="Agent steps and CartHold decisions">
        {visible.map((e, i) => {
          if (e.kind === "verdict") {
            const status = statusOf[e.row.status] ?? "unknown";
            const tone = status === "block" ? "blocked" : status === "hold" ? "hold" : "paid";
            const extra = e.row.reasons.length - 1;
            return (
              <motion.li
                key={i}
                initial={reduce ? false : { opacity: 0, scale: 1.06 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.48, ease: [0.32, 0.72, 0, 1] }}
                className="my-3 ml-5"
              >
                <Panel as="div" tone={tone} coreClassName="p-4 md:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <StatusPill status={status} label={verdictWord[e.row.status]} />
                      <span className="text-sm text-ink-muted">{e.row.merchant}</span>
                    </div>
                    <span className="figures text-lg text-ink">{usd(e.row.amountUsd)}</span>
                  </div>
                  <p className="mt-3 text-sm text-pretty text-ink">{headline(e.row)}</p>
                  {e.row.triggeringText && (
                    <p className="mt-2 border-l-2 border-blocked/60 pl-3 text-sm text-pretty text-blocked">
                      &ldquo;{e.row.triggeringText}&rdquo;
                    </p>
                  )}
                  {e.row.status === "blocked" && extra > 0 && (
                    <p className="mt-2 text-xs text-ink-faint">
                      {extra} more {extra === 1 ? "check" : "checks"} failed. No PayPal order was created.
                    </p>
                  )}
                  {e.row.status === "blocked" && extra === 0 && (
                    <p className="mt-2 text-xs text-ink-faint">No PayPal order was created.</p>
                  )}
                </Panel>
              </motion.li>
            );
          }
          if (e.kind === "think")
            return (
              <StreamItem key={i} tone="info" title="Agent" time={`step ${e.step}`}>
                {e.text}
              </StreamItem>
            );
          if (e.kind === "read")
            return (
              <StreamItem key={i} tone="neutral" title="Read store page">
                <span className="figures text-xs">/stores/{e.slug}</span>
              </StreamItem>
            );
          return (
            <StreamItem key={i} tone="hold" title={`Proposed ${usd(e.total)}`}>
              {e.summary}
            </StreamItem>
          );
        })}
      </ol>
    </div>
  );
}
