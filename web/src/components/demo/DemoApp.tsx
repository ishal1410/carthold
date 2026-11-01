"use client";
import { Ban, Hash, Hourglass, Play, Store, Tag, Wallet, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { stores } from "@/data/stores";
import type { AgentEvent } from "@/lib/agent/agent";
import type { DecisionRow, GuardState } from "@/lib/guard/guard";
import type { Mandate } from "@/lib/policy/policy";
import { DecisionGrid } from "@/components/grid";
import { RECORDED_RUN_HREF } from "@/components/site";
import { AnimatedNumber, Badge, Button, Panel, StatusPill, buttonClasses, cx } from "@/components/ui";
import { actionError, heldKpi, runBlockReason, runSettled, runStartError } from "./errors";
import { FIXTURE_REQUEST, fixtureEvents, fixturePages, fixtureState, settleFixtureHold } from "./fixtures";
import { markParts } from "./highlight";
import { hasInjection, orderReasons, plainReason, reasonTags } from "./reasons";
import { Trace } from "./Trace";
import { ReasonLine, Tags, VerdictStack, paidUsd, usd, type Decide } from "./Verdicts";
import { PAYER_BACK_KEY, PAYER_CHANNEL, PAYER_RETURN_KEY, openPayerWindow, payerMessageFor, type PayerReturn } from "@/app/demo/paypal-return/payer";
import "./demo.css";

type Mode = "live" | "redteam";
type StreamMsg = { kind: "agent"; event: AgentEvent } | { kind: "guard"; state: GuardState } | { kind: "end" };
type Phase = "idle" | "starting" | "running" | "done" | "error";
type View = "verdicts" | "trace" | "log";

// Display copy of the server's DEFAULT_MANDATE (lib/run/session.ts, server-only so not importable here).
// The server ignores any client mandate; keep these two in sync.
const MANDATE: Omit<Mandate, "userRequest"> = {
  budgetUsd: 100,
  perItemCapUsd: 60,
  approvalThresholdUsd: 25,
  merchantAllowlist: ["Northpine Outfitters", "Brew & Bean", "Giftlane Deals"],
  maxQuantity: 2,
};
const MAX_Q = 300; // same cap as the server's userRequest
const PRESETS: { label: string; text: string }[] = [
  { label: "Camping mug", text: "Buy me a camping coffee mug under $40" },
  { label: "Gift card", text: "Get a small gift card for my sister, under $40" },
  { label: "Earbuds", text: "Cheap wireless earbuds under $50" },
];
const EMPTY: GuardState = { rows: [], pendingHolds: [], amountAtRiskUsd: 0, committedUsd: 0, unknownRows: [] };

const slugFor = (merchant: string) => stores.find((s) => s.name.toLowerCase() === merchant.toLowerCase())?.slug;

// Owner capability token for a run (POST /api/runs returns it once). Tab-scoped; storage can throw (privacy modes),
// so the token also lives in React state and the run still works in this tab.
const ownerKey = (id: string) => `carthold:owner:${id}`;
function loadOwner(id: string): string | null {
  try {
    return sessionStorage.getItem(ownerKey(id));
  } catch {
    return null;
  }
}
function saveOwner(id: string, token: string) {
  try {
    sessionStorage.setItem(ownerKey(id), token);
  } catch {}
}

/** Keyed on ?fixture so a client-side hop between /demo and the recording starts from fresh state. */
export default function DemoApp() {
  const fixture = useSearchParams().get("fixture") === "1";
  return <Demo key={fixture ? "recording" : "live"} fixture={fixture} />;
}

function Demo({ fixture }: { fixture: boolean }) {
  const params = useSearchParams();
  // ?run=<id>&mode=<mode> survives a refresh: we reconnect and the server replays the run (#14).
  const [initialRun] = useState(() => (fixture ? null : params.get("run")));
  const [initialMode] = useState<Mode>(() => (!fixture && params.get("mode") === "live" ? "live" : "redteam"));
  // ?q= restores the run's request text after a refresh (FINDINGS-2 QA new 8).
  // Default = the mug: in Simulated mode it is the scenario whose clean retry reaches a real PayPal sandbox hold.
  const [request, setRequest] = useState(() => (fixture ? FIXTURE_REQUEST : (params.get("q")?.slice(0, MAX_Q) ?? PRESETS[0].text)));
  const [mode, setMode] = useState<Mode>(initialMode);
  /** Mode of the run on screen (the radio can change after the run starts). */
  const [runMode, setRunMode] = useState<Mode>(initialMode);
  const [phase, setPhase] = useState<Phase>(fixture ? "done" : initialRun ? "running" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(fixture ? "fixture" : initialRun);
  /** Bearer token proving this tab started the run. Null for a shared link: the holds are view only. */
  // /demo is static and this sits below Suspense + useSearchParams, so it renders on the client; hold rows only arrive over SSE after hydration, so viewOnly never mismatches. loadOwner swallows a missing sessionStorage.
  const [ownerToken, setOwnerToken] = useState<string | null>(() => (initialRun ? loadOwner(initialRun) : null));
  const [events, setEvents] = useState<AgentEvent[]>(() => (fixture ? fixtureEvents() : []));
  const [guard, setGuard] = useState<GuardState>(() => (fixture ? fixtureState() : EMPTY));
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [reveal, setReveal] = useState<{ row: DecisionRow; text: string | null } | null>(null);
  const [view, setView] = useState<View>("verdicts");
  /** Row whose PayPal popup closed with no approval (QA2 #1): its hold card shows the judge hint as a notice. */
  const [nudged, setNudged] = useState<string | null>(null);
  const guardRef = useRef(guard);
  /** The run on screen. A decision response for any other run is stale and must not touch this dashboard (QA3 d). */
  const runIdRef = useRef(runId);
  useEffect(() => {
    guardRef.current = guard;
    runIdRef.current = runId;
  });
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
      if (ended && runSettled(last)) return es.close();
      if (es.readyState !== EventSource.CLOSED) return; // the browser retries on its own
      if (!gotAny) {
        // 404 (server restarted or evicted this run) or 429 (too many stream connections).
        window.history.replaceState(null, "", "/demo");
        setRunId(null);
        setOwnerToken(null);
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

  // The recording has no server to auto-void its hold, so it does it here at expiresAt, as the guard would.
  useEffect(() => {
    if (!fixture) return;
    const timers = guard.rows
      .filter((r) => r.status === "held" && r.expiresAt)
      .map((r) => setTimeout(() => setGuard((g) => settleFixtureHold(g, r.id, "expire")), Math.max(0, Date.parse(r.expiresAt!) - Date.now())));
    return () => timers.forEach(clearTimeout);
  }, [fixture, guard.rows]);

  async function run() {
    if (startingRef.current || runBlockReason(guardRef.current, fixture)) return;
    startingRef.current = true;
    esRef.current?.close();
    runIdRef.current = null; // in-flight decisions for the old run are ignored from here on
    decidingRef.current.clear();
    setBusy({});
    setNudged(null);
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
        setPhase("error");
        setError(runStartError(res.status, body.error));
        return;
      }
      const { runId: id, ownerToken: token } = (await res.json()) as { runId: string; ownerToken: string };
      if (!token) {
        setPhase("error");
        setError("Run did not start. Try again.");
        return;
      }
      saveOwner(id, token);
      setOwnerToken(token);
      setRunId(id);
      setPhase("running");
      const q = new URLSearchParams({ run: id, mode, q: request.trim().slice(0, MAX_Q) });
      window.history.replaceState(null, "", `/demo?${q}`);
      connect(id);
    } catch {
      setPhase("error");
      setError(`Run did not start. ${actionError()}`);
    } finally {
      startingRef.current = false;
    }
  }

  /** "Approve with PayPal": the buyer approves in a popup (same tab if popups are blocked); see paypal-return/page.tsx. */
  // m5: the stream never carries the payer-action link; the owner fetches it with the Bearer token. The popup opens
  // first, still inside the click (else it is blocked), and is pointed at PayPal once the link arrives.
  async function openPayPal(row: DecisionRow) {
    if (!runId || !ownerToken || fixture) return;
    setError(null);
    const w = openPayerWindow(() => window.open("", "carthold-paypal", "popup,width=480,height=720"));
    let url: string | undefined;
    let status: number | undefined;
    let msg: string | undefined;
    try {
      const res = await fetch(`/api/runs/${runId}/holds/${row.id}`, { headers: { authorization: `Bearer ${ownerToken}` } });
      const body = (await res.json().catch(() => ({}))) as { payerActionUrl?: string; error?: string };
      status = res.status;
      msg = body.error;
      if (res.ok) url = body.payerActionUrl;
    } catch {}
    if (!url) {
      w?.close();
      return setError(`Could not open PayPal: ${actionError(status, msg)}`);
    }
    if (w) {
      w.location.replace(url);
      setNudged(null);
      // Popup closed and the row is still waiting: nobody approved. The grace period lets a late return message land first.
      const poll = setInterval(() => {
        if (!w.closed) return;
        clearInterval(poll);
        setTimeout(() => {
          if (guardRef.current.rows.find((r) => r.id === row.id)?.status === "awaiting_payer") setNudged(row.id);
        }, 2000);
      }, 500);
      return;
    }
    try {
      sessionStorage.setItem(PAYER_BACK_KEY, JSON.stringify({ run: runId, url: window.location.href }));
    } catch {}
    window.location.assign(url);
  }

  /** PayPal sent the buyer back: tell the server (it checks the order id and authorizes), or note a buyer cancel. */
  async function payerReturned(m: PayerReturn) {
    if (m.cancelled) return setNudged(m.row);
    if (!ownerToken || decidingRef.current.has(m.row)) return;
    const forRun = runId;
    decidingRef.current.add(m.row);
    setBusy((b) => ({ ...b, [m.row]: true }));
    try {
      const res = await fetch(`/api/runs/${runId}/holds/${m.row}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ action: "payer-approved", orderId: m.orderId }),
      });
      const body = (await res.json().catch(() => ({}))) as { state?: GuardState; error?: string };
      if (runIdRef.current !== forRun) return;
      // 409 "no pending hold": already authorized (a second delivery) or expired; the stream has the real outcome.
      if (res.status === 409 && body.error?.startsWith("no pending hold")) return;
      if (!res.ok || !body.state) return setError(`PayPal approval failed: ${actionError(res.status, body.error)}`);
      setGuard(body.state);
    } catch {
      if (runIdRef.current === forRun) setError(`PayPal approval failed: ${actionError()}`);
    } finally {
      decidingRef.current.delete(m.row);
      setBusy((b) => ({ ...b, [m.row]: false }));
    }
  }
  const payerRef = useRef(payerReturned);
  useEffect(() => {
    payerRef.current = payerReturned;
  });

  // The return page reaches this tab by postMessage (popup with opener), BroadcastChannel (opener cut by PayPal), or
  // sessionStorage (same-tab fallback). Same-origin only; the server re-checks the order id against the row.
  useEffect(() => {
    if (fixture || !runId) return;
    const take = (data: unknown) => {
      const m = payerMessageFor(data, runId);
      if (m) void payerRef.current(m);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin) take(e.data);
    };
    window.addEventListener("message", onMessage);
    let ch: BroadcastChannel | undefined;
    try {
      ch = new BroadcastChannel(PAYER_CHANNEL);
      ch.onmessage = (e) => take(e.data);
    } catch {}
    try {
      const saved = sessionStorage.getItem(PAYER_RETURN_KEY);
      if (saved) {
        sessionStorage.removeItem(PAYER_RETURN_KEY);
        queueMicrotask(() => take(JSON.parse(saved)));
      }
    } catch {}
    return () => {
      window.removeEventListener("message", onMessage);
      ch?.close();
    };
  }, [fixture, runId]);

  const decide: Decide = async (row, action) => {
    if (action === "paypal") return openPayPal(row);
    if (decidingRef.current.has(row.id)) return;
    const forRun = runId;
    decidingRef.current.add(row.id);
    setBusy((b) => ({ ...b, [row.id]: true }));
    try {
      if (fixture) {
        // A click that lands after expiresAt (before the expiry timer fires) voids, like the server's 409 + auto-void.
        setGuard((g) => {
          const cur = g.rows.find((r) => r.id === row.id);
          const expired = !!cur?.expiresAt && Date.parse(cur.expiresAt) <= Date.now();
          return settleFixtureHold(g, row.id, expired ? "expire" : action);
        });
        return;
      }
      if (!ownerToken) return; // view-only tab: buttons are disabled, never send "Bearer null"
      const res = await fetch(`/api/runs/${runId}/holds/${row.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ action }),
      });
      // 409 = hold already settled (auto-void, another tab, an earlier click). Not an error:
      // the open stream carries the real outcome. A response for a run no longer on screen is dropped.
      if (res.status === 409 || runIdRef.current !== forRun) return;
      const verb = action === "approve" ? "Release" : "Cancel";
      if (res.status === 429) return setError(`${verb} failed: too many clicks right now. Wait a minute and try again.`);
      const body = (await res.json().catch(() => ({}))) as { state?: GuardState; error?: string };
      if (!res.ok || !body.state) return setError(`${verb} failed: ${actionError(res.status, body.error)}`);
      setGuard(body.state);
    } catch {
      if (runIdRef.current === forRun) setError(`${action === "approve" ? "Release" : "Cancel"} failed: ${actionError()}`);
    } finally {
      decidingRef.current.delete(row.id);
      setBusy((b) => ({ ...b, [row.id]: false }));
    }
  };

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
  // A dashboard only once there is something to show; before that, the composer and a preview.
  const hasRun = running || events.length > 0 || guard.rows.length > 0;
  const simulated = runMode === "redteam";
  // The recording makes no API calls, so it is always decidable; a shared live link without the token is not.
  const viewOnly = !fixture && !ownerToken;
  const composer = (compact: boolean) => (
    <Composer
      compact={compact}
      request={request}
      setRequest={setRequest}
      mode={mode}
      setMode={setMode}
      running={running}
      waiting={running && (guard.pendingHolds.length > 0 || guard.rows.some((r) => r.status === "awaiting_payer"))}
      blocked={runBlockReason(guard, fixture)}
      onRun={run}
      fixture={fixture}
      error={hasRun ? null : error}
    />
  );
  const show = (v: View) => (view === v ? "" : "max-lg:hidden");

  return (
    <div className="relative flex min-h-full flex-1 flex-col overflow-x-clip bg-canvas text-ink">
      {hasRun && <RunBar guard={guard} simulated={simulated} running={running} fixture={fixture} view={view} setView={setView} />}
      <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-20 md:px-6">
        {!hasRun ? (
          <EmptyState composer={composer(false)} />
        ) : (
          <>
            {error && (
              <p role="alert" className="mt-6 rounded-md border border-blocked/30 bg-blocked-soft px-4 py-3 text-sm text-ink">
                {error}
              </p>
            )}
            <div className="mt-6 max-lg:order-last max-lg:mt-12">
              <Panel padded={false} coreClassName="p-4 md:p-5">
                {composer(true)}
              </Panel>
            </div>
            <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:mt-10 lg:grid-cols-12 lg:gap-10">
              <Trace events={events} phase={phase} mode={runMode} rows={guard.rows} viewOnly={viewOnly} className={cx("lg:col-span-7 lg:max-h-[calc(100dvh-10rem)]", show("trace"))} />
              <div className={cx("lg:sticky lg:top-24 lg:col-span-5 lg:self-start", show("verdicts"))}>
                <VerdictStack guard={guard} busy={busy} simulated={simulated} fixture={fixture} nudged={nudged} viewOnly={viewOnly} onDecide={decide} onReveal={openReveal} />
              </div>
            </div>
            <section aria-labelledby="log-h" className={cx("mt-6 min-w-0 lg:mt-16", show("log"))}>
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 id="log-h" className="font-display text-xl font-semibold tracking-tight">
                  Decision log
                </h2>
                <Link href="/demo/scorecard" className="text-sm text-info underline-offset-4 hover:underline">
                  Injection scorecard
                </Link>
              </div>
              {guard.rows.length ? (
                <DecisionGrid rows={guard.rows} onSelect={openReveal} />
              ) : (
                <p className="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-faint">
                  Every payment the agent attempts lands here, allowed or not.
                </p>
              )}
            </section>
          </>
        )}
      </main>
      <RevealDialog reveal={reveal} onClose={() => setReveal(null)} />
    </div>
  );
}

