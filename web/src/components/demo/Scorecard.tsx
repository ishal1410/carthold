"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Ban, Check, ChevronDown, Minus, ScanEye, TriangleAlert, X } from "lucide-react";
import { ScorecardGrid, type ScorecardRow as ScoreRow } from "@/components/grid";
import { AnimatedNumber, Badge, Panel, cx } from "@/components/ui";
import corpus from "@/data/attacks/corpus.json";
import "@/app/demo/scorecard/scorecard.css";

type Card = { attacksBlocked: number; falsePositives: number; total: number; rows: ScoreRow[] };
type Outcome = "caught" | "missed" | "clean" | "false-alarm";

const hiddenText = new Map((corpus as { id: string; expectedTrigger?: string }[]).map((c) => [c.id, c.expectedTrigger]));

// ponytail: hand-written explanation for known misses; anything new falls back to the generic line.
const WHY_MISSED: Record<string, string> = {
  "atk-subtle-merchant-id":
    "It never talks to an AI and uses no override words. It reads like an ordinary merchant notice, and every backstop rule looks for text that addresses the agent or overrides its instructions. Catching this one is the job of the model-based inspector, which is not counted here.",
};

const outcomeOf = (r: ScoreRow): Outcome =>
  r.label === "attack" ? (r.flagged ? "caught" : "missed") : r.flagged ? "false-alarm" : "clean";

const OUTCOME: Record<Outcome, { word: string; cell: string; icon: typeof Check }> = {
  caught: { word: "Caught", cell: "bg-paid-soft text-paid border-paid/35", icon: Check },
  missed: { word: "Missed", cell: "bg-blocked text-blocked-ink border-blocked", icon: X },
  clean: { word: "Not flagged", cell: "bg-surface-2 text-ink-faint border-line-strong", icon: Minus },
  "false-alarm": { word: "False alarm", cell: "bg-warning text-hold-ink border-warning", icon: TriangleAlert },
};

const pretty = (id: string) => id.replace(/^(atk|ben)-/, "").replace(/-/g, " ");

