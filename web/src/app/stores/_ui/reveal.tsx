"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ScanEye, ShieldCheck } from "lucide-react";
import "./reveal.css";

/**
 * CartHold overlay on a demo store: toggles body[data-agent-view], and reveal.css paints every
 * [data-hidden-style] segment in place. Off by default so the shop looks like a real shop.
 */
export function RevealControl({ hiddenCount }: { hiddenCount: number }) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!on) return;
    document.body.dataset.agentView = "";
    const first = document.querySelector("[data-hidden-style]");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    first?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    return () => void delete document.body.dataset.agentView;
  }, [on]);

  return (
    <div data-carthold-overlay className="rv-dock fixed inset-x-3 bottom-3 z-50 flex justify-center sm:inset-x-auto sm:right-5 sm:bottom-5">
      <div className="flex w-full max-w-md items-center sm:max-w-none gap-2 rounded-pill border border-line-strong bg-canvas/95 p-1.5 font-sans text-ink shadow-[0_18px_48px_-12px_rgb(0_0_0/0.6)] backdrop-blur sm:w-auto">
        <Link
          href="/demo"
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-pill pl-2.5 pr-3 text-xs sm:pl-3 sm:pr-3.5 text-ink-muted hover:bg-surface-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hold"
        >
          <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden />
          <span className="sm:hidden">Demo</span>
          <span className="hidden sm:inline">Back to CartHold demo</span>
        </Link>
        <span className="h-6 w-px shrink-0 bg-line-strong" aria-hidden />
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => setOn((v) => !v)}
          className="flex min-h-10 flex-1 items-center gap-2 rounded-pill py-1 pl-2 pr-1.5 sm:gap-3 sm:pl-3 text-left hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hold sm:flex-none"
        >
          {on ? <ScanEye className="size-4 shrink-0 text-blocked" strokeWidth={1.5} aria-hidden /> : <ShieldCheck className="size-4 shrink-0 text-hold" strokeWidth={1.5} aria-hidden />}
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block whitespace-nowrap text-[13px] font-medium sm:text-sm">Reveal what the agent sees</span>
            <span className="block text-xs text-ink-faint" aria-live="polite">
              {hiddenCount === 0
                ? "Nothing hidden here"
                : on
                  ? `${hiddenCount} shown in red`
                  : `${hiddenCount} hidden ${hiddenCount === 1 ? "note" : "notes"} on this page`}
            </span>
          </span>
          <span className={`rv-track relative h-6 w-10 shrink-0 rounded-pill border ${on ? "border-blocked bg-blocked" : "border-line-strong bg-surface-3"}`} aria-hidden>
            <span className={`rv-thumb absolute top-0.5 size-[18px] rounded-pill bg-ink ${on ? "left-[18px]" : "left-0.5"}`} />
          </span>
        </button>
      </div>
    </div>
  );
}

/** "Add to cart" on a demo store: agents only read these pages, so a click says so instead of doing nothing. */
export function AddToCart({ className }: { className: string }) {
  const [said, setSaid] = useState(false);
  return (
    <>
      <button type="button" aria-describedby="demo-cart-note" onClick={() => setSaid(true)} className={className}>
        Add to cart
      </button>
      <p id="demo-cart-note" role="status" className="mt-2 min-h-5 text-sm font-medium">
        {said ? "Demo store: AI agents read this page during the CartHold demo. Nothing is sold here." : ""}
      </p>
    </>
  );
}