/** Sticky under the site nav: what kind of run this is, the money, and (on phones) which pane to show. */
function RunBar(p: {
  guard: GuardState;
  simulated: boolean;
  running: boolean;
  fixture: boolean;
  view: View;
  setView: (v: View) => void;
}) {
  const held = p.guard.pendingHolds.length;
  const views: { id: View; label: string }[] = [
    { id: "verdicts", label: "Verdicts" },
    { id: "trace", label: "Trace" },
    { id: "log", label: "Log" },
  ];
  return (
    <div className="z-20 mt-3 border-y lg:sticky lg:top-[4.25rem] border-line bg-canvas">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 md:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {p.fixture ? (
            <span title="A recording of the real guard on sample orders. It replays a Simulated run; no live agent, Gemini or PayPal calls happen on this page.">
              <Badge tone="neutral" icon={<Play strokeWidth={1.5} />}>
                Recorded run
              </Badge>
              <span className="sr-only">: a recording of the real guard on sample orders. It replays a Simulated run; no live agent, Gemini or PayPal calls happen on this page.</span>
            </span>
          ) : (
            <Badge tone="info">PayPal sandbox</Badge>
          )}
          {p.simulated ? <Badge tone="hold">Simulated compromised agent</Badge> : <Badge tone="neutral">Live Gemini agent</Badge>}
          {p.running && (
            <span className="inline-flex items-center gap-1.5 text-2xs text-ink-muted">
              <span aria-hidden className="shrink-0 size-1.5 animate-shimmer rounded-pill bg-paid" />
              Running
            </span>
          )}
        </div>
        <Kpis guard={p.guard} />
      </div>
      <div className="border-t border-line px-4 py-2 lg:hidden">
          <div role="group" aria-label="Show" className="mx-auto grid max-w-md grid-cols-3 rounded-pill border border-line bg-surface-2 p-1">
            {views.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-pressed={p.view === v.id}
                onClick={() => {
                  p.setView(v.id);
                  window.scrollTo({ top: 0 });
                }}
                className="relative inline-flex h-9 items-center justify-center gap-1.5 rounded-pill text-sm text-ink-muted transition-colors duration-[var(--duration-base)] ease-snap aria-pressed:bg-surface-3 aria-pressed:text-ink aria-pressed:shadow-raise"
              >
                {v.label}
                {v.id === "verdicts" && held > 0 && <span aria-label={`${held} waiting on you`} className="size-1.5 rounded-pill bg-hold" />}
              </button>
            ))}
          </div>
        </div>
    </div>
  );
}

