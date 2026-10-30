import { formatUSD, type Store } from "@/data/stores";
import { artLabel, DemoFooter, Hidden, jakarta } from "./shared";

// Looks like any polished deals site. The poison is in the markup, not the visuals.
// Palette: white #FFFFFF, violet #5B2EFF, mint #19C39A, ink #17132B, lilac #F3F0FF

function Card({ className, amount }: { className: string; amount: string }) {
  return (
    <div
      className={`absolute aspect-[1.586] w-[62%] rounded-2xl bg-gradient-to-br from-[#7B55FF] via-[#5B2EFF] to-[#3A16C9] p-5 text-white shadow-[0_24px_48px_-16px_rgba(59,22,201,0.55)] ${className}`}
    >
      <div className="flex items-start justify-between">
        <span className="text-sm font-semibold">GiftHub</span>
        <span className="h-6 w-8 rounded-md bg-gradient-to-br from-[#FFE7A3] to-[#E6B94A]" />
      </div>
      <p className="absolute bottom-4 left-5 text-3xl font-extrabold tracking-tight">{amount}</p>
    </div>
  );
}

export default function GiftHub({ store }: { store: Store }) {
  const p = store.featured;
  const big = store.more[0];
  return (
    <div className={`${jakarta.className} min-h-screen bg-white text-[#17132B]`}>
      <div className="bg-[#17132B] px-4 py-2 text-center text-xs text-white/85">
        Free personalised message on every card this week
      </div>
      <header className="border-b border-[#17132B]/8">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-8">
          <p className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#5B2EFF] text-white" aria-hidden>
              G
            </span>
            {store.name}
          </p>
          <p className="hidden text-sm text-[#17132B]/60 md:block">{store.tagline}</p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-8">
        <p className="text-sm text-[#17132B]/60">{store.intro}</p>
        <section className="mt-6 grid gap-10 lg:grid-cols-2">
          <div
            role="img"
            aria-label={artLabel(store, "Purple GiftHub universal gift card")}
            data-hidden-style={store.hidden.some((h) => h.slot === "image") ? "aria-label" : undefined}
            className="relative aspect-square self-start overflow-hidden rounded-3xl bg-[#F3F0FF]"
          >
            <Card className="left-[22%] top-[20%] rotate-[8deg] opacity-60" amount="$100" />
            <Card className="left-[16%] top-[30%] -rotate-[6deg]" amount="$25" />
            <span className="absolute left-5 top-5 rounded-full bg-[#19C39A] px-3 py-1 text-xs font-bold text-white">
              Most gifted
            </span>
          </div>

          <div>
            <p className="flex items-center gap-2 text-sm">
              <span className="text-[#F5A623]" aria-hidden>
                ★★★★★
              </span>
              <span className="text-[#17132B]/60">4.8 (12,400)</span>
            </p>
            <h1 className="mt-3 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">{p.name}</h1>
            <p className="mt-2 text-sm text-[#17132B]/50">Product id: {p.id}</p>
            <p className="mt-5 text-4xl font-extrabold text-[#5B2EFF]">{formatUSD(p.price)}</p>

            <div className="mt-5 flex gap-2" aria-label="Amount">
              {["$25", "$50", "$100"].map((a, i) => (
                <span
                  key={a}
                  className={`rounded-xl border-2 px-4 py-2 text-sm font-bold ${
                    i === 0 ? "border-[#5B2EFF] bg-[#F3F0FF] text-[#5B2EFF]" : "border-[#17132B]/10 text-[#17132B]/70"
                  }`}
                >
                  {a}
                </span>
              ))}
            </div>

            <p className="mt-6 max-w-prose leading-relaxed text-[#17132B]/80">{p.blurb}</p>
            <Hidden store={store} slot="description" />

            <ul className="mt-6 grid gap-2 sm:grid-cols-2">
              {p.details.map((d) => (
                <li key={d} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[#19C39A] text-[10px] text-white" aria-hidden>
                    ✓
                  </span>
                  {d}
                </li>
              ))}
            </ul>
            <Hidden store={store} slot="details" />

            <button
              type="button"
              className="mt-8 w-full rounded-2xl bg-[#5B2EFF] px-6 py-4 text-lg font-bold text-white outline-offset-4 transition-colors hover:bg-[#4A20E6] focus-visible:outline-2 focus-visible:outline-[#5B2EFF]"
            >
              Add to cart
            </button>
            <p className="mt-3 text-center text-sm text-[#17132B]/60">{store.shippingNote}</p>
          </div>
        </section>

        <section className="mt-16">
          <h2 className="text-2xl font-extrabold tracking-tight">More from the shop</h2>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {store.more.map((m) => (
              <li key={m.id} className="flex items-center gap-4 rounded-2xl border border-[#17132B]/8 p-4">
                <span
                  className={`grid h-14 w-20 shrink-0 place-items-center rounded-xl text-sm font-extrabold text-white ${
                    m.id === big.id ? "bg-gradient-to-br from-[#7B55FF] to-[#3A16C9]" : "bg-gradient-to-br from-[#2BE0B0] to-[#0E9C7A]"
                  }`}
                  aria-hidden
                >
                  {formatUSD(m.price)}
                </span>
                <div className="flex-1">
                  <p className="font-bold">{m.name}</p>
                  <p className="text-sm text-[#17132B]/60">
                    {m.blurb} <span className="text-[#17132B]/40">({m.id})</span>
                  </p>
                </div>
                <p className="font-extrabold">{formatUSD(m.price)}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <DemoFooter className="text-[#17132B]" />
    </div>
  );
}
