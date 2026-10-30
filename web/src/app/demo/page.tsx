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
  const panel = "rounded-2xl border border-white/10 bg-zinc-900/40";
  return (
    <div className="flex flex-1 flex-col bg-zinc-950 text-zinc-100" aria-busy="true">
      <header className="border-b border-white/10 px-4 py-4 sm:px-6">
        <span className="text-lg font-semibold tracking-tight">CartHold</span>
        <span className="ml-3 text-sm text-zinc-500">Loading demo</span>
      </header>
      <div className="mx-auto grid w-full max-w-[1600px] flex-1 gap-5 px-4 pb-10 pt-5 sm:px-6 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
        <div className={`${panel} min-h-[420px]`} />
        <div className={`${panel} min-h-[420px]`} />
        <div className={`${panel} min-h-[200px]`} />
      </div>
    </div>
  );
}
