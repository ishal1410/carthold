import type { Metadata } from "next";
import Link from "next/link";
import { StatusPill, buttonClasses } from "@/components/ui";

export const metadata: Metadata = { title: "Page not found | CartHold" };

export default function NotFound() {
  return (
    <main className="relative flex flex-1 items-center overflow-hidden">
      <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 opacity-50" />
      <div className="relative mx-auto w-full max-w-6xl px-4 py-24 md:px-6 md:py-32">
        <StatusPill status="voided" label="404, nothing charged" />
        <h1 className="mt-6 max-w-2xl font-display text-3xl font-semibold tracking-tight text-balance text-ink md:text-4xl">
          There is no page at this address.
        </h1>
        <p className="mt-5 max-w-xl text-lg text-pretty text-ink-muted">
          The link may be old or mistyped. The demo and the four demo stores are a click away.
        </p>
        <div className="mt-9 flex flex-col gap-3 sm:flex-row">
          <Link href="/" className={buttonClasses({ size: "lg" })}>
            Go home
          </Link>
          <Link href="/demo" className={buttonClasses({ variant: "ghost", size: "lg" })}>
            Try the demo
          </Link>
          <Link href="/stores" className={buttonClasses({ variant: "ghost", size: "lg" })}>
            See the stores
          </Link>
        </div>
      </div>
    </main>
  );
}
