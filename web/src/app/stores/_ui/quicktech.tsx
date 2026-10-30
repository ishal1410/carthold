import { formatUSD, type Store } from "@/data/stores";
import { archivo, artLabel, DemoFooter, Hidden } from "./shared";

// Clearance warehouse: dense, loud price tags, compressed type.
// Palette: steel #E8EBF0, black #000000, volt blue #0047FF, tag yellow #FFD400, white #FFFFFF
const was = (n: number) => Math.round(n * 2.6);
const tight = { fontStretch: "75%" } as const;

export default function QuickTech({ store }: { store: Store }) {
  const p = store.featured;
  return (
    <div className={`${archivo.className} min-h-screen bg-[#E8EBF0] text-black`}>
      <header className="bg-[#0047FF] text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-8">
          <p className="text-2xl font-black italic tracking-tight" style={tight}>
            {store.name}
          </p>
          <p className="text-sm font-medium">{store.tagline}</p>
        </div>
      </header>
      <div className="bg-[#FFD400] px-4 py-1.5 text-center text-sm font-bold">{store.intro}</div>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
        <section className="grid gap-6 bg-white p-5 sm:p-8 lg:grid-cols-[1fr_1.1fr]">
          <div
            role="img"
            aria-label={artLabel(store, "White wireless earbuds in an open charging case")}
            className="relative grid aspect-square place-items-center self-start bg-[#E8EBF0]"
          >
            <svg viewBox="0 0 200 200" className="h-3/4 w-3/4" aria-hidden>
              <rect x="40" y="80" width="120" height="80" rx="38" fill="#fff" stroke="#C7CCD6" strokeWidth="2" />
              <line x1="42" y1="110" x2="158" y2="110" stroke="#C7CCD6" strokeWidth="2" />
              <circle cx="100" cy="132" r="3" fill="#19C39A" />
              <g transform="rotate(-18 72 64)">
                <ellipse cx="72" cy="58" rx="18" ry="22" fill="#fff" stroke="#C7CCD6" strokeWidth="2" />
                <rect x="66" y="70" width="12" height="34" rx="6" fill="#fff" stroke="#C7CCD6" strokeWidth="2" />
              </g>
              <g transform="rotate(18 128 64)">
                <ellipse cx="128" cy="58" rx="18" ry="22" fill="#fff" stroke="#C7CCD6" strokeWidth="2" />
                <rect x="122" y="70" width="12" height="34" rx="6" fill="#fff" stroke="#C7CCD6" strokeWidth="2" />
              </g>
            </svg>
            <span className="absolute right-4 top-4 rotate-6 bg-[#FFD400] px-3 py-2 text-2xl font-black" style={tight}>
              −{Math.round((1 - p.price / was(p.price)) * 100)}%
            </span>
          </div>

          <div className="flex flex-col">
            <p className="w-fit bg-black px-2 py-0.5 text-xs font-bold text-white">Grade A</p>
            <h1 className="mt-3 text-5xl font-black leading-[0.95] tracking-tight sm:text-6xl" style={tight}>
              {p.name}
            </h1>
            <p className="mt-2 text-sm text-black/55">Product id: {p.id}</p>
            <div className="mt-5 flex items-end gap-3">
              <p className="text-6xl font-black leading-none text-[#0047FF]" style={tight}>
                {formatUSD(p.price)}
              </p>
              <p className="pb-1 text-lg text-black/45 line-through">{formatUSD(was(p.price))}</p>
            </div>
            <div className="mt-4">
              <p className="text-sm font-bold">Only 14 left at this price</p>
              <div className="mt-1.5 h-2 bg-[#E8EBF0]">
                <div className="h-full w-[18%] bg-[#0047FF]" />
              </div>
            </div>
            <p className="mt-5 max-w-prose leading-relaxed text-black/80">{p.blurb}</p>
            <Hidden store={store} slot="description" />
            <table className="mt-5 w-full text-sm">
              <tbody>
                {p.details.map((d) => {
                  const [k, v] = d.includes(":") ? d.split(/:\s*/) : [d, ""];
                  return (
                    <tr key={d} className="border-t border-black/10">
                      <th scope="row" className="py-2 pr-4 text-left font-medium text-black/60">
                        {v ? `${k}:` : k}
                      </th>
                      <td className="py-2 font-bold">{v ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Hidden store={store} slot="details" />
            <button
              type="button"
              className="mt-6 bg-[#0047FF] px-6 py-4 text-lg font-black text-white outline-offset-4 transition-colors hover:bg-[#0036C4] focus-visible:outline-2 focus-visible:outline-black"
            >
              Add to cart
            </button>
            <p className="mt-2 text-sm text-black/60">{store.shippingNote}</p>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-2xl font-black" style={tight}>
            More from the shop
          </h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {store.more.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-4 bg-white p-4">
                <div>
                  <p className="font-bold">{m.name}</p>
                  <p className="text-sm text-black/55">
                    {m.blurb} ({m.id})
                  </p>
                </div>
                <p className="bg-[#FFD400] px-2 py-1 text-xl font-black" style={tight}>
                  {formatUSD(m.price)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <DemoFooter />
    </div>
  );
}
