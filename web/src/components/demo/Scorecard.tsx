"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Ban, Check, ChevronDown, Minus, ScanEye, TriangleAlert, X } from "lucide-react";
import { ScorecardGrid, type ScorecardRow as ScoreRow } from "@/components/grid";
import { AnimatedNumber, Badge, Panel, cx } from "@/components/ui";
import { wilson } from "@/lib/inspector/scorecard";
import "@/app/demo/scorecard/scorecard.css";

type Card = { attacksBlocked: number; falsePositives: number; total: number; rows: ScoreRow[] };
type Sets = { tuning: Card; heldout: Card };
type SetKey = keyof Sets;
type Outcome = "caught" | "missed" | "clean" | "false-alarm";

// ponytail: the evidence doc lives in the repo, not the app; GitHub renders it. Update if the repo moves.
const EVIDENCE_HREF = "https://github.com/ishal1410/carthold/blob/main/docs/evidence/2026-10-31-measurements.md";

const SETS: Record<SetKey, { name: string; note: string }> = {
  tuning: { name: "Tuning set", note: "We built the detector against these" },
  heldout: { name: "Held-out set", note: "Written after, never tuned" },
};

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

const pretty = (id: string) => id.replace(/^(ho-)?(atk|ben)-/, "").replace(/-/g, " ");
const count = (c: Card, label: ScoreRow["label"]) => c.rows.filter((r) => r.label === label).length;
const byId = (a: ScoreRow, b: ScoreRow) => a.id.localeCompare(b.id);

