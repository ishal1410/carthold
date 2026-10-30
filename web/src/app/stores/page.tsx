import Link from "next/link";
import { DEMO_FOOTER, formatUSD, stores } from "@/data/stores";

export default function StoresIndex() {
  return (
    // Own dark background: the body follows the OS colour scheme and was white in light mode.
    <div className="flex-1 bg-zinc-950">
    <main className="mx-auto w-full max-w-3xl px-4 py-16 text-zinc-100">
      <h1 className="text-3xl font-semibold tracking-tight">Demo stores</h1>
      <p className="mt-2 text-zinc-400">The four merchants the shopping agent can browse.</p>
      <ul className="mt-8 divide-y divide-zinc-800 border-y border-zinc-800">
        {stores.map((s) => (
          <li key={s.slug}>
            <Link href={`/stores/${s.slug}`} className="flex items-baseline justify-between gap-4 py-4 hover:text-white focus-visible:outline-2 focus-visible:outline-emerald-400">
              <span>
                <span className="font-medium">{s.name}</span>
                <span className="block text-sm text-zinc-500">
                  {s.featured.name}
                  {/\$\d/.test(s.featured.name) ? "" : `, ${formatUSD(s.featured.price)}`}
                  {s.hidden.length > 0 && " · contains hidden prompt injection"}
                  {!s.defaultAllowlisted && " · not on default allowlist"}
                </span>
              </span>
              <span className="shrink-0 text-sm text-zinc-500 max-sm:hidden">/stores/{s.slug}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-10 text-xs text-zinc-600">{DEMO_FOOTER}</p>
    </main>
    </div>
  );
}
