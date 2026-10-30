import Link from "next/link";

const checks = [
  {
    title: "Your rules first",
    body: "Budget ($100 per demo run), allowed stores, per-item cap and quantity are checked on every purchase the agent proposes. Items and quantities must trace back to what you actually asked for.",
  },
  {
    title: "Page inspection",
    body: "Gemini plus a regex backstop read the store pages the agent saw. An order that follows hidden text aimed at AI agents is refused, and you can see the exact sentence.",
  },
  {
    title: "Small buys go through, bigger ones wait",
    body: `Auto-pay up to $25 per demo run without asking; anything beyond that waits for your approval. Anything waiting is a PayPal authorization: the money is held, and it is captured only if you tap Approve. Reject, or do nothing for 5 minutes, and it is voided.`,
  },
];

export default function Home() {
  return (
    <main className="relative flex flex-1 flex-col items-center overflow-hidden bg-zinc-950 px-4 text-zinc-100">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[880px] -translate-x-1/2 rounded-full bg-emerald-500/15 blur-3xl"
      />
      <section className="relative mx-auto flex w-full max-w-4xl flex-col items-center pt-24 pb-16 text-center sm:pt-32">
        <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-medium tracking-wide text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          PayPal sandbox · Agentic commerce
        </span>
        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
          CartHold
          <span className="mt-3 block bg-gradient-to-r from-zinc-100 to-zinc-400 bg-clip-text text-2xl font-medium text-transparent sm:text-4xl">
            a payment-hold firewall for AI shopping agents
          </span>
        </h1>
        <p className="mt-6 max-w-xl text-pretty text-base text-zinc-400 sm:text-lg">
          Your agent shops. CartHold checks each purchase before PayPal sees it: small, in-rules
          buys are paid right away, larger ones are held until you approve, and anything off-mandate
          is refused.
        </p>
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/demo"
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-5 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
          >
            Open the live demo
            <span aria-hidden>&rarr;</span>
          </Link>
          <Link
            href="/demo/scorecard"
            className="rounded-xl border border-white/15 px-5 py-3 text-sm font-medium text-zinc-200 transition-colors hover:border-white/30 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
          >
            Injection scorecard
          </Link>
        </div>
        <Link
          href="/stores"
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-2 text-sm text-zinc-300 underline decoration-zinc-600 underline-offset-4 transition-colors hover:border-white/25 hover:text-white hover:decoration-zinc-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
        >
          Browse the demo stores the agent shops at
          <span aria-hidden>&rarr;</span>
        </Link>
      </section>

      <section className="relative mx-auto grid w-full max-w-4xl gap-4 pb-24 sm:grid-cols-3">
        {checks.map((c, i) => (
          <div
            key={c.title}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm transition-colors hover:border-emerald-400/30"
          >
            <div className="mb-4 font-mono text-xs text-emerald-400">0{i + 1}</div>
            <h2 className="text-lg font-medium">{c.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">{c.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