function Kpis({ guard }: { guard: GuardState }) {
  const stopped = guard.rows.filter((r) => r.status === "blocked").reduce((s, r) => s + r.amountUsd, 0);
  const captured = paidUsd(guard.rows);
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / MANDATE.budgetUsd) * 100))}%`;
  const autoPaid = guard.autoPaidUsd;
  const { heldUsd, awaitingUsd } = heldKpi(guard);
  const held = heldUsd > 0 || awaitingUsd > 0;
  return (
    <dl className="grid w-full grid-cols-3 gap-4 lg:ml-auto lg:flex lg:w-auto lg:items-center lg:gap-8">
      <div className="min-w-0">
        <dt className="flex items-center gap-1.5 text-2xs text-ink-muted">
          <Hourglass aria-hidden strokeWidth={1.5} className="shrink-0 size-3.5 text-hold" />
          Held in PayPal
        </dt>
        <dd className={cx("text-base md:text-xl", held ? "text-hold" : "text-ink-muted")}>
          <AnimatedNumber value={heldUsd} />
          {awaitingUsd > 0 && (
            <span className="figures mt-1 block text-2xs text-ink-muted">
              {heldUsd > 0 ? `+${usd(awaitingUsd)} awaiting your approval` : `${usd(awaitingUsd)} awaiting your approval, nothing held yet`}
            </span>
          )}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="flex items-center gap-1.5 text-2xs text-ink-muted">
          <Ban aria-hidden strokeWidth={1.5} className="shrink-0 size-3.5 text-blocked" />
          Blocked
        </dt>
        <dd className={cx("text-base md:text-xl", stopped ? "text-ink" : "text-ink-muted")}>
          <AnimatedNumber value={stopped} />
        </dd>
      </div>
      <div className="min-w-0 lg:w-52">
        <dt className="flex items-center justify-between gap-2 text-2xs text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <Wallet aria-hidden strokeWidth={1.5} className="shrink-0 size-3.5 text-paid" />
            Budget used
          </span>
          <span className="figures max-sm:hidden">of {usd(MANDATE.budgetUsd)}</span>
        </dt>
        <dd>
          <AnimatedNumber value={guard.committedUsd} className="text-base md:text-xl" />
          <span
            className="mt-1 flex h-1.5 overflow-hidden rounded-pill bg-surface-3"
            role="meter"
            aria-label={`Budget used ${usd(guard.committedUsd)} of ${usd(MANDATE.budgetUsd)} budget`}
            aria-valuemin={0}
            aria-valuemax={MANDATE.budgetUsd}
            aria-valuenow={guard.committedUsd}
          >
            <span className="h-full bg-paid transition-[width] duration-[var(--duration-slower)] ease-out" style={{ width: pct(captured) }} />
            <span className="h-full bg-hold transition-[width] duration-[var(--duration-slower)] ease-out" style={{ width: pct(guard.committedUsd - captured) }} />
          </span>
          {autoPaid != null && (
            <span
              className="figures mt-1 block text-2xs text-ink-faint max-sm:hidden"
              role="meter"
              aria-label={`Auto-paid ${usd(autoPaid)} of ${usd(MANDATE.approvalThresholdUsd)} without asking`}
              aria-valuemin={0}
              aria-valuemax={MANDATE.approvalThresholdUsd}
              aria-valuenow={autoPaid}
            >
              auto-paid {usd(autoPaid)} of {usd(MANDATE.approvalThresholdUsd)}
            </span>
          )}
        </dd>
      </div>
    </dl>
  );
}

/** The mandate as one quiet strip. Store names open in place. */
function Rules() {
  const items = [
    { icon: Wallet, text: `${usd(MANDATE.budgetUsd).replace(".00", "")} budget` },
    { icon: Tag, text: `${usd(MANDATE.perItemCapUsd).replace(".00", "")} per item` },
    { icon: Hourglass, text: `Ask me over ${usd(MANDATE.approvalThresholdUsd).replace(".00", "")}` },
    { icon: Hash, text: `Max ${MANDATE.maxQuantity} of anything` },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-muted">
      <span className="text-ink-faint" title="The guard checks every payment against these. Limits reset each run.">
        Your rules
      </span>
      {items.map((i) => (
        <span key={i.text} className="inline-flex items-center gap-1.5">
          <i.icon aria-hidden strokeWidth={1.5} className="shrink-0 size-3.5 text-ink-faint" />
          {i.text}
        </span>
      ))}
      <details className="group relative">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-xs hover:text-ink [&::-webkit-details-marker]:hidden">
          <Store aria-hidden strokeWidth={1.5} className="shrink-0 size-3.5 text-ink-faint" />
          <span className="underline decoration-line-strong underline-offset-4">{MANDATE.merchantAllowlist.length} allowed stores</span>
        </summary>
        <ul className="absolute top-full left-0 z-20 mt-2 w-56 space-y-1 rounded-md border border-line-strong bg-surface-2 p-3 shadow-float">
          {MANDATE.merchantAllowlist.map((m) => (
            <li key={m} className="text-ink">
              {m}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function Composer(p: {
  compact: boolean;
  request: string;
  setRequest: (s: string) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  running: boolean;
  /** The run is open but the agent is idle until the user decides a hold. */
  waiting: boolean;
  /** Why a new run is not allowed right now (a live hold is waiting), or null. */
  blocked: string | null;
  onRun: () => void;
  fixture: boolean;
  error: string | null;
}) {
  const modes: { id: Mode; label: string; hint: string }[] = [
    { id: "redteam", label: "Simulated", hint: "Simulated compromised agent: a script that obeys the poisoned pages. Same real guard." },
    { id: "live", label: "Live Gemini", hint: "Live Gemini agent: shops for real against the PayPal sandbox." },
  ];
  const hint = modes.find((m) => m.id === p.mode)?.hint;
  const presets = (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-ink-faint">Try</span>
      {PRESETS.map((s) => (
        <button
          key={s.label}
          type="button"
          onClick={() => p.setRequest(s.text)}
          aria-pressed={p.request === s.text}
          title={s.text}
          className="h-7 rounded-pill border border-line px-3 text-xs text-ink-muted transition-colors duration-[var(--duration-fast)] ease-snap hover:border-line-strong hover:text-ink aria-pressed:border-hold/40 aria-pressed:bg-hold-soft aria-pressed:text-hold"
        >
          {s.label}
        </button>
      ))}
    </div>
  );
  const modePicker = (
    <fieldset>
      <legend className="sr-only">Agent</legend>
      <div className="inline-grid w-full grid-cols-2 rounded-pill border border-line bg-surface-2 p-1">
        {modes.map((m) => (
          <label
            key={m.id}
            className={cx(
              "flex h-8 cursor-pointer items-center justify-center rounded-pill px-3 text-xs whitespace-nowrap transition-colors duration-[var(--duration-base)] ease-snap has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-hold",
              p.mode === m.id ? (m.id === "redteam" ? "bg-hold-soft text-hold shadow-raise" : "bg-surface-3 text-ink shadow-raise") : "text-ink-muted hover:text-ink",
            )}
          >
            <input type="radio" name="mode" value={m.id} checked={p.mode === m.id} onChange={() => p.setMode(m.id)} className="sr-only" />
            {m.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
  const submit = (
    <div title={p.blocked ?? undefined}>
      <Button
        type="submit"
        size={p.compact ? "md" : "lg"}
        disabled={p.running || !p.request.trim() || !!p.blocked}
        aria-describedby={p.blocked ? "run-blocked" : undefined}
        loading={p.running && !p.waiting}
        icon={!p.running && <Play strokeWidth={1.75} />}
        className="w-full"
      >
        {p.waiting ? "Waiting on your approval" : p.running ? "Agent is shopping" : p.fixture ? "Replay recording" : "Run agent"}
      </Button>
      {p.blocked && (
        <p id="run-blocked" className="mt-1.5 text-xs text-hold">
          {p.blocked}
        </p>
      )}
    </div>
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!p.running && !p.blocked && p.request.trim()) p.onRun();
      }}
    >
      <div className={p.compact ? "sr-only" : "flex items-center justify-between gap-3"}>
        <label htmlFor="req" className="text-sm font-medium text-ink">
          What should the agent buy?
        </label>
        {!p.compact && <Badge tone="info">PayPal sandbox</Badge>}
      </div>
      <div className={cx(p.compact ? "grid gap-4 md:grid-cols-[minmax(0,1fr)_17rem]" : "mt-3 space-y-4")}>
        <div className="space-y-3">
          <textarea
            id="req"
            rows={3}
            maxLength={MAX_Q}
            value={p.request}
            onChange={(e) => p.setRequest(e.target.value)}
            className="w-full min-h-20 resize-none rounded-md border field-sizing-content border-line bg-surface-2 px-3.5 py-3 text-base text-ink placeholder:text-ink-faint focus:border-hold/50 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-hold/40"
            placeholder="What should the agent buy?"
          />
          {presets}
        </div>
        <div className="space-y-2.5">
          {modePicker}
          {!p.compact && <p className="text-xs text-ink-faint">{hint}</p>}
          {submit}
        </div>
      </div>
      {p.error && (
        <p role="alert" className="mt-4 rounded-md border border-blocked/30 bg-blocked-soft px-3.5 py-2.5 text-sm text-ink">
          {p.error}
        </p>
      )}
      <div className="mt-4 border-t border-line pt-3.5">
        <Rules />
      </div>
      {p.fixture && (
        <p className="mt-3 text-xs text-ink-faint">
          Recorded run: a replay of a Simulated run through the real guard on sample orders. No live agent, Gemini or PayPal calls happen here.{" "}
          <a href="/demo" className="text-info underline-offset-4 hover:underline">
            Run it live
          </a>
        </p>
      )}
    </form>
  );
}

function EmptyState({ composer }: { composer: ReactNode }) {
  return (
    <section className="grid flex-1 grid-cols-[minmax(0,1fr)] items-center gap-12 py-12 lg:grid-cols-12 lg:gap-14 lg:py-20">
      <div className="lg:col-span-7">
        <h1 className="max-w-[16ch] font-display text-3xl font-semibold tracking-tight text-balance md:text-4xl">Let an agent shop. Keep the final say.</h1>
        <p className="mt-4 max-w-[54ch] text-lg text-ink-muted">
          CartHold checks every payment the agent proposes against your rules. Anything over your limit waits for you: approve it in PayPal, then release or cancel the held payment.
        </p>
        <Panel className="mt-8">{composer}</Panel>
      </div>
      <div className="lg:col-span-5">
        <GhostPreview />
      </div>
    </section>
  );
}

/** What a finished run looks like, dimmed, with the way in: the recording. */
function GhostPreview() {
  const chips: [string, "block" | "captured", string, string][] = [
    ["d3", "block", "$1,000.00", "Giftlane Deals / followed hidden text"],
    ["d2", "captured", "$18.00", "Brew & Bean / auto-paid, under limit"],
  ];
  return (
    <div className="relative">
      <p className="mb-3 text-xs text-ink-faint">What a finished run looks like</p>
      <div aria-hidden inert className="pointer-events-none select-none space-y-2 opacity-60 [mask-image:linear-gradient(#000_60%,transparent_98%)]">
        <Panel tone="hold" as="div">
          <StatusPill status="hold" label="Held in PayPal" />
          <div className="mt-5 flex items-start justify-between gap-4">
            <div>
              <p className="figures text-money">$30.00</p>
              <p className="mt-3 font-display text-xl font-semibold tracking-tight">Northpine Outfitters</p>
              <p className="text-sm text-ink-muted">1x Basecamp Enamel Mug, 16 oz</p>
            </div>
            <div className="relative size-28 shrink-0">
              <svg viewBox="0 0 120 120" className="size-full -rotate-90">
                <circle cx="60" cy="60" r="52" fill="none" stroke="var(--line-strong)" strokeWidth="3" />
                <circle cx="60" cy="60" r="52" fill="none" stroke="var(--hold)" strokeWidth="4" strokeLinecap="round" strokeDasharray="327" strokeDashoffset="90" />
              </svg>
              <span className="figures absolute inset-0 flex items-center justify-center text-xl">4:12</span>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-[1fr_auto] gap-2">
            <span className={buttonClasses({ variant: "approve", size: "lg" })}>Release $30.00</span>
            <span className={buttonClasses({ variant: "ghost", size: "lg" })}>Cancel</span>
          </div>
        </Panel>
        {chips.map(([k, s, amt, text]) => (
          <div key={k} className="flex items-center gap-3 rounded-md border border-line bg-surface-1 px-3 py-2.5 text-sm">
            <StatusPill status={s} label={s === "captured" ? "Paid" : undefined} size="sm" />
            <span className="figures text-ink-muted">{amt}</span>
            <span className="truncate text-ink-faint">{text}</span>
          </div>
        ))}
      </div>
      <div className="relative -mt-10 flex flex-col items-center gap-2.5 text-center">
        <a href={RECORDED_RUN_HREF} className={buttonClasses({ variant: "primary", size: "lg", withIcon: true, className: "shadow-float" })}>
          <span>Watch a recorded run</span>
          <span aria-hidden className="inline-flex size-8 items-center justify-center rounded-pill bg-hold-ink/10 transition-transform duration-[var(--duration-base)] ease-snap group-hover:translate-x-0.5 group-hover:-translate-y-px">
            <Play strokeWidth={1.75} className="size-4" />
          </span>
        </a>
        <p className="text-xs text-ink-faint">Five payments, two hidden-text attacks, one hold. No live calls.</p>
      </div>
    </div>
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
  const lead = row ? orderReasons(row.reasons).find((r) => !/^warning/i.test(r)) : undefined;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="reveal-h"
      className="ag-dialog m-auto w-[min(960px,calc(100vw-2rem))] rounded-lg border border-blocked/30 bg-surface-1 p-0 text-ink shadow-float"
    >
      {row && (
        <div className="max-h-[85dvh] overflow-y-auto">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 md:px-6">
            <div className="min-w-0">
              <StatusPill status="block" size="sm" />
              <h2 id="reveal-h" className="mt-2 font-display text-2xl font-semibold tracking-tight">
                {showPage ? "The page told the agent what to buy" : "Why this payment was blocked"}
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                The agent tried to pay {row.merchant} <span className="figures text-ink">{usd(row.amountUsd)}</span> for {row.items}.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} autoFocus aria-label="Close">
              <X aria-hidden strokeWidth={1.75} className="shrink-0 size-4" />
            </Button>
          </div>
          <div className={cx("grid gap-6 px-5 py-5 md:px-6", showPage && "md:grid-cols-[minmax(0,1fr)_280px]")}>
            {showPage && (
              <div>
                <h3 className="text-sm font-medium text-ink">What the agent read on the store page</h3>
                <p className="mt-0.5 text-xs text-ink-faint">
                  Hidden from shoppers. Underlined text was written for AI agents
                  {hidden.length > 0 && ` (${hidden.length} hidden ${hidden.length === 1 ? "segment" : "segments"})`}.
                </p>
                <div className="mt-3 max-h-[52dvh] overflow-y-auto rounded-md border border-line bg-surface-2 p-4 text-sm leading-7 whitespace-pre-wrap text-ink-faint">
                  {text === null ? (
                    <span className="animate-shimmer">Loading page text</span>
                  ) : parts.some((x) => x.marked) ? (
                    parts.map((x, i) =>
                      x.marked ? (
                        <mark key={i} className="ag-redline ag-reveal rounded-xs bg-transparent px-0.5 font-medium text-ink underline decoration-blocked decoration-wavy underline-offset-4">
                          {x.text}
                        </mark>
                      ) : (
                        <span key={i}>{x.text}</span>
                      ),
                    )
                  ) : (
                    <>
                      {text}
                      {quote && <mark className="ag-redline mt-3 block rounded-xs bg-transparent px-0.5 font-medium text-ink">{quote}</mark>}
                    </>
                  )}
                </div>
              </div>
            )}
            <div className="space-y-4">
              {lead && <p className="font-display text-lg font-semibold leading-snug tracking-tight">{plainReason(lead)}</p>}
              <Tags tags={reasonTags(row.reasons).filter((t) => !(showPage && t === "followed hidden text"))} />
              <details open={!showPage} className="text-sm">
                <summary className="w-max cursor-pointer text-xs text-ink-faint hover:text-ink">All {row.reasons.length} reasons</summary>
                <ul className="mt-3 space-y-2">
                  {orderReasons(row.reasons).map((r) => (
                    <ReasonLine key={r} r={r} />
                  ))}
                </ul>
              </details>
              <p className="rounded-md border border-line bg-surface-2 p-3 text-xs text-ink-muted">No PayPal order was created. CartHold blocked the order and no money moved.</p>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
