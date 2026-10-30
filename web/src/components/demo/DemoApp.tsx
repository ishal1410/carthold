"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { stores } from "@/data/stores";
import type { AgentEvent } from "@/lib/agent/agent";
import type { DecisionRow, GuardState, RowStatus } from "@/lib/guard/guard";
import type { Mandate } from "@/lib/policy/policy";
import { DecisionGrid } from "@/components/grid";
import { FIXTURE_REQUEST, fixtureEvents, fixturePages, fixtureState } from "./fixtures";
import { markParts } from "./highlight";
import { hasInjection, headline, isInspector, isInspectorBlock, isWarning, orderReasons, refusedText, stripWarning } from "./reasons";
import "./demo.css";

type Mode = "live" | "redteam";
type StreamMsg = { kind: "agent"; event: AgentEvent } | { kind: "guard"; state: GuardState } | { kind: "end" };
type Phase = "idle" | "starting" | "running" | "done" | "error";

// Display copy of the server's DEFAULT_MANDATE (lib/run/session.ts, server-only so not importable here).
// The server ignores any client mandate; keep these two in sync.
const MANDATE: Omit<Mandate, "userRequest"> = {
  budgetUsd: 100,
  perItemCapUsd: 60,
  approvalThresholdUsd: 25,
  merchantAllowlist: ["Trailhead Outfitters", "Brew & Bean", "GiftHub Deals"],
  maxQuantity: 2,
};
const MAX_Q = 300; // same cap as the server's userRequest
const PRESETS = [
  "Buy me a camping coffee mug under $40",
  "Get a small gift card for my sister, under $40",
  "Cheap wireless earbuds under $50",
];
const EMPTY: GuardState = { rows: [], pendingHolds: [], amountAtRiskUsd: 0, committedUsd: 0, unknownRows: [] };
/** Nothing left that can change: no hold waiting on a human, no PayPal outcome still unresolved. */
const settled = (g: GuardState) => g.pendingHolds.length === 0 && (g.unknownRows ?? []).length === 0;

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const slugFor = (merchant: string) => stores.find((s) => s.name.toLowerCase() === merchant.toLowerCase())?.slug;

type Tone = { text: string; ring: string; bg: string; label: string };
// Keyed by string so statuses added server-side later still render (see toneFor).
const TONE: Record<string, Tone> = {
  pending: { text: "text-zinc-200", ring: "border-white/20", bg: "bg-white/[0.04]", label: "Authorizing with PayPal…" },
  unknown: { text: "text-orange-300", ring: "border-orange-400/50", bg: "bg-orange-400/10", label: "PayPal outcome unclear" },
  blocked: { text: "text-rose-300", ring: "border-rose-500/50", bg: "bg-rose-500/10", label: "Blocked" },
  held: { text: "text-amber-300", ring: "border-amber-400/50", bg: "bg-amber-400/10", label: "Held for you" },
  captured: { text: "text-emerald-300", ring: "border-emerald-400/40", bg: "bg-emerald-400/10", label: "Paid" },
  voided: { text: "text-zinc-300", ring: "border-white/15", bg: "bg-white/[0.03]", label: "Voided" },
  error: { text: "text-orange-300", ring: "border-orange-400/50", bg: "bg-orange-400/10", label: "PayPal error" },
};
const toneFor = (s: RowStatus | string): Tone => TONE[s] ?? { ...TONE.pending, label: String(s) };

function ReasonText({ r }: { r: string }) {
  if (isWarning(r))
    return (
      <span className="text-amber-200/90">
        <span className="font-medium text-amber-300">Warning (did not block): </span>
        {stripWarning(r).replace(/^inspector:?\s*/i, "")}
      </span>
    );
  return isInspector(r) ? (
    <>
      <span className={`font-medium ${isInspectorBlock(r) ? "text-rose-300" : "text-zinc-400"}`}>Inspector: </span>
      {r.replace(/^inspector:?\s*/i, "")}
    </>
  ) : (
    <>
      <span className="font-medium text-zinc-400">Policy: </span>
      {r.replace(/^policy:?\s*/i, "")}
    </>
  );
}

const dot = (r: string) => (isWarning(r) ? "bg-amber-400" : isInspectorBlock(r) ? "bg-rose-400" : "bg-zinc-400");

const RUN_ERRORS: Record<number, string> = {
  403: "The server refused this run (cross-site request).",
  413: "That request is too long.",
  415: "The server rejected the request format.",
  429: "Too many runs right now. Wait a minute and try again.",
};

/** Eases a displayed number toward `value` (respects reduced motion). */
function useTween(value: number, ms = 700) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = reduce ? 1 : Math.min(1, (now - t0) / ms);
      const v = start + (value - start) * (1 - Math.pow(1 - p, 3));
      from.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    const first = setTimeout(() => setNow(Date.now()), 0);
    return () => {
      clearInterval(id);
      clearTimeout(first);
    };
  }, [active]);
  return now;
}