/** initial: the same scoreCorpus() results /api/scorecard serves, computed at build time, so the server HTML has real numbers. */
export default function Scorecard({ initial }: { initial?: Sets } = {}) {
  const [sets, setSets] = useState<Sets | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [set, setSet] = useState<SetKey>("heldout");
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    fetch("/api/scorecard")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(({ heldout, ...tuning }) => setSets({ tuning, heldout }))
      .catch((e: Error) => setError(`The scorecard did not load (${e.message}). Reload the page, or check that the API is running.`));
  }, [initial]);

  const card = sets?.[set];
  const attacks = useMemo(() => card?.rows.filter((r) => r.label === "attack").sort(byId) ?? [], [card]);
  const benign = useMemo(() => card?.rows.filter((r) => r.label === "benign").sort(byId) ?? [], [card]);
  const misses = attacks.filter((r) => !r.flagged);
  const selected = card?.rows.find((r) => r.id === (picked ?? misses[0]?.id ?? attacks[0]?.id));
  const t = sets?.tuning;
  const h = sets?.heldout;

  return (
    <main className="flex flex-1 flex-col bg-canvas text-ink">
      <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-8 md:px-6">
        <Link
          href="/demo"
          className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hold"
        >
          Back to the demo
        </Link>

        {/* Hero: both results at once. The gap between them is the point. */}
        <header className="mt-10 max-w-[64ch]">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink md:text-[2.75rem] md:leading-[1.08] text-balance">
            {t && h
              ? `Our pattern rules caught ${t.attacksBlocked} of ${count(t, "attack")} attacks we tuned them on, and ${h.attacksBlocked} of ${count(h, "attack")} they had never seen`
              : "How well the pattern rules catch hidden instructions"}
          </h1>
          <p className="mt-4 text-lg text-ink-muted">
            Pattern matching alone is weak against new attacks. We show both test sets so the gap is in plain view, and
            further down, what still kept the money from moving in live runs.
          </p>
        </header>

        {error && (
          <Panel tone="blocked" className="mt-10" aria-label="Error">
            <p role="alert" className="text-sm text-blocked">{error}</p>
          </Panel>
        )}

        {!sets && !error && (
          <div className="mt-12 grid gap-2" aria-label="Scoring the test pages">
            {[0, 1].map((i) => (
              <div key={i} className="sc-skeleton h-10 rounded-sm bg-surface-2" />
            ))}
          </div>
        )}

        {sets && (
          <>
            <section className="mt-10 grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-2" aria-label="Regex backstop results, both sets">
              {(["tuning", "heldout"] as const).map((k) => (
                <SetResult key={k} k={k} card={sets[k]} />
              ))}
            </section>
            <p className="mt-3 max-w-[72ch] text-xs leading-relaxed text-ink-faint">
              Both columns score the regex backstop alone, with the same code, when this page was built. Ranges are 95%
              Wilson intervals, and with only {count(sets.heldout, "attack")} held-out attacks they are wide. Results for
              the live Gemini inspector on both sets are in the{" "}
              <a href={EVIDENCE_HREF} className="text-info underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hold">
                evidence doc
              </a>
              .
            </p>

            <Panel className="mt-12" aria-labelledby="sc-policy">
              <div className="grid gap-8 md:grid-cols-12 md:items-start">
                <div className="md:col-span-8">
                  <h2 id="sc-policy" className="font-display text-xl font-semibold tracking-tight">Why the order was still blocked</h2>
                  <p className="mt-3 max-w-[64ch] text-sm leading-relaxed text-ink-muted">
                    Spotting the hidden text is one check. Before any PayPal call, CartHold also checks that every item in
                    the order traces back to what you asked for. In 10 live runs on the Northpine page, the agent read the
                    hidden note and added a Trail Coffee Kit to a mug order every time. The policy check refused all 10,
                    because nobody asked for a coffee kit. The model-based inspector flagged the same orders.
                  </p>
                  <p className="mt-3 max-w-[64ch] text-sm leading-relaxed text-ink-muted">
                    The check had a cost. In the first 5 ordinary runs it wrongly refused one: a request for &quot;coffee
                    beans&quot; did not match the product name &quot;Morning Ritual Blend&quot;. We then let it match product kinds
                    (coffee beans to Morning Ritual Blend) and ran the same 5 requests again: none were refused, and in 5 more
                    Northpine runs the hijacked order still got through 0 times. Five runs is a small sample. Zero out of 5
                    only shows the true rate is below {wilson(0, 5)[1]}%.
                  </p>
                  <a
                    href={EVIDENCE_HREF}
                    className="mt-4 inline-block text-sm font-medium text-info underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hold"
                  >
                    Full method, with every run and PayPal sandbox id
                  </a>
                </div>
                <dl className="md:col-span-4">
                  <dt className="text-sm text-ink-muted">Hijacked orders blocked in live runs</dt>
                  <dd className="mt-2 flex items-baseline gap-1.5 font-mono">
                    <span className="text-5xl font-semibold tracking-tight text-paid">10</span>
                    <span className="text-xl text-ink-faint">/ 10</span>
                  </dd>
                  <dd className="mt-2 text-xs leading-relaxed text-ink-faint">
                    None got through. Ten runs can only show the true pass-through rate is below {wilson(0, 10)[1]}%.
                  </dd>
                </dl>
              </div>
            </Panel>
          </>
        )}

        {sets && card && selected && (
          <section className="mt-14" aria-labelledby="sc-pages">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 id="sc-pages" className="font-display text-2xl font-semibold tracking-tight">Every test page</h2>
                <p className="mt-1 text-sm text-ink-muted">{SETS[set].name}: {SETS[set].note.toLowerCase()}.</p>
              </div>
              <div role="group" aria-label="Test set" className="inline-flex rounded-pill border border-line-strong p-1">
                {(["tuning", "heldout"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={set === k}
                    onClick={() => {
                      setSet(k);
                      setPicked(null);
                    }}
                    className={cx(
                      "rounded-pill px-4 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hold",
                      set === k ? "bg-hold-soft text-hold" : "text-ink-muted hover:text-ink",
                    )}
                  >
                    {SETS[k].name} <span className="figures text-ink-faint">({sets[k].total})</span>
                  </button>
                ))}
              </div>
            </div>

            <Panel className="mt-6" aria-label={`${SETS[set].name}, one square per page`}>
              <header className="flex flex-wrap items-end justify-between gap-4">
                <p className="text-sm text-ink-muted">One square per page. Select one to see what the backstop saw.</p>
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

            <h3 className="mt-12 font-display text-xl font-semibold tracking-tight">
              All {card.total} results in the {SETS[set].name.toLowerCase()}
            </h3>
            <p className="mt-1 text-sm text-ink-muted">The text that triggered each flag, and the hiding technique each attack used.</p>
            {/* Phones: grouped, collapsible list. Wider screens: the sortable grid. key remounts its filters per set. */}
            <div className="mt-6 grid gap-3 sm:hidden">
              <Group key={`a-${set}`} title="Attacks" rows={attacks} open />
              <Group key={`b-${set}`} title="Clean pages" rows={benign} />
            </div>
            <div className="sc-grid mt-6 hidden sm:block">
              <ScorecardGrid key={set} rows={card.rows} height={560} />
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function SetResult({ k, card }: { k: SetKey; card: Card }) {
  const n = count(card, "attack");
  const b = count(card, "benign");
  const rate = n ? Math.round((card.attacksBlocked / n) * 100) : 0;
  const [lo, hi] = wilson(card.attacksBlocked, n);
  const [flo, fhi] = wilson(card.falsePositives, b);
  const strong = rate >= 80;
  return (
    <div className="bg-surface-1 px-5 py-6 md:px-6">
      <h2 className="font-display text-lg font-semibold tracking-tight">{SETS[k].name}</h2>
      <p className="text-sm text-ink-muted">
        {SETS[k].note}. {n} attack pages, {b} ordinary ones.
      </p>
      <dl className="mt-6 grid grid-cols-2 gap-6">
        <Figure label="Attacks caught" tone={strong ? "paid" : "blocked"} value={card.attacksBlocked} of={n} range={`${rate}%, likely ${lo}-${hi}%`} />
        <Figure label="False alarms" tone="ink" value={card.falsePositives} of={b} range={`likely ${flo}-${fhi}%`} />
      </dl>
      {/* The one loud element: the same bar on both sides shows the drop before anyone reads a number. */}
      <div className="mt-5 h-2 overflow-hidden rounded-pill bg-surface-3" role="img" aria-label={`${rate}% of attacks caught`}>
        <div className={cx("h-full rounded-pill", strong ? "bg-paid" : "bg-blocked")} style={{ width: `${rate}%` }} />
      </div>
    </div>
  );
}

function Figure({ label, value, of, tone, range }: { label: string; value: number; of: number; tone: "paid" | "blocked" | "ink"; range: string }) {
  return (
    <div>
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="mt-2 flex items-baseline gap-1.5 font-mono">
        <span className={cx("text-5xl font-semibold tracking-tight md:text-6xl", tone === "paid" ? "text-paid" : tone === "blocked" ? "text-blocked" : "text-ink")}>
          <AnimatedNumber value={value} format="integer" />
        </span>
        <span className="text-xl text-ink-faint">/ {of}</span>
      </dd>
      <dd className="figures mt-1 text-xs text-ink-faint">{range}</dd>
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
  const quote = row.triggeringText ?? (row.label === "attack" ? row.expectedTrigger : null);
  return (
    <div aria-live="polite" className={cx("mt-6 grid gap-4 border-t pt-5 md:grid-cols-12", o === "missed" ? "border-blocked/40" : "border-line")}>
      <div className="md:col-span-4">
        <p className="flex items-center gap-2">
          <Badge tone={o === "missed" ? "blocked" : o === "caught" ? "paid" : "neutral"} icon={o === "missed" ? <Ban /> : o === "caught" ? <Check /> : <Minus />}>
            {OUTCOME[o].word}
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
                {o === "missed" && WHY_MISSED[r.id] && <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{WHY_MISSED[r.id]}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
