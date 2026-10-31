import { formatUSD, type Store } from "@/data/stores";
import { artLabel, DemoFooter, Hidden, workSans, youngSerif } from "./shared";
import { AddToCart } from "./reveal";

// Riso-print look: one cobalt ink on blush paper, cherry for the price stamp.
// Palette: blush #F3D9D3, cobalt #2338A8, cherry #C8312B, paper #FBF0EC

export default function BrewAndBean({ store }: { store: Store }) {
  const p = store.featured;
  const [notes, ...rest] = p.details;
  return (
    <div className={`${workSans.className} min-h-screen bg-[#F3D9D3] text-[#2338A8]`}>
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 pt-8 sm:px-8">
        <p className={`${youngSerif.className} text-2xl`}>{store.name}</p>
        <p className="hidden text-sm sm:block">{store.tagline}</p>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-10 sm:px-8">
        <p className="mt-2 text-sm sm:hidden">{store.tagline}</p>
        <section className="mt-10 grid items-center gap-10 md:grid-cols-2">
          <div
            role="img"
            aria-label={artLabel(store, "Cobalt coffee bag labelled Morning Ritual")}
            className="relative mx-auto aspect-square w-full max-w-md"
          >
            <svg viewBox="0 0 300 300" className="h-full w-full" aria-hidden>
              <circle cx="150" cy="150" r="140" fill="#FBF0EC" />
              <path d="M95 70 h110 l14 190 h-138 z" fill="#2338A8" />
              <path d="M95 70 h110 l-4 -18 h-102 z" fill="#1A2A85" />
              <rect x="112" y="128" width="76" height="86" fill="#FBF0EC" />
              <text x="150" y="160" textAnchor="middle" fontSize="15" fill="#2338A8" fontFamily="serif">Morning</text>
              <text x="150" y="180" textAnchor="middle" fontSize="15" fill="#2338A8" fontFamily="serif">Ritual</text>
              <line x1="124" y1="194" x2="176" y2="194" stroke="#2338A8" strokeWidth="1" />
              <text x="150" y="207" textAnchor="middle" fontSize="8" fill="#2338A8">12 oz, medium</text>
              {/* hand-stamped roast date */}
              <g transform="rotate(-16 232 92)">
                <circle cx="232" cy="92" r="34" fill="none" stroke="#C8312B" strokeWidth="2.5" />
                <circle cx="232" cy="92" r="27" fill="none" stroke="#C8312B" strokeWidth="1" />
                <text x="232" y="89" textAnchor="middle" fontSize="9" fill="#C8312B">Roasted</text>
                <text x="232" y="102" textAnchor="middle" fontSize="9" fill="#C8312B">Tuesday</text>
              </g>
            </svg>
          </div>

          <div>
            <h1 className={`${youngSerif.className} text-5xl leading-[1.05] sm:text-6xl`}>{p.name}</h1>
            <p className="mt-3 text-sm opacity-70">Product id: {p.id}</p>
            <p className="mt-6 inline-block -rotate-2 border-2 border-[#C8312B] px-3 py-1 text-3xl font-semibold text-[#C8312B]">
              {formatUSD(p.price)}
            </p>
            <p className="mt-6 max-w-prose leading-relaxed">{p.blurb}</p>
            <Hidden store={store} slot="description" />

            <p className="mt-6 text-sm">{notes.split(":")[0]}:</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {notes
                .split(":")[1]
                .split(",")
                .map((n) => (
                  <li key={n} className="rounded-full border border-[#2338A8] px-3 py-1 text-sm">
                    {n.trim()}
                  </li>
                ))}
            </ul>
            <ul className="mt-5 space-y-1 text-sm">
              {rest.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
            <Hidden store={store} slot="details" />

            <AddToCart className="mt-8 w-full rounded-full bg-[#2338A8] px-6 py-4 font-semibold text-[#FBF0EC] outline-offset-4 transition-colors hover:bg-[#1A2A85] focus-visible:outline-2 focus-visible:outline-[#2338A8] sm:w-auto" />
            <p className="mt-3 text-sm opacity-80">{store.shippingNote}</p>
          </div>
        </section>

        <p className={`${youngSerif.className} mx-auto mt-20 max-w-2xl text-center text-2xl leading-snug`}>{store.intro}</p>

        <section className="mt-16 border-t border-[#2338A8]/30 pt-8">
          <h2 className={`${youngSerif.className} text-2xl`}>More from the shop</h2>
          <ul className="mt-4 divide-y divide-[#2338A8]/25">
            {store.more.map((m) => (
              <li key={m.id} className="flex items-baseline justify-between gap-4 py-4">
                <p>
                  <span className="font-semibold">{m.name}</span>
                  <span className="opacity-75"> — {m.blurb}</span>
                  <span className="ml-2 text-xs opacity-50">({m.id})</span>
                </p>
                <p className="font-semibold">{formatUSD(m.price)}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <DemoFooter />
    </div>
  );
}