export default function DemoApp() {
  const params = useSearchParams();
  const fixture = params.get("fixture") === "1";
  // ?run=<id>&mode=<mode> survives a refresh: we reconnect and the server replays the run (#14).
  const [initialRun] = useState(() => (fixture ? null : params.get("run")));
  const [initialMode] = useState<Mode>(() => (fixture || params.get("mode") === "redteam" ? "redteam" : "live"));
  // ?q= restores the run's request text after a refresh (FINDINGS-2 QA new 8).
  const [request, setRequest] = useState(() => (fixture ? FIXTURE_REQUEST : (params.get("q")?.slice(0, MAX_Q) ?? PRESETS[1])));
  const [mode, setMode] = useState<Mode>(initialMode);
  /** Mode of the run on screen (the radio can change after the run starts). */
  const [runMode, setRunMode] = useState<Mode>(initialMode);
  const [phase, setPhase] = useState<Phase>(fixture ? "done" : initialRun ? "running" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(fixture ? "fixture" : initialRun);
  const [events, setEvents] = useState<AgentEvent[]>(() => (fixture ? fixtureEvents() : []));
  const [guard, setGuard] = useState<GuardState>(() => (fixture ? fixtureState() : EMPTY));
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [reveal, setReveal] = useState<{ row: DecisionRow; text: string | null } | null>(null);
  const esRef = useRef<EventSource | null>(null);
  // Synchronous guards: a state-based `disabled` only lands after a re-render, so same-tick double clicks got through (#13, #17).
  const startingRef = useRef(false);
  const decidingRef = useRef(new Set<string>());

  /** Opens the run's SSE stream. Stays open after "end" so later hold decisions and auto-voids keep arriving. */
  const connect = useCallback((id: string) => {
    esRef.current?.close();
    const es = new EventSource(`/api/runs/${id}/stream`);
    esRef.current = es;
    let gotAny = false;
    let ended = false;
    let last: GuardState = EMPTY;
    // The server replays full history on (re)connect, so start clean each time.
    es.onopen = () => setEvents([]);
    es.onmessage = (m) => {
      gotAny = true;
      const msg = JSON.parse(m.data) as StreamMsg;
      if (msg.kind === "agent") setEvents((ev) => [...ev, msg.event]);
      else if (msg.kind === "guard") setGuard((last = msg.state));
      else {
        // "end" = the agent finished; holds may still be pending, so the stream stays open until they settle.
        ended = true;
        setPhase("done");
      }
    };
    es.onerror = () => {
      // The server closes the stream once the run is fully settled. That is the normal finish, not an error.
      if (ended && settled(last)) return es.close();
      if (es.readyState !== EventSource.CLOSED) return; // the browser retries on its own
      if (!gotAny) {
        // 404 (server restarted or evicted this run) or 429 (too many stream connections).
        window.history.replaceState(null, "", "/demo");
        setRunId(null);
        setPhase("idle");
        setError("Could not reopen that run: it is no longer on the server, or too many tabs are watching it. Wait a minute, then start a new run.");
      } else {
        setPhase((p) => (p === "running" ? "error" : p));
        setError("Lost the live stream. Refresh to reconnect, or run again.");
      }
    };
  }, []);

  useEffect(() => {
    if (initialRun) connect(initialRun);
    return () => esRef.current?.close();
  }, [initialRun, connect]);

  async function run() {
    if (startingRef.current) return;
    startingRef.current = true;
    esRef.current?.close();
    setError(null);
    setEvents([]);
    setGuard(EMPTY);
    setRunMode(mode);
    setPhase("starting");
    try {
      if (fixture) {
        setEvents(fixtureEvents());
        setGuard(fixtureState());
        setPhase("done");
        return;
      }
      // No mandate in the body: the server owns it and ignores client values.
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userRequest: request.trim(), mode }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const base = RUN_ERRORS[res.status] ?? `Run did not start (HTTP ${res.status}).`;
        throw new Error(body.error ? `${base} ${body.error}` : base);
      }
      const { runId: id } = (await res.json()) as { runId: string };
      setRunId(id);
      setPhase("running");
      const q = new URLSearchParams({ run: id, mode, q: request.trim().slice(0, MAX_Q) });
      window.history.replaceState(null, "", `/demo?${q}`);
      connect(id);
    } catch (e) {
      setPhase("error");
      setError((e as Error).message);
    } finally {
      startingRef.current = false;
    }
  }

  async function decide(row: DecisionRow, action: "approve" | "reject") {
    if (decidingRef.current.has(row.id)) return;
    decidingRef.current.add(row.id);
    setBusy((b) => ({ ...b, [row.id]: true }));
    try {
      if (fixture) {
        setGuard((g) => {
          const rows = g.rows.map((r) =>
            r.id !== row.id
              ? r
              : action === "approve"
                ? { ...r, status: "captured" as const, captureId: "9FX40112HD7731220", expiresAt: undefined, reasons: [...r.reasons, "approved by user"] }
                : { ...r, status: "voided" as const, expiresAt: undefined, reasons: [...r.reasons, "rejected by user"] },
          );
          return {
            ...g,
            rows,
            pendingHolds: g.pendingHolds.filter((id) => id !== row.id),
            amountAtRiskUsd: g.amountAtRiskUsd - row.amountUsd,
            committedUsd: action === "approve" ? g.committedUsd : g.committedUsd - row.amountUsd,
          };
        });
        return;
      }
      const res = await fetch(`/api/runs/${runId}/holds/${row.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      // 409 = hold already settled (auto-void, another tab, an earlier click). Not an error:
      // the open stream carries the real outcome.
      if (res.status === 409) return;
      if (res.status === 429) throw new Error("too many clicks right now. Wait a minute and try again.");
      const body = (await res.json().catch(() => ({}))) as { state?: GuardState; error?: string };
      if (!res.ok || !body.state) throw new Error(body.error ?? `HTTP ${res.status}`);
      setGuard(body.state);
    } catch (e) {
      setError(`${action === "approve" ? "Approve" : "Reject"} failed: ${(e as Error).message}`);
    } finally {
      decidingRef.current.delete(row.id);
      setBusy((b) => ({ ...b, [row.id]: false }));
    }
  }

  async function openReveal(row: DecisionRow) {
    if (row.status !== "blocked") return;
    setReveal({ row, text: null });
    const slug = slugFor(row.merchant);
    // The page is only shown when the order followed injected text; drift and policy blocks just list reasons.
    if (!slug || !hasInjection(row)) return;
    if (fixture) return setReveal({ row, text: fixturePages[slug] ?? "" });
    try {
      const res = await fetch(`/api/stores/${slug}/text`);
      const body = (await res.json()) as { text?: string };
      setReveal({ row, text: body.text ?? "" });
    } catch {
      setReveal({ row, text: "" });
    }
  }

  const running = phase === "starting" || phase === "running";

  return (
    <div className="relative flex min-h-full flex-1 flex-col overflow-x-clip bg-zinc-950 text-zinc-100">
      <div aria-hidden className="pointer-events-none absolute -top-48 left-1/3 h-[420px] w-[900px] rounded-full bg-emerald-500/10 blur-3xl" />
      <TopBar guard={guard} mode={runMode} running={running} />
      {fixture && (
        <p role="note" className="relative z-10 border-b border-amber-400/40 bg-amber-400/15 px-4 py-2 text-center text-sm font-semibold tracking-wide text-amber-100">
          FIXTURE DATA: not a real run. The rows are a recording of the real guard on sample orders; no agent, Gemini or PayPal calls happen on this page.
        </p>
      )}
      <main className="relative mx-auto grid w-full max-w-[1600px] flex-1 gap-5 px-4 pb-10 pt-5 grid-cols-[minmax(0,1fr)] sm:px-6 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
        <section aria-label="Mandate and request" className="flex flex-col gap-5">
          <MandateCard />
          <RequestCard
            request={request}
            setRequest={setRequest}
            mode={mode}
            setMode={setMode}
            running={running}
            onRun={run}
          />
          {error && (
            <p role="alert" className="rounded-xl border border-orange-400/40 bg-orange-400/10 px-4 py-3 text-sm text-orange-200">
              {error}
            </p>
          )}
        </section>
        {/* Below md the verdict (hold) cards come before the long trace (QA-13). */}
        <Trace events={events} phase={phase} mode={runMode} rows={guard.rows} />
        <VerdictStack guard={guard} busy={busy} simulated={runMode === "redteam"} onDecide={decide} onReveal={openReveal} />
        <section aria-labelledby="log-h" className="min-w-0 max-md:order-2 xl:col-span-3">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="log-h" className="text-base font-medium">
              Decision log
            </h2>
            <Link
              href="/demo/scorecard"
              className="rounded-md text-sm text-emerald-300 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
            >
              Injection scorecard
            </Link>
          </div>
          {guard.rows.length ? (
            <DecisionGrid rows={guard.rows} onSelect={openReveal} simulated={runMode === "redteam"} />
          ) : (
            <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-zinc-500">
              Every payment the agent attempts lands here, allowed or not.
            </p>
          )}
        </section>
      </main>
      <RevealDialog reveal={reveal} onClose={() => setReveal(null)} />
    </div>
  );
}

function TopBar({ guard, mode, running }: { guard: GuardState; mode: Mode; running: boolean }) {
  const atRisk = useTween(guard.amountAtRiskUsd);
  const stopped = guard.rows.filter((r) => r.status === "blocked").reduce((s, r) => s + r.amountUsd, 0);
  const stoppedShown = useTween(stopped);
  const captured = guard.committedUsd - guard.amountAtRiskUsd;
  const pct = (n: number) => `${Math.min(100, (n / MANDATE.budgetUsd) * 100)}%`;
  // autoPaidUsd: allow-path captures only (guard state may not ship it yet).
  const autoPaid = (guard as GuardState & { autoPaidUsd?: number }).autoPaidUsd;
  const limit = MANDATE.approvalThresholdUsd;
  return (
    <header className="relative z-10 border-b border-white/10 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 rounded-md text-lg font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-emerald-400">
            <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6l8-3z" />
              <path d="M8.5 12l2.5 2.5 4.5-5" />
            </svg>
            CartHold
          </Link>
          <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-2.5 py-0.5 text-xs font-medium text-sky-200">PayPal Sandbox</span>
          {mode === "redteam" && (
            <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-xs font-medium text-amber-200">
              Simulated compromised agent
            </span>
          )}
          {running && <span className="ag-pulse h-2 w-2 rounded-full bg-emerald-400" aria-label="Run in progress" />}
        </div>
        <dl className="ml-auto flex flex-wrap items-center gap-x-8 gap-y-2">
          <div>
            <dt className="text-xs text-zinc-400">Held, awaiting you</dt>
            <dd className="text-2xl font-semibold tabular-nums text-amber-300">{usd(atRisk)}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-400">Stopped by guard</dt>
            <dd className="text-2xl font-semibold tabular-nums text-rose-300">{usd(stoppedShown)}</dd>
          </div>
          <div className="min-w-48">
            <dt className="flex justify-between gap-3 text-xs text-zinc-400">
              <span>Committed this run</span>
              <span className="tabular-nums text-zinc-300">
                {usd(guard.committedUsd)} of {usd(MANDATE.budgetUsd)}
              </span>
            </dt>
            <dd
              className="mt-2 flex h-2 overflow-hidden rounded-full bg-white/10"
              role="meter"
              aria-label="Budget committed"
              aria-valuemin={0}
              aria-valuemax={MANDATE.budgetUsd}
              aria-valuenow={guard.committedUsd}
            >
              <span className="h-full bg-emerald-400 transition-[width] duration-700" style={{ width: pct(captured) }} />
              <span className="h-full bg-amber-400 transition-[width] duration-700" style={{ width: pct(guard.amountAtRiskUsd) }} />
            </dd>
          </div>
          {autoPaid != null && (
            <div className="min-w-36">
              <dt className="flex justify-between gap-3 text-xs text-zinc-400">
                <span>Auto-paid</span>
                <span className="tabular-nums text-zinc-300">
                  {usd(autoPaid)} of {usd(limit)}
                </span>
              </dt>
              <dd
                className="mt-2 flex h-2 overflow-hidden rounded-full bg-white/10"
                role="meter"
                aria-label={`Auto-paid ${usd(autoPaid)} of ${usd(limit)} without asking`}
                aria-valuemin={0}
                aria-valuemax={limit}
                aria-valuenow={autoPaid}
              >
                <span className="h-full bg-sky-400 transition-[width] duration-700" style={{ width: `${Math.min(100, (autoPaid / limit) * 100)}%` }} />
              </dd>
            </div>
          )}
        </dl>
      </div>
    </header>
  );
}

function MandateCard() {
  const rules: [string, string][] = [
    ["Budget", `${usd(MANDATE.budgetUsd)} per demo run`],
    ["Per item", `up to ${usd(MANDATE.perItemCapUsd)}`],
    ["Auto-pay limit", `${usd(MANDATE.approvalThresholdUsd)} per run`],
    ["Max quantity", String(MANDATE.maxQuantity)],
  ];
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-5">
      <h2 className="text-base font-medium">Your mandate</h2>
      <p className="mt-1 text-sm text-zinc-400">The guard checks every purchase the agent proposes against these rules. Limits reset with each demo run.</p>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        {rules.map(([k, v]) => (
          <div key={k} className="rounded-lg bg-white/[0.03] px-3 py-2">
            <dt className="text-xs text-zinc-400">{k}</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-zinc-400">Auto-pay up to {usd(MANDATE.approvalThresholdUsd)} per run without asking; anything beyond that waits for your approval.</p>
      <h3 className="mt-4 text-xs text-zinc-400">Allowed stores</h3>
      <ul className="mt-2 flex flex-wrap gap-2">
        {MANDATE.merchantAllowlist.map((m) => (
          <li key={m} className="rounded-full border border-emerald-400/25 bg-emerald-400/5 px-2.5 py-1 text-xs text-emerald-200">
            {m}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RequestCard(p: {
  request: string;
  setRequest: (s: string) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  running: boolean;
  onRun: () => void;
}) {
  const modes: { id: Mode; label: string; hint: string }[] = [
    { id: "live", label: "Live agent", hint: "Gemini shops for real against the sandbox." },
    { id: "redteam", label: "Simulated compromised agent", hint: "Scripted replay that obeys the poisoned page. Same real guard." },
  ];
  return (
    <form
      className="rounded-2xl border border-white/10 bg-zinc-900/60 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!p.running && p.request.trim()) p.onRun();
      }}
    >
      <label htmlFor="req" className="text-base font-medium">
        Ask the agent
      </label>
      <textarea
        id="req"
        rows={3}
        value={p.request}
        onChange={(e) => p.setRequest(e.target.value)}
        className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-400/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
        placeholder="What should the agent buy?"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {PRESETS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => p.setRequest(s)}
            aria-pressed={p.request === s}
            className="rounded-full border border-white/10 px-2.5 py-1 text-left text-xs text-zinc-300 hover:border-white/25 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-emerald-400 aria-pressed:border-emerald-400/40 aria-pressed:text-emerald-200"
          >
            {s}
          </button>
        ))}
      </div>
      <fieldset className="mt-5">
        <legend className="text-xs text-zinc-400">Agent</legend>
        <div className="mt-2 grid gap-2">
          {modes.map((m) => {
            const on = p.mode === m.id;
            const amber = m.id === "redteam";
            return (
              <label
                key={m.id}
                className={`flex cursor-pointer gap-3 rounded-xl border px-3 py-2.5 has-[:focus-visible]:ring-2 ${
                  amber ? "has-[:focus-visible]:ring-amber-400/60" : "has-[:focus-visible]:ring-emerald-400/50"
                } ${
                  on
                    ? amber
                      ? "border-amber-400/60 bg-amber-400/10"
                      : "border-emerald-400/50 bg-emerald-400/10"
                    : "border-white/10 hover:border-white/20"
                }`}
              >
                <input type="radio" name="mode" value={m.id} checked={on} onChange={() => p.setMode(m.id)} className="sr-only" />
                <span
                  aria-hidden
                  className={`mt-1 h-3 w-3 shrink-0 rounded-full border ${
                    on ? (amber ? "border-amber-300 bg-amber-400" : "border-emerald-300 bg-emerald-400") : "border-zinc-500"
                  }`}
                />
                <span>
                  <span className={`block text-sm font-medium ${amber ? "text-amber-200" : "text-zinc-100"}`}>{m.label}</span>
                  <span className="block text-xs text-zinc-400">{m.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <button
        type="submit"
        disabled={p.running || !p.request.trim()}
        className="mt-5 w-full rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {p.running ? "Agent is shopping" : "Run agent"}
      </button>
    </form>
  );
}

function summarizeArgs(name: string, args: Record<string, unknown>) {
  if (name === "read_store_page") return String(args.slug ?? "");
  if (name === "propose_order") {
    const items = Array.isArray(args.items) ? (args.items as { name?: string; quantity?: number; unitPriceUsd?: number }[]) : [];
    return `${args.merchant ?? "?"}: ${items.map((i) => `${i.quantity} x ${i.name} @ $${i.unitPriceUsd}`).join(", ")}`;
  }
  return "";
}

function resultTone(name: string, result: string) {
  if (name !== "propose_order") return "text-zinc-400";
  if (result.startsWith("REFUSED")) return "text-rose-300";
  if (result.startsWith("HELD")) return "text-amber-300";
  if (result.startsWith("Paid")) return "text-emerald-300";
  return "text-orange-300";
}

/** Hold outcomes that happened after the agent's last word, so its final text is never left stale. */
function holdUpdates(rows: DecisionRow[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.verdict !== "hold") continue;
    const what = `the ${usd(r.amountUsd)} hold at ${r.merchant}`;
    if (r.reasons.includes("rejected by user")) out.push(`Update: you rejected ${what}. Authorization voided, nothing was charged.`);
    else if (r.reasons.some((x) => /^auto-voided/.test(x))) out.push(`Update: ${what} timed out. Authorization voided, nothing was charged.`);
    else if (r.status === "captured") out.push(`Update: you approved ${what}. PayPal captured it${r.captureId ? ` (capture ${r.captureId})` : ""}.`);
    else if (r.status === "error" || r.status === "unknown")
      out.push(`Update: ${what} did not settle cleanly (${r.status === "unknown" ? "PayPal outcome unclear" : "PayPal error"}). Check the decision log.`);
  }
  return out;
}

function Trace({ events, phase, mode, rows }: { events: AgentEvent[]; phase: Phase; mode: Mode; rows: DecisionRow[] }) {
  // Events render in arrival order, grouped under the step they belong to.
  const steps = useMemo(() => {
    const out: { step: number; items: AgentEvent[] }[] = [];
    for (const e of events) {
      if (e.type === "step") out.push({ step: e.step, items: [] });
      else if (e.type !== "done") (out.at(-1) ?? (out[0] = { step: 0, items: [] })).items.push(e);
    }
    return out;
  }, [events]);
  const done = events.find((e) => e.type === "done") as Extract<AgentEvent, { type: "done" }> | undefined;
  const updates = done ? holdUpdates(rows) : [];
  const last = events.at(-1);
  const announce =
    !last ? "" : last.type === "tool_call" ? `Agent calls ${last.name}` : last.type === "tool_result" && last.name === "propose_order" ? refusedText(last.result, rows) : last.type === "done" ? "Agent finished" : "";

  // Keep the newest event in view if the list ever scrolls, unless the reader scrolled up.
  const listRef = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [events.length, updates.length]);

  return (
    <section aria-labelledby="trace-h" className="flex min-h-[420px] flex-col max-md:order-1 rounded-2xl border border-white/10 bg-zinc-900/40">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
        <h2 id="trace-h" className="text-base font-medium">
          Agent trace
        </h2>
        <span className={`text-xs ${mode === "redteam" ? "text-amber-300" : "text-zinc-400"}`}>
          {mode === "redteam" ? "Simulated compromised agent" : "Live Gemini agent"}
        </span>
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      {!events.length ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-zinc-500">
          {phase === "starting" || phase === "running" ? (
            <span className="ag-pulse">Starting the agent</span>
          ) : (
            "Pick a request and run the agent. Each step it takes shows up here."
          )}
        </div>
      ) : (
        <ol
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="flex-1 space-y-4 overflow-y-auto px-5 py-4"
        >
          {steps.filter((s) => s.items.length || !done).map((s) => (
            <li key={s.step} className="ag-enter grid grid-cols-[2rem_1fr] gap-3">
              <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border border-white/15 text-xs tabular-nums text-zinc-400">
                {s.step}
              </span>
              <div className="min-w-0 space-y-2 break-words">
                {s.items.length === 0 && !done && <p className="ag-pulse text-sm text-zinc-500">Thinking</p>}
                {s.items.map((e, i) => {
                  if (e.type === "model_text")
                    return (
                      <p key={i} className="ag-enter whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                        {e.text}
                      </p>
                    );
                  if (e.type === "tool_call") {
                    const waiting = !done && e.name === "propose_order" && !s.items.slice(i + 1).some((x) => x.type === "tool_result");
                    return (
                      <div key={i} className="ag-enter rounded-lg border border-white/10 bg-zinc-950/60 px-3 py-2 [overflow-wrap:anywhere]">
                        <span className="font-mono text-xs text-sky-300">{e.name}</span>
                        <span className="ml-2 text-sm text-zinc-300">{summarizeArgs(e.name, e.args)}</span>
                        {waiting && <span className="ag-pulse mt-1 block text-xs text-zinc-400">CartHold is checking this purchase</span>}
                      </div>
                    );
                  }
                  if (e.type === "tool_result") {
                    return e.name === "propose_order" ? (
                      <p key={i} className={`ag-enter whitespace-pre-wrap text-sm font-medium leading-relaxed [overflow-wrap:anywhere] ${resultTone(e.name, e.result)}`}>
                        {refusedText(e.result, rows)}
                      </p>
                    ) : (
                      <details key={i} className="ag-enter group text-sm">
                        <summary className="cursor-pointer rounded text-xs text-zinc-400 hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-emerald-400">
                          Result from {e.name} ({e.result.length.toLocaleString()} chars)
                        </summary>
                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-950/70 p-3 font-mono text-xs text-zinc-400">
                          {e.result}
                        </pre>
                      </details>
                    );
                  }
                  return null;
                })}
              </div>
            </li>
          ))}
          {done && (
            <li className="ag-enter grid grid-cols-[2rem_1fr] gap-3">
              <span aria-hidden className="mt-1.5 ml-2 h-2 w-2 rounded-full bg-zinc-500" />
              <div className="min-w-0 space-y-2 break-words">
                <p className={`whitespace-pre-wrap text-sm ${done.reason === "error" ? "text-orange-300" : "text-zinc-400"}`}>
                  {done.reason === "error" ? `Agent stopped: ${done.error}` : done.reason === "max_steps" ? "Agent hit its step limit." : done.text || "Agent finished."}
                </p>
                {updates.map((u) => (
                  <p key={u} className="ag-enter rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-200">
                    {u}
                  </p>
                ))}
              </div>
            </li>
          )}
        </ol>
      )}
    </section>
  );
}

function VerdictStack(p: {
  guard: GuardState;
  busy: Record<string, boolean>;
  simulated: boolean;
  onDecide: (row: DecisionRow, a: "approve" | "reject") => void;
  onReveal: (row: DecisionRow) => void;
}) {
  const rows = [...p.guard.rows].reverse().sort((a, b) => Number(b.status === "held") - Number(a.status === "held"));
  const now = useNow(p.guard.pendingHolds.length > 0);
  return (
    <section aria-labelledby="verdict-h" className="flex flex-col gap-3">
      <h2 id="verdict-h" className="text-base font-medium">
        Guard verdicts
      </h2>
      {!rows.length && (
        <p className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-zinc-500">
          No payment attempts yet. When the agent tries to pay, the guard&apos;s decision appears here.
        </p>
      )}
      <ul className="flex flex-col gap-3" aria-live="polite">
        {rows.map((r) => (
          <li key={r.id}>
            <VerdictCard row={r} now={now} busy={!!p.busy[r.id]} simulated={p.simulated} onDecide={p.onDecide} onReveal={p.onReveal} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function VerdictCard({ row, now, busy, simulated, onDecide, onReveal }: {
  row: DecisionRow;
  now: number;
  busy: boolean;
  simulated: boolean;
  onDecide: (row: DecisionRow, a: "approve" | "reject") => void;
  onReveal: (row: DecisionRow) => void;
}) {
  const tone = toneFor(row.status);
  const head = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <span className={`text-xs font-semibold ${tone.text}`}>{tone.label}</span>
          {simulated && (
            <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-px text-[11px] font-medium text-amber-200">Simulated</span>
          )}
        </p>
        <p className="mt-1 truncate text-sm font-medium text-zinc-100">{row.merchant}</p>
        <p className="truncate text-xs text-zinc-400">{row.items}</p>
      </div>
      <p className={`shrink-0 text-lg font-semibold tabular-nums ${row.status === "blocked" ? "text-rose-200 line-through decoration-rose-400/70" : "text-zinc-100"}`}>
        {usd(row.amountUsd)}
      </p>
    </div>
  );
  const box = `rounded-2xl border ${tone.ring} ${tone.bg} p-4`;

  if (row.status === "pending") {
    return (
      <div className={`ag-enter ${box}`} aria-busy="true">
        {head}
        <p className="mt-3 flex items-center gap-2 text-xs text-zinc-300">
          <span aria-hidden className="ag-pulse h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />
          Checks passed. Waiting for PayPal to authorize the funds.
        </p>
        <Ids row={row} />
      </div>
    );
  }

  if (row.status === "held") {
    const total = 5 * 60_000;
    const left = row.expiresAt && now ? Math.max(0, new Date(row.expiresAt).getTime() - now) : total;
    const mm = Math.floor(left / 60_000);
    const ss = String(Math.floor((left % 60_000) / 1000)).padStart(2, "0");
    return (
      <div className={`ag-enter ${box} ring-1 ring-amber-400/20`}>
        {head}
        <Notes reasons={row.reasons} />
        <p className="mt-3 text-xs text-amber-100/80">Money is authorized with PayPal but not taken. It auto-voids if you do nothing.</p>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-amber-950" aria-hidden>
          <div className="h-full bg-amber-400 transition-[width] duration-1000 ease-linear" style={{ width: `${(left / total) * 100}%` }} />
        </div>
        <p className="mt-1.5 text-xs tabular-nums text-amber-200/80" aria-label={`Auto-voids in ${mm} minutes ${ss} seconds`}>
          {left > 0 ? `Auto-voids in ${mm}:${ss}` : "Expired, voiding"}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(row, "approve")}
            className="rounded-lg bg-emerald-400 px-3 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:opacity-50"
          >
            {busy ? "Working" : `Approve ${usd(row.amountUsd)}`}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(row, "reject")}
            className="rounded-lg border border-white/15 px-3 py-2 text-sm font-medium text-zinc-200 hover:border-white/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
        <Ids row={row} />
      </div>
    );
  }

  if (row.status === "blocked") {
    const injected = hasInjection(row);
    const lead = headline(row.reasons);
    const rest = orderReasons(row.reasons).filter((r) => r !== lead);
    return (
      <div className={`ag-slam ${box}`}>
        {head}
        <p className="mt-3 text-sm font-medium leading-snug text-rose-100 [overflow-wrap:anywhere]">
          <ReasonText r={lead} />
        </p>
        {rest.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-zinc-300 [overflow-wrap:anywhere]">
            {rest.slice(0, 3).map((r) => (
              <li key={r} className="flex gap-2">
                <span aria-hidden className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${dot(r)}`} />
                <span>
                  <ReasonText r={r} />
                </span>
              </li>
            ))}
            {rest.length > 3 && <li className="pl-3 text-zinc-500">and {rest.length - 3} more</li>}
          </ul>
        )}
        <button
          type="button"
          onClick={() => onReveal(row)}
          className="mt-3 w-full rounded-lg border border-rose-400/50 bg-rose-500/15 px-3 py-2 text-sm font-medium text-rose-100 hover:bg-rose-500/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300"
        >
          {injected ? "Reveal the injection" : "See why it was blocked"}
        </button>
      </div>
    );
  }

  return (
    <div className={`ag-enter ${box}`}>
      {head}
      {(row.status === "error" || row.status === "unknown") && (
        <p className="mt-2 text-xs text-orange-200">
          {row.status === "unknown" && "Still counted against your budget until PayPal confirms. "}
          {row.reasons.at(-1)}
        </p>
      )}
      {row.status !== "error" && row.status !== "unknown" && <Notes reasons={row.reasons} />}
      <Ids row={row} />
    </div>
  );
}

