import { CircleCheck, Hourglass, Play, ShieldCheck, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import recorded from "@/components/demo/fixture-run.json";
import type { FixtureRun } from "@/components/demo/fixtures";
import { InjectionReveal, ProofStrip, RecordedReplay, RECORDED_RUN_HREF } from "@/components/site";
import type { ProofFigure } from "@/components/site/ProofStrip";
import { ButtonIcon, FlowDiagram, Panel, Reveal, SectionHeader, buttonClasses } from "@/components/ui";
import corpus from "@/data/attacks/corpus.json";
import heldout from "@/data/attacks/heldout.json";
import { scoreCorpus, type CorpusEntry } from "@/lib/inspector/scorecard";

const run = recorded as FixtureRun;
const total = (status: string) => run.rows.filter((r) => r.status === status).reduce((s, r) => s + r.amountUsd, 0);
const blockedCount = run.rows.filter((r) => r.status === "blocked").length;

// Scored at build time with the same function /api/scorecard serves.
const score = scoreCorpus(corpus as CorpusEntry[]);
const attacks = score.rows.filter((r) => r.label === "attack").length;
// The honest pair: pages written after tuning, never used to adjust the rules.
const unseen = scoreCorpus(heldout as CorpusEntry[]);
const unseenAttacks = unseen.rows.filter((r) => r.label === "attack").length;

const figures: ProofFigure[] = [
  { value: total("captured"), format: "usd", label: "Paid without asking", note: "One coffee blend, under the $25 ask-me limit.", tone: "paid" },
  { value: total("held"), format: "usd", label: "Held for approval", note: "Approved in PayPal and authorized. Nothing is taken until you tap Release.", tone: "hold" },
  {
    value: total("blocked"),
    format: "usd",
    label: "Blocked",
    note: `${blockedCount} orders, two of them steered by hidden text. No PayPal order created.`,
    tone: "blocked",
  },
  {
    value: score.attacksBlocked,
    format: "count",
    suffix: `of ${attacks}`,
    label: "Hidden-text attacks flagged",
    note: (
      <>
        That is our tuning set. On {unseenAttacks} attack pages it never saw, it caught{" "}
        {unseen.attacksBlocked}. Regex backstop alone, {score.falsePositives + unseen.falsePositives} honest pages
        flagged.{" "}
        <Link href="/demo/scorecard" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
          See the scorecard
        </Link>
      </>
    ),
    tone: "ink",
  },
];

const steps = [
  {
    icon: SlidersHorizontal,
    title: "You set the rules",
    body: "A budget, the stores the agent may use, a cap per item and an ask-me limit. Below that limit, purchases go through on their own.",
  },
  {
    icon: ShieldCheck,
    title: "CartHold checks every order",
    body: "Each item has to trace back to what you asked for. CartHold also reads the store pages the agent saw, and blocks an order that follows text hidden there.",
  },
  {
    icon: Hourglass,
    title: "PayPal holds the money, you decide",
    body: "For a bigger order, you approve it as the buyer in PayPal and CartHold authorizes it, so the money is held, not taken. Release captures it. Cancel voids it. You have 5 minutes to approve in PayPal before the order expires with nothing held, and once it is held, 5 minutes to release it before the hold is voided.",
  },
];

const real = [
  "The guard code: rules, provenance checks and the page inspector",
  "Live runs use the real PayPal sandbox: orders, authorizations, buyer approval on PayPal, captures and voids",
  "A Gemini agent shopping in live mode",
];
const simulated = [
  "The four stores are demo pages we wrote, hidden notes included",
  "The compromised agent replays a known attack, because a live model does not fall for it every time",
  "The recorded run on this page uses mock PayPal ids. Live runs use real sandbox ids, and sandbox money only",
];

export default function Home() {
  return (
    <main className="flex-1">
      {/* Hero */}
      <section aria-labelledby="hero-title" className="relative overflow-hidden">
        <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 opacity-70" />
        <div className="relative mx-auto max-w-6xl px-4 pt-14 pb-16 md:px-6 md:pt-20 md:pb-24">
          <div className="max-w-3xl">
            <h1 id="hero-title" className="font-display text-[2.375rem] leading-[1.04] font-semibold tracking-tight text-balance text-ink md:text-4xl">
              Your AI shopper proposes. CartHold holds the money until you say yes.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-pretty text-ink-muted">
              CartHold sits between a shopping agent and PayPal. Small buys inside your rules go through. Bigger ones
              wait as a PayPal hold. Orders steered by hidden text on a store page are blocked.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href={RECORDED_RUN_HREF} className={buttonClasses({ size: "lg", withIcon: true })}>
                Watch a recorded run
                <ButtonIcon size="lg">
                  <Play strokeWidth={1.75} />
                </ButtonIcon>
              </Link>
              <Link href="/demo" className={buttonClasses({ variant: "ghost", size: "lg" })}>
                Try the demo
              </Link>
            </div>
          </div>

          <Reveal inView={false} delay={0.1} className="mt-12 md:mt-16">
            <Panel as="figure" coreClassName="px-4 py-8 md:px-10 md:py-12">
              <FlowDiagram autoplay />
              <figcaption className="mt-6 flex flex-col gap-1 border-t border-line pt-4 text-xs text-ink-faint sm:flex-row sm:justify-between">
                <span>One purchase released, then one cancelled.</span>
                <span>The money waits on the PayPal hold in between.</span>
              </figcaption>
            </Panel>
          </Reveal>
        </div>
      </section>

      {/* Proof */}
      <section aria-label="Results" className="mx-auto max-w-6xl px-4 pb-20 md:px-6 md:pb-28">
        <ProofStrip
          caption="From one recorded run of the real guard, plus our injection test set."
          figures={figures}
        />
      </section>

      {/* Recorded replay */}
      <section aria-labelledby="replay-title" className="border-t border-line bg-surface-1/40">
        <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
          <SectionHeader
            id="replay-title"
            title="Watch an agent try to overspend"
            description="A compromised agent places five orders. CartHold decides each one before PayPal is called."
            action={
              <Link href={RECORDED_RUN_HREF} className={buttonClasses({ variant: "ghost", size: "sm" })}>
                Open it in the demo
              </Link>
            }
            className="mb-10 md:mb-14"
          />
          <RecordedReplay />
        </div>
      </section>

      {/* Injection */}
      <section id="injection" aria-labelledby="injection-title" className="scroll-mt-24 border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
          <SectionHeader
            id="injection-title"
            title="The page you see is not the page the agent reads"
            description="Stores can hide instructions for AI shoppers in places you never look. CartHold reads the same text the agent read."
            className="mb-10"
          />
          <InjectionReveal />
        </div>
      </section>

      {/* How it works */}
      <section aria-labelledby="how-title" className="border-t border-line">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 md:px-6 md:py-28 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <h2 id="how-title" className="font-display text-2xl font-semibold tracking-tight text-ink md:text-3xl">
              How it works
            </h2>
            <p className="mt-3 text-ink-muted">Three steps, on every purchase.</p>
          </div>
          <ol className="lg:col-span-8">
            {steps.map((s, i) => (
              <Reveal as="li" key={s.title} delay={i * 0.08} className="grid grid-cols-[2.5rem_1fr] gap-x-4 border-t border-line py-7 first:border-t-0 first:pt-0 md:grid-cols-[3rem_1fr]">
                <span className="figures pt-1 text-sm text-hold">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="flex items-center gap-2.5 font-display text-xl font-semibold tracking-tight text-ink">
                    <s.icon aria-hidden strokeWidth={1.5} className="size-5 text-ink-muted" />
                    {s.title}
                  </h3>
                  <p className="mt-2 max-w-xl text-pretty text-ink-muted">{s.body}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* Honesty */}
      <section id="honesty" aria-labelledby="honesty-title" className="scroll-mt-24 border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
          <SectionHeader id="honesty-title" title="What is real here" className="mb-10" />
          <div className="grid gap-4 md:grid-cols-2">
            <Panel as="div" aria-label="Real">
              <h3 className="flex items-center gap-2 text-sm font-medium text-paid">
                <CircleCheck aria-hidden strokeWidth={1.5} className="size-4" />
                Real
              </h3>
              <ul className="mt-4 space-y-3 text-sm text-ink">
                {real.map((t) => (
                  <li key={t} className="text-pretty">{t}</li>
                ))}
              </ul>
              <p className="mt-5 border-t border-line pt-4 text-xs text-pretty text-ink-muted">
                Hosted run ddc3af6a: Gemini followed the hidden Northpine note, CartHold blocked it, and the mug alone
                was held, approved and captured. Sandbox order{" "}
                <span className="figures text-ink">0B575156XB8641420</span>, capture{" "}
                <span className="figures text-ink">4GK99036D6729964W</span>.
              </p>
            </Panel>
            <Panel as="div" aria-label="Simulated">
              <h3 className="flex items-center gap-2 text-sm font-medium text-warning">
                <SlidersHorizontal aria-hidden strokeWidth={1.5} className="size-4" />
                Simulated
              </h3>
              <ul className="mt-4 space-y-3 text-sm text-ink">
                {simulated.map((t) => (
                  <li key={t} className="text-pretty">{t}</li>
                ))}
              </ul>
            </Panel>
          </div>

          <div className="mt-16 flex flex-col items-start gap-6 border-t border-line pt-10 md:flex-row md:items-center md:justify-between">
            <p className="max-w-lg font-display text-2xl font-semibold tracking-tight text-balance text-ink">
              See the hold, then decide what happens to the money.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href={RECORDED_RUN_HREF} className={buttonClasses({ size: "lg", withIcon: true })}>
                Watch a recorded run
                <ButtonIcon size="lg">
                  <Play strokeWidth={1.75} />
                </ButtonIcon>
              </Link>
              <Link href="/demo" className={buttonClasses({ variant: "ghost", size: "lg" })}>
                Try the demo
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
