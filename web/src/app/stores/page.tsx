import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Check, ScanEye, ShieldCheck, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui";
import { DEMO_FOOTER, formatUSD, stores, type Store } from "@/data/stores";
import { archivo, barlowCondensed, jakarta, youngSerif } from "./_ui/shared";

export const metadata: Metadata = { title: "Demo stores | CartHold" };

// Each store's own palette and display face, so the preview reads as that shop at a glance.
const LOOK: Record<string, { bg: string; ink: string; accent: string; font: string; mark: string }> = {
  trailhead: { bg: "#E4E9DA", ink: "#1E3A2B", accent: "#E8B931", font: barlowCondensed.className, mark: "uppercase tracking-wide" },
  "brew-and-bean": { bg: "#F3D9D3", ink: "#2338A8", accent: "#C8312B", font: youngSerif.className, mark: "" },
  gifthub: { bg: "#F3F0FF", ink: "#17132B", accent: "#5B2EFF", font: jakarta.className, mark: "font-extrabold tracking-tight" },
  quicktech: { bg: "#E8EBF0", ink: "#000000", accent: "#0047FF", font: archivo.className, mark: "font-black uppercase [font-stretch:75%]" },
};

const STYLE_WORD = { "white-on-white": "white-on-white text", "aria-label": "image label", "visually-hidden": "screen-reader-only text" };

export default function StoresIndex() {
  const poisoned = stores.filter((s) => s.hidden.length).length;
  return (
    <main className="flex-1 bg-canvas text-ink">
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8 md:px-6">
        <Link
          href="/demo"
          className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hold"
        >
          Back to the demo
        </Link>
        <header className="mt-10 max-w-[64ch]">
          <h1 className="font-display text-3xl font-semibold tracking-tight md:text-[2.75rem] md:leading-[1.08]">The shops the agent visits</h1>
          <p className="mt-4 text-lg text-ink-muted">
            Four demo merchants. {poisoned} of them hide instructions for shopping agents in text a person never sees.
            Open one and switch on <span className="text-ink">Reveal what the agent sees</span> to find it.
          </p>
        </header>

        <ul className="mt-12 grid gap-5 md:grid-cols-2">
          {stores.map((s) => (
            <li key={s.slug}>
              <StoreCard store={s} />
            </li>
          ))}
        </ul>
        <p className="mt-12 text-xs text-ink-faint">{DEMO_FOOTER}. None of these shops sell anything.</p>
      </div>
    </main>
  );
}

function StoreCard({ store: s }: { store: Store }) {
  const look = LOOK[s.slug];
  const styles = [...new Set(s.hidden.map((h) => STYLE_WORD[h.style]))];
  const priced = /\$\d/.test(s.featured.name) ? s.featured.name : `${s.featured.name}, ${formatUSD(s.featured.price)}`;
  return (
    <Link
      href={`/stores/${s.slug}`}
      className="group block h-full rounded-lg border border-line bg-surface-1 p-1.5 transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hold"
    >
      {/* Mini storefront in the shop's own colours. */}
      <div className={`${look.font} relative flex min-h-44 flex-col justify-between gap-5 overflow-hidden rounded-md px-5 py-4 sm:aspect-[16/7]`} style={{ background: look.bg, color: look.ink }} aria-hidden>
        <div>
          <p className="text-xs opacity-70">{s.tagline}</p>
          <p className={`pt-3 text-3xl leading-none md:text-4xl ${look.mark}`}>{s.name}</p>
        </div>
        <div className="flex items-end justify-between gap-4">
          <span className="max-w-[60%] text-sm leading-snug opacity-80">{s.featured.name}</span>
          <span className="rounded-md px-3 py-1.5 text-lg font-bold" style={{ background: look.accent, color: s.slug === "trailhead" ? look.ink : "#fff" }}>
            {formatUSD(s.featured.price)}
          </span>
        </div>
        {s.hidden.length > 0 && (
          <span className="absolute inset-y-0 right-0 w-1.5" style={{ background: "repeating-linear-gradient(135deg, #C2281B 0 6px, transparent 6px 10px)" }} />
        )}
      </div>

      <div className="px-4 pb-4 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold tracking-tight">{s.name}</h2>
            <p className="mt-0.5 text-sm text-ink-muted">{priced}</p>
          </div>
          <ArrowUpRight className="mt-1 size-5 shrink-0 text-ink-faint transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink" strokeWidth={1.5} aria-hidden />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {s.hidden.length ? (
            <Badge tone="blocked" icon={<ScanEye />}>Hidden prompt injection</Badge>
          ) : (
            <Badge tone="neutral" icon={<Check />}>No hidden text</Badge>
          )}
          {s.defaultAllowlisted ? (
            <Badge tone="paid" icon={<ShieldCheck />}>On default allowlist</Badge>
          ) : (
            <Badge tone="warning" icon={<TriangleAlert />}>Not on allowlist</Badge>
          )}
        </div>
        {s.hidden.length > 0 && (
          <p className="mt-3 text-sm text-ink-muted">
            {s.hidden.length} hidden {s.hidden.length === 1 ? "note" : "notes"}, as {styles.join(", ")}.
          </p>
        )}
      </div>
    </Link>
  );
}