/** Non-blocking context on a paid / held / voided card: why it was held, plus amber warnings. */
function Notes({ reasons }: { reasons: string[] }) {
  if (!reasons.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs text-zinc-300 [overflow-wrap:anywhere]">
      {orderReasons(reasons).map((r) => (
        <li key={r} className="flex gap-2">
          <span aria-hidden className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${isWarning(r) ? "bg-amber-400" : "bg-zinc-500"}`} />
          <span>{isWarning(r) ? <ReasonText r={r} /> : r}</span>
        </li>
      ))}
    </ul>
  );
}

function Ids({ row }: { row: DecisionRow }) {
  const ids: [string, string | undefined][] = [
    ["PayPal order", row.paypalOrderId],
    ["Authorization", row.authorizationId],
    ["Capture", row.captureId],
  ];
  const shown = ids.filter(([, v]) => v);
  if (!shown.length) return null;
  return (
    <dl className="mt-3 space-y-1 border-t border-white/10 pt-3 text-xs">
      {shown.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3">
          <dt className="text-zinc-400">{k}</dt>
          <dd className="select-all font-mono text-zinc-200">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function RevealDialog({ reveal, onClose }: { reveal: { row: DecisionRow; text: string | null } | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (reveal && !d.open) d.showModal();
    if (!reveal && d.open) d.close();
  }, [reveal]);

  const row = reveal?.row;
  const quote = row?.triggeringText;
  const hidden = row ? (stores.find((s) => s.slug === slugFor(row.merchant))?.hidden ?? []) : [];
  const showPage = !!row && hasInjection(row) && (!!quote || hidden.length > 0);
  const text = reveal?.text ?? null;
  const parts = text ? markParts(text, [...hidden.map((h) => h.text), quote]) : [];

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="reveal-h"
      className="ag-dialog m-auto w-[min(920px,calc(100vw-2rem))] rounded-2xl border border-rose-500/40 bg-zinc-950 p-0 text-zinc-100 shadow-2xl shadow-rose-950/50"
    >
      {row && (
        <div className="max-h-[85vh] overflow-y-auto">
          <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-4">
            <div>
              <h2 id="reveal-h" className="text-lg font-semibold text-rose-200">
                {showPage ? "Injection revealed" : "Why this payment was blocked"}
              </h2>
              <p className="mt-0.5 text-sm text-zinc-400">
                {row.merchant} tried to charge {usd(row.amountUsd)} for {row.items}.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              autoFocus
              className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-zinc-300 hover:border-white/30 focus-visible:outline-2 focus-visible:outline-emerald-400"
            >
              Close
            </button>
          </div>
          <div className={`grid gap-6 px-6 py-5 ${showPage ? "md:grid-cols-[minmax(0,1fr)_260px]" : ""}`}>
            {showPage && (
              <div>
                <h3 className="text-sm font-medium text-zinc-300">What the agent read on the store page</h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Hidden from shoppers; <span className="text-rose-300">red = text aimed at AI agents</span>
                  {hidden.length > 0 && ` (${hidden.length} hidden ${hidden.length === 1 ? "segment" : "segments"})`}.
                </p>
                <div className="mt-3 max-h-[52vh] overflow-y-auto rounded-xl border border-white/10 bg-zinc-900/70 p-4 text-sm leading-7 whitespace-pre-wrap text-zinc-400">
                  {text === null ? (
                    <span className="ag-pulse">Loading page text</span>
                  ) : parts.some((x) => x.marked) ? (
                    parts.map((x, i) =>
                      x.marked ? (
                        <mark key={i} className="ag-redline ag-reveal rounded bg-transparent px-0.5 font-medium text-rose-100 underline decoration-rose-400 decoration-wavy underline-offset-4">
                          {x.text}
                        </mark>
                      ) : (
                        <span key={i}>{x.text}</span>
                      ),
                    )
                  ) : (
                    <>
                      {text}
                      {quote && <mark className="ag-redline mt-3 block rounded bg-transparent px-0.5 font-medium text-rose-100">{quote}</mark>}
                    </>
                  )}
                </div>
              </div>
            )}
            <div>
              <h3 className="text-sm font-medium text-zinc-300">Reasons</h3>
              <ul className="mt-3 space-y-2 text-sm">
                {orderReasons(row.reasons).map((r) => (
                  <li key={r} className="flex gap-2 text-zinc-200 [overflow-wrap:anywhere]">
                    <span aria-hidden className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dot(r)}`} />
                    <span>
                      <ReasonText r={r} />
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 rounded-lg bg-white/[0.03] p-3 text-xs text-zinc-400">No PayPal order was created. The agent got a refusal and no money moved.</p>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
