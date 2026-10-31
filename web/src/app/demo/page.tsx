import type { Metadata } from "next";
import { Suspense } from "react";
import DemoApp from "@/components/demo/DemoApp";

export const metadata: Metadata = { title: "Live demo | CartHold" };

// DemoApp reads ?fixture=1 via useSearchParams, so it renders below a Suspense boundary.
export default function DemoPage() {
  return (
    <Suspense fallback={<DemoShell />}>
      <DemoApp />
    </Suspense>
  );
}

// Static first paint (QA-12): the page frame renders from HTML instead of a blank screen while DemoApp hydrates.
function DemoShell() {
  const bar = "animate-shimmer rounded-md bg-surface-2";
  return (
    <div className="flex flex-1 flex-col bg-canvas text-ink" aria-busy="true">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3.5 md:px-6">
          <span className="font-display text-lg font-semibold tracking-tight">CartHold</span>
          <span className="text-sm text-ink-faint">Loading demo</span>
        </div>
      </header>
      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-12 px-4 py-12 md:px-6 lg:grid-cols-12 lg:py-20">
        <div className="space-y-4 lg:col-span-7">
          <div className={`${bar} h-14 w-3/4`} />
          <div className={`${bar} h-6 w-2/3`} />
          <div className={`${bar} mt-8 h-64`} />
        </div>
        <div className={`${bar} h-80 lg:col-span-5`} />
      </div>
    </div>
  );
}
