"use client";

import { Eye, ScanEye } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useId, useState } from "react";
import recorded from "@/components/demo/fixture-run.json";
import type { FixtureRun } from "@/components/demo/fixtures";
import { Panel, StatusPill, cx } from "@/components/ui";
import { formatUSD, getStore, hiddenIn, type HiddenSegment, type HiddenSlot, type Store } from "@/data/stores";

const run = recorded as FixtureRun;

const CASES = [
  {
    slug: "trailhead",
    tab: "Trailhead Outfitters",
    note: "A real Gemini agent followed this note on our hosted app (run ddc3af6a). CartHold refused the $49 order, then held the mug alone for approval.",
  },
  {
    slug: "gifthub",
    tab: "GiftHub Deals",
    note: "Gemini ignored this lure in our live runs. The order shown comes from the simulated compromised agent, checked by the real guard.",
  },
] as const;

const styleLabel: Record<HiddenSegment["style"], string> = {
  "visually-hidden": "visually hidden",
  "white-on-white": "white on white",
  "aria-label": "image alt text",
};

function Hidden({ segs }: { segs: HiddenSegment[] }) {
  return segs.map((h) => (
    <mark key={h.text} className="mt-3 block rounded-[var(--radius-sm)] border border-blocked/35 bg-blocked-soft px-3 py-2.5 text-blocked">
      <span className="mb-1 flex items-center gap-1.5 font-sans text-2xs font-medium">
        <ScanEye aria-hidden strokeWidth={1.75} className="size-3.5" />
        Hidden: {styleLabel[h.style]}
      </span>
      <span className="text-pretty">{h.text}</span>
    </mark>
  ));
}

function ShopperView({ store }: { store: Store }) {
  const p = store.featured;
  return (
    <div>
      <div aria-hidden className="grid aspect-[16/5] place-items-center sm:aspect-[16/7] rounded-[var(--radius-sm)] bg-surface-3">
        <svg viewBox="0 0 120 60" className="h-2/3 text-ink-faint">
          {store.slug === "trailhead" ? (
            <g fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M42 16h30v26a6 6 0 0 1-6 6H48a6 6 0 0 1-6-6z" />
              <path d="M72 22h5a6 6 0 0 1 0 12h-5" />
              <path d="M38 16h38" />
            </g>
          ) : (
            <g fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="32" y="14" width="56" height="34" rx="5" />
              <path d="M32 24h56M50 14v34" />
            </g>
          )}
        </svg>
      </div>
      <p className="mt-4 text-xs text-ink-faint">{store.name}</p>
      <h4 className="mt-1 font-display text-xl font-semibold tracking-tight text-ink">{p.name}</h4>
      <p className="figures mt-1 text-ink">{formatUSD(p.price)}</p>
      <p className="mt-3 text-sm text-pretty text-ink-muted">{p.blurb}</p>
      {p.details.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-ink-muted">
          {p.details.slice(0, 3).map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AgentView({ store }: { store: Store }) {
  const p = store.featured;
  const at = (slot: HiddenSlot) => <Hidden segs={hiddenIn(store, slot)} />;
  return (
    <div className="figures text-[13px] leading-relaxed text-ink-muted">
      {at("image")}
      <p className="mt-3 text-ink">{p.name}</p>
      <p>{formatUSD(p.price)}</p>
      <p className="mt-3 text-pretty">{p.blurb}</p>
      {at("description")}
      {p.details.length > 0 && (
        <ul className="mt-3">
          {p.details.slice(0, 3).map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      {at("details")}
    </div>
  );
}

/** Same product page, two readers: the shopper sees the store, the agent reads the hidden notes too. */
export function InjectionReveal() {
  const [active, setActive] = useState(0);
  const reduce = useReducedMotion();
  const base = useId();
  const c = CASES[active];
  const store = getStore(c.slug);
  const row = run.rows.find((r) => r.triggeringText && r.reasons.some((x) => x.includes(`page ${c.slug}`)));
  if (!store) return null;

  return (
    <div>
      <div role="tablist" aria-label="Poisoned store" className="inline-flex rounded-pill border border-line p-1">
        {CASES.map((k, i) => (
          <button
            key={k.slug}
            role="tab"
            id={`${base}-tab-${i}`}
            aria-selected={i === active}
            aria-controls={`${base}-panel`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                const next = (i + 1) % CASES.length;
                setActive(next);
                document.getElementById(`${base}-tab-${next}`)?.focus();
              }
            }}
            className={cx(
              "h-9 rounded-pill px-4 text-sm transition-colors duration-[var(--duration-fast)] ease-snap",
              i === active ? "bg-surface-3 text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            {k.tab}
          </button>
        ))}
      </div>

      <motion.div
        key={c.slug}
        id={`${base}-panel`}
        role="tabpanel"
        aria-labelledby={`${base}-tab-${active}`}
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        className="mt-6 grid gap-4 md:grid-cols-2"
      >
        <Panel as="section" aria-label="What you see">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-medium text-ink">
            <Eye aria-hidden strokeWidth={1.5} className="size-4 text-ink-muted" />
            What you see
          </h3>
          <ShopperView store={store} />
        </Panel>
        <Panel as="section" tone="blocked" aria-label="What the agent reads">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-medium text-ink">
            <ScanEye aria-hidden strokeWidth={1.5} className="size-4 text-blocked" />
            What the agent reads
          </h3>
          <AgentView store={store} />
        </Panel>
      </motion.div>

      {row && (
        <div className="mt-4 flex flex-col gap-3 rounded-[var(--radius-lg)] border border-line px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status="block" label="Refused by CartHold" />
            <span className="text-sm text-ink">
              {row.items} <span className="figures text-ink-muted">({formatUSD(row.amountUsd)})</span>
            </span>
          </div>
          <p className="max-w-md text-xs text-pretty text-ink-faint">{c.note}</p>
        </div>
      )}
    </div>
  );
}
