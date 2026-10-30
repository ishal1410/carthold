import { formatUSD, type Store } from "@/data/stores";
import { artLabel, barlow, barlowCondensed, DemoFooter, Hidden } from "./shared";

// Palette: pine #1E3A2B, lichen #E4E9DA, moss #8FA77A, blaze #E8B931, bark #2E2620
const contours = Array.from({ length: 9 }, (_, i) => i);

export default function Trailhead({ store }: { store: Store }) {
  const p = store.featured;
  return (
    <div className={`${barlow.className} min-h-screen bg-[#E4E9DA] text-[#2E2620]`}>
      <header className="bg-[#1E3A2B] text-[#E4E9DA]">
        <div className="mx-auto flex max-w-6xl items-end justify-between gap-4 px-4 py-5 sm:px-8">
          <div>
            <p className={`${barlowCondensed.className} text-3xl font-bold leading-none tracking-tight sm:text-4xl`}>
              {store.name}
            </p>
            <p className="mt-1 text-sm text-[#8FA77A]">{store.tagline}</p>
          </div>
          <nav className="hidden gap-6 text-sm sm:flex" aria-label="Shop sections">
            <span>Camp kitchen</span>
            <span>Lighting</span>
            <span>Layers</span>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-8 sm:py-14">
        <p className="max-w-xl text-[#2E2620]/75">{store.intro}</p>

        <section className="mt-8 grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
          <div
            role="img"
            aria-label={artLabel(store, "Pine green speckled enamel camp mug")}
            className="relative aspect-[4/3.4] self-start overflow-hidden rounded-sm bg-[#1E3A2B]"
          >
            {/* topo map contours: the shop's signature */}
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 340" preserveAspectRatio="xMidYMid slice" aria-hidden>
              {contours.map((i) => (
                <ellipse
                  key={i}
                  cx={250 - i * 6}
                  cy={150 + i * 4}
                  rx={40 + i * 28}
                  ry={26 + i * 19}
                  transform={`rotate(${-14 + i * 2} 250 150)`}
                  fill="none"
                  stroke="#8FA77A"
                  strokeOpacity={0.35 - i * 0.025}
                  strokeWidth={i % 3 === 0 ? 1.6 : 0.8}
                />
              ))}
            </svg>
            <svg className="absolute inset-0 m-auto h-[70%] w-[70%]" viewBox="0 0 200 180" aria-hidden>
              <ellipse cx="92" cy="166" rx="66" ry="8" fill="#000" opacity="0.25" />
              <path d="M146 62 h14 a22 22 0 0 1 0 64 h-14" fill="none" stroke="#2E5641" strokeWidth="12" />
              <path d="M146 62 h14 a22 22 0 0 1 0 64 h-14" fill="none" stroke="#C9CFC2" strokeWidth="3" transform="translate(0 -1)" />
              <path d="M30 40 h124 l-6 116 a10 10 0 0 1 -10 9 h-92 a10 10 0 0 1 -10 -9 z" fill="#2E5641" />
              {[
                [50, 70], [80, 96], [118, 74], [64, 128], [104, 140], [132, 112], [92, 60], [46, 104],
              ].map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={i % 2 ? 1.6 : 2.4} fill="#E4E9DA" opacity="0.8" />
              ))}
              <ellipse cx="92" cy="40" rx="62" ry="9" fill="#C9CFC2" />
              <ellipse cx="92" cy="41" rx="55" ry="6" fill="#1E3A2B" />
            </svg>
            {/* trail blaze marker */}
            <span className="absolute left-5 top-5 h-9 w-4 rounded-[2px] bg-[#E8B931]" aria-hidden />
          </div>

          <div className="flex flex-col">
            <h1 className={`${barlowCondensed.className} text-5xl font-bold leading-[0.95] tracking-tight text-[#1E3A2B] sm:text-6xl`}>
              {p.name}
            </h1>
            <p className="mt-2 text-sm text-[#2E2620]/60">Product id: {p.id}</p>
            <p className={`${barlowCondensed.className} mt-5 text-4xl font-medium`}>{formatUSD(p.price)}</p>
            <p className="mt-5 max-w-prose leading-relaxed">{p.blurb}</p>
            <Hidden store={store} slot="description" />

            <dl className="mt-7 border-t border-[#1E3A2B]/20">
              {p.details.map((d) => {
                const [k, v] = d.includes(":") ? d.split(/:\s*/) : [d, ""];
                return (
                  <div key={d} className="flex justify-between gap-4 border-b border-[#1E3A2B]/20 py-2.5 text-sm">
                    <dt className="text-[#2E2620]/70">{v ? `${k}:` : k}</dt>
                    {v && <dd className="font-semibold">{v}</dd>}
                  </div>
                );
              })}
            </dl>
            <Hidden store={store} slot="details" />

            <button
              type="button"
              className="mt-8 rounded-sm bg-[#1E3A2B] px-6 py-4 text-lg font-semibold text-[#E4E9DA] outline-offset-4 transition-colors hover:bg-[#2E5641] focus-visible:outline-2 focus-visible:outline-[#1E3A2B]"
            >
              Add to cart
            </button>
            <p className="mt-3 text-sm text-[#2E2620]/70">{store.shippingNote}</p>
          </div>
        </section>

        <section className="mt-16">
          <h2 className={`${barlowCondensed.className} text-2xl font-bold text-[#1E3A2B]`}>More from the shop</h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {store.more.map((m) => (
              <li key={m.id} className="flex items-baseline justify-between gap-4 border-l-4 border-[#E8B931] bg-white/50 px-5 py-4">
                <div>
                  <p className="font-semibold">{m.name}</p>
                  <p className="text-sm text-[#2E2620]/65">
                    {m.blurb} <span className="text-[#2E2620]/45">({m.id})</span>
                  </p>
                </div>
                <p className={`${barlowCondensed.className} text-2xl font-medium`}>{formatUSD(m.price)}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <DemoFooter className="border-t border-[#1E3A2B]/15" />
    </div>
  );
}
