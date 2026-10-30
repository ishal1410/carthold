"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ScorecardGrid, type ScorecardRow as ScoreRow } from "@/components/grid";

type Card = { attacksBlocked: number; falsePositives: number; total: number; rows: ScoreRow[] };

export default function Scorecard() {
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/scorecard")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setCard)
      .catch((e: Error) => setError(`Scorecard did not load (${e.message}). Is the API running?`));
  }, []);

  const attacks = card?.rows.filter((r) => r.label === "attack").length ?? 0;
  const benign = card ? card.total - attacks : 0;

  return (
    <main className="flex flex-1 flex-col bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <Link href="/demo" className="rounded text-sm text-emerald-300 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-400">
          Back to the demo
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">
          Injection scorecard: regex backstop on our own test set
          {card && (
            <span className="block text-lg font-normal text-zinc-400">
              ({attacks} attacks / {benign} benign)
            </span>
          )}
        </h1>
        <p className="mt-2 max-w-2xl text-zinc-400">
          Each page in our attack corpus, run through the regex backstop only. The Gemini inspector is not part of these
          numbers. Attacks hide instructions in different ways; benign pages are ordinary store copy that should not be
          flagged.
        </p>
        <p className="mt-3 max-w-2xl rounded-xl border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm text-amber-100/90">
          Caveat: we wrote these attacks and tuned the regexes against them, so a high score here says little about
          attacks we have not seen. A paraphrased injection that never addresses the agent can get past the backstop.
        </p>
        {error && (
          <p role="alert" className="mt-6 rounded-xl border border-orange-400/40 bg-orange-400/10 px-4 py-3 text-sm text-orange-200">
            {error}
          </p>
        )}
        {!card && !error && <p className="ag-pulse mt-8 text-sm text-zinc-500">Scoring the corpus</p>}
        {card && (
          <>
            <dl className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/5 p-6">
                <dt className="text-sm text-zinc-400">Attacks flagged by the regex backstop</dt>
                <dd className="mt-1 text-5xl font-semibold tabular-nums text-emerald-300">
                  {card.attacksBlocked}
                  <span className="text-2xl text-zinc-500"> / {attacks}</span>
                </dd>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <dt className="text-sm text-zinc-400">Benign pages wrongly flagged</dt>
                <dd className="mt-1 text-5xl font-semibold tabular-nums">
                  {card.falsePositives}
                  <span className="text-2xl text-zinc-500"> / {benign}</span>
                </dd>
              </div>
            </dl>
            <div className="mt-8">
              <ScorecardGrid rows={card.rows} />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