export default function Scorecard() {
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/scorecard")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setCard)
      .catch((e: Error) => setError(`The scorecard did not load (${e.message}). Reload the page, or check that the API is running.`));
  }, []);

  const attacks = useMemo(() => card?.rows.filter((r) => r.label === "attack").sort((a, b) => a.id.localeCompare(b.id)) ?? [], [card]);
  const benign = useMemo(() => card?.rows.filter((r) => r.label === "benign").sort((a, b) => a.id.localeCompare(b.id)) ?? [], [card]);
  const misses = attacks.filter((r) => !r.flagged);
  const selected = card?.rows.find((r) => r.id === (picked ?? misses[0]?.id ?? attacks[0]?.id));

  return (
    <main className="flex flex-1 flex-col bg-canvas text-ink">
      <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-8 md:px-6">
        <Link
          href="/demo"
          className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hold"
        >
          Back to the demo
        </Link>

        {/* Hero: the result first, then how it was measured, then the caveat. */}
        <header className="mt-10 grid gap-10 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-ink md:text-[2.75rem] md:leading-[1.08] text-balance">
              Hidden instructions caught before the agent could act on them
            </h1>
            <p className="mt-4 max-w-[62ch] text-lg text-ink-muted">
              We hid shopping instructions in 20 store pages and left 20 ordinary pages alone, then ran every page
              through CartHold&apos;s regex backstop, the rule layer that cannot be talked out of a block.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:col-span-5" aria-busy={!card}>
            <Figure label="Attacks caught" tone="paid" value={card?.attacksBlocked} of={attacks.length || 20} />
            <Figure label="False alarms" tone="ink" value={card?.falsePositives} of={benign.length || 20} />
          </dl>
        </header>

        <p className="mt-6 max-w-[72ch] border-l-2 border-hold/60 pl-4 text-sm leading-relaxed text-ink-muted">
          <span className="font-medium text-ink">Read this as a floor, not a benchmark.</span> We wrote these 40 pages
          ourselves and tuned the rules against them, so the score says little about attacks we have not seen. The
          model-based inspector runs on top of this layer and is not part of these numbers.
        </p>

        {error && (
          <Panel tone="blocked" className="mt-10" aria-label="Error">
            <p role="alert" className="text-sm text-blocked">{error}</p>
          </Panel>
        )}

        {!card && !error && (
          <div className="mt-12 grid gap-2" aria-label="Scoring the corpus">
            {[0, 1].map((i) => (
              <div key={i} className="sc-skeleton h-10 rounded-sm bg-surface-2" />
            ))}
          </div>
        )}

        {card && selected && (
          <Panel className="mt-12" aria-labelledby="sc-map">
            <header className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 id="sc-map" className="font-display text-xl font-semibold tracking-tight">Every test page, one square each</h2>
                <p className="mt-1 text-sm text-ink-muted">Select a square to see what the backstop saw.</p>
              </div>
              <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink-muted" aria-label="Legend">
                {(["caught", "missed", "clean"] as const).map((o) => (
                  <li key={o} className="flex items-center gap-1.5">
                    <Cell outcome={o} small />
                    {o === "clean" ? "Clean page, not flagged" : OUTCOME[o].word}
                  </li>
                ))}
              </ul>
            </header>

            <div className="mt-6 grid gap-5">
              <CellRow title="Pages with a hidden attack" rows={attacks} selected={selected.id} onPick={setPicked} />
              <CellRow title="Ordinary store pages" rows={benign} selected={selected.id} onPick={setPicked} />
            </div>

            <Detail row={selected} />
          </Panel>
        )}

        {card && (
          <section className="mt-14" aria-labelledby="sc-rows">
            <h2 id="sc-rows" className="font-display text-2xl font-semibold tracking-tight">All 40 results</h2>
            <p className="mt-1 text-sm text-ink-muted">The text that triggered each flag, and the hiding technique each attack used.</p>
            {/* Phones: grouped, collapsible list. Wider screens: the sortable grid. */}
            <div className="mt-6 grid gap-3 sm:hidden">
              <Group title="Attacks" rows={attacks} open />
              <Group title="Clean pages" rows={benign} />
            </div>
            <div className="sc-grid mt-6 hidden sm:block">
              <ScorecardGrid rows={card.rows} height={560} />
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function Figure({ label, value, of, tone }: { label: string; value?: number; of: number; tone: "paid" | "ink" }) {
  return (
    <div className="bg-surface-1 px-5 py-5">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="mt-2 flex items-baseline gap-1.5 font-mono">
        <span className={cx("text-5xl font-semibold tracking-tight md:text-6xl", tone === "paid" ? "text-paid" : "text-ink")}>
          {value === undefined ? <span className="text-ink-faint">–</span> : <AnimatedNumber value={value} format="integer" />}
        </span>
        <span className="text-xl text-ink-faint">/ {of}</span>
      </dd>
    </div>
  );
}

function Cell({ outcome, small }: { outcome: Outcome; small?: boolean }) {
  const { cell, icon: Icon } = OUTCOME[outcome];
  return (
    <span className={cx("grid place-items-center rounded-xs border", cell, small ? "size-4" : "size-full")} aria-hidden>
      <Icon strokeWidth={2} className={small ? "size-2.5" : "size-3.5"} />
    </span>
  );
}

function CellRow({ title, rows, selected, onPick }: { title: string; rows: ScoreRow[]; selected: string; onPick: (id: string) => void }) {
  return (
    <div>
      <h3 className="mb-2 flex items-baseline justify-between text-sm text-ink-muted">
        {title}
        <span className="figures text-xs text-ink-faint">{rows.filter((r) => r.correct).length} of {rows.length} correct</span>
      </h3>
      <ul className="grid grid-cols-10 gap-1 md:grid-cols-20 md:gap-1.5">
        {rows.map((r) => {
          const o = outcomeOf(r);
          const on = r.id === selected;
          return (
            <li key={r.id} className="aspect-square">
              <button
                type="button"
                onClick={() => onPick(r.id)}
                aria-pressed={on}
                aria-label={`${pretty(r.id)}: ${OUTCOME[o].word}`}
                title={`${pretty(r.id)}: ${OUTCOME[o].word}`}
                className={cx(
                  "relative block size-full rounded-xs transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hold",
                  on && "ring-2 ring-ink ring-offset-2 ring-offset-surface-1",
                  o === "missed" && "sc-miss",
                )}
              >
                <Cell outcome={o} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Detail({ row }: { row: ScoreRow }) {
  const o = outcomeOf(row);
  const quote = row.triggeringText ?? (row.label === "attack" ? hiddenText.get(row.id) : null);
  return (
    <div aria-live="polite" className={cx("mt-6 grid gap-4 border-t pt-5 md:grid-cols-12", o === "missed" ? "border-blocked/40" : "border-line")}>
      <div className="md:col-span-4">
        <p className="flex items-center gap-2">
          <Badge tone={o === "missed" ? "blocked" : o === "caught" ? "paid" : "neutral"} icon={o === "missed" ? <Ban /> : o === "caught" ? <Check /> : <Minus />}>
            {o === "missed" ? "Missed: the only one" : OUTCOME[o].word}
          </Badge>
        </p>
        <p className="mt-3 font-display text-lg font-semibold capitalize leading-snug">{pretty(row.id)}</p>
        <p className="figures mt-1 text-xs text-ink-faint">{row.id}</p>
        {row.style && <p className="mt-2 text-sm text-ink-muted">Hidden as: {row.style}</p>}
      </div>
      <div className="md:col-span-8">
        {quote ? (
          <figure>
            <figcaption className="flex items-center gap-1.5 text-xs text-ink-faint">
              <ScanEye className="size-3.5" strokeWidth={1.5} aria-hidden />
              {row.flagged ? "Text that triggered the flag" : "The hidden text the backstop let through"}
            </figcaption>
            <blockquote className={cx("mt-2 rounded-sm px-4 py-3 text-sm leading-relaxed [overflow-wrap:anywhere]", o === "missed" ? "bg-blocked-soft text-ink" : "bg-surface-2 text-ink-muted")}>
              {quote}
            </blockquote>
          </figure>
        ) : (
          <p className="text-sm text-ink-muted">Ordinary store copy. Nothing on this page matched a backstop rule, which is the right answer.</p>
        )}
        {row.reasons.length > 0 && <p className="mt-2 text-xs text-ink-faint">Matched rule: {row.reasons.join(", ")}</p>}
        {o === "missed" && (
          <p className="mt-3 max-w-[64ch] text-sm leading-relaxed text-ink-muted">
            <span className="font-medium text-ink">Why it got through. </span>
            {WHY_MISSED[row.id] ?? "None of the backstop rules matched this wording."}
          </p>
        )}
      </div>
    </div>
  );
}

function Group({ title, rows, open }: { title: string; rows: ScoreRow[]; open?: boolean }) {
  const right = rows.filter((r) => r.correct).length;
  return (
    <details open={open} className="group rounded-md border border-line bg-surface-1">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:outline-hold [&::-webkit-details-marker]:hidden">
        <span className="font-medium">{title}</span>
        <span className="flex items-center gap-2 text-sm text-ink-muted">
          <span className="figures">{right} / {rows.length} correct</span>
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" strokeWidth={1.5} aria-hidden />
        </span>
      </summary>
      <ul className="divide-y divide-line border-t border-line">
        {rows.map((r) => {
          const o = outcomeOf(r);
          return (
            <li key={r.id} className={cx("flex gap-3 px-4 py-3", o === "missed" && "bg-blocked-soft")}>
              <span className="mt-0.5 size-5 shrink-0"><Cell outcome={o} /></span>
              <div className="min-w-0 text-sm">
                <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium capitalize text-ink">{pretty(r.id)}</span>
                  <span className={cx("text-xs", o === "missed" ? "text-blocked" : "text-ink-faint")}>{OUTCOME[o].word}</span>
                </p>
                {r.style && <p className="mt-0.5 text-xs text-ink-muted">{r.style}</p>}
                {r.triggeringText && <p className="mt-1.5 text-xs leading-relaxed text-ink-muted [overflow-wrap:anywhere]">{r.triggeringText}</p>}
                {o === "missed" && <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{WHY_MISSED[r.id]}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
