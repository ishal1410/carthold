// In-memory run registry: one guard + one agent run per runId, with a message log for SSE replay.
// Lives on globalThis so dev HMR doesn't drop runs (and their pending holds) mid-demo.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { runAgent, type AgentEvent, type RunAgentOptions } from "../agent/agent";
import { createGuard, type Guard, type GuardOptions, type GuardState, type PayPalEvent } from "../guard/guard";
import { sweepOrphanedHolds } from "../paypal/webhook";
import { type Mandate } from "../policy/policy";
import { runRedteam } from "../redteam/redteam";

export type StreamMsg = { kind: "agent"; event: AgentEvent } | { kind: "guard"; state: GuardState } | { kind: "end" };
export type RunMode = "live" | "redteam";
export type Runner = (opts: Omit<RunAgentOptions, "llm" | "persona">) => Promise<unknown>;

export const DEFAULT_MANDATE: Omit<Mandate, "userRequest"> = {
  budgetUsd: 100,
  perItemCapUsd: 60,
  approvalThresholdUsd: 25,
  merchantAllowlist: ["Northpine Outfitters", "Brew & Bean", "Giftlane Deals"],
  maxQuantity: 2,
};

// The mandate is server-owned (FINDINGS #1): unknown keys such as a client "mandate" are stripped, never merged.
export const CreateRunSchema = z.object({
  userRequest: z.string().trim().min(1).max(300),
  mode: z.enum(["live", "redteam"]),
});
export type CreateRunInput = z.infer<typeof CreateRunSchema>;

export type Run = {
  id: string;
  mode: RunMode;
  mandate: Mandate;
  guard: Guard;
  messages: StreamMsg[];
  listeners: Set<(m: StreamMsg) => void>;
  ended: boolean;
  /** sha256 of the owner capability token (only the creator may decide holds). Never serialized or streamed. */
  ownerHash: Buffer;
  /** When the agent run finished (deps.now clock); starts the unresolvable-row TTL. */
  endedAt?: number;
  /** Polls guard.resolveUnknown while the run has "unknown" rows (R2-D). */
  resolveTimer?: ReturnType<typeof setInterval>;
};

/** Test seam: swap runners / guard deps (paypal, inspector llm) without touching the network. */
export type RunDeps = {
  runners: Record<RunMode, Runner>;
  guard?: Pick<GuardOptions, "llm" | "paypal" | "holdTimeoutMs">;
  maxRuns?: number;
  /** How often unknown rows are re-checked with PayPal (default 30s). */
  resolveEveryMs?: number;
  /** Clock for the unresolvable-row TTL (default Date.now). */
  now?: () => number;
  /** Crash recovery, once per process on the first createRun (default: lib/paypal/webhook sweepOrphanedHolds). */
  sweepOrphans?: (o: { bootAt: number; isKnown: (authId: string) => boolean }) => Promise<unknown>;
};

/** Thrown by createRun when every stored run is still running or has a pending hold. */
export class RunsFullError extends Error {
  constructor() {
    super("server busy: too many active runs, try again shortly");
  }
}

const defaultDeps: RunDeps = {
  runners: { live: (o) => runAgent({ ...o, persona: "realistic" }), redteam: runRedteam },
  sweepOrphans: sweepOrphanedHolds,
};

const g = globalThis as unknown as {
  __cartholdRuns?: Map<string, Run>; __cartholdDeps?: RunDeps; __cartholdShuttingDown?: boolean; __cartholdOrphanSweep?: boolean;
};
const runs = (g.__cartholdRuns ??= new Map());
const MAX_RUNS = 100; // ponytail: in-memory, a real store if runs must outlive the process
/** A run whose only open money is guard-flagged "unresolvable" unknown rows is evictable this long after it ended (R3 #5). */
export const UNRESOLVABLE_TTL_MS = 30 * 60_000;
const deps = () => g.__cartholdDeps ?? defaultDeps;
const now = () => (deps().now ?? Date.now)();

export function setRunDeps(deps: RunDeps | undefined) {
  g.__cartholdDeps = deps;
}

export const getRun = (id: string): Run | undefined => runs.get(id);
export const resetRuns = () => {
  for (const r of runs.values()) clearInterval(r.resolveTimer);
  runs.clear();
  g.__cartholdShuttingDown = false;
  g.__cartholdOrphanSweep = false;
}; // test seam

/**
 * Holds live only in memory, so a crash / OOM orphans them. On the first run of a new process, void CartHold
 * authorizations made before this process booted that no run knows (sweepOrphanedHolds reads PayPal's event log).
 * ponytail: triggered by the first run, not at boot (instrumentation stays free of server-only PayPal imports), so
 * an orphan waits for the next visitor; a boot hook in instrumentation-node.ts would close that gap.
 */
function kickOrphanSweep(d: RunDeps) {
  if (g.__cartholdOrphanSweep || !d.sweepOrphans) return;
  g.__cartholdOrphanSweep = true;
  const bootAt = Date.now() - process.uptime() * 1000;
  const isKnown = (authId: string) => [...runs.values()].some((r: Run) => r.guard.getState().rows.some((row) => row.authorizationId === authId));
  void d.sweepOrphans({ bootAt, isKnown }).catch((e) => console.error("orphaned-hold sweep failed:", e));
}

const unknownRowIds = (state: GuardState) => state.rows.filter((r) => r.status === "unknown").map((r) => r.id);
// Feature-detected: guard flags rows it gave up resolving in state.unresolvable (R3 #5).
const unresolvableIds = (state: GuardState) => new Set((state as { unresolvable?: string[] }).unresolvable ?? []);
/** Unknown rows still worth polling PayPal for. */
const pollableIds = (state: GuardState) => {
  const dead = unresolvableIds(state);
  return unknownRowIds(state).filter((id) => !dead.has(id));
};

/**
 * Nothing left that can change: agent finished, no row "pending", "held" or "awaiting_payer" (by status, not by hold timer: approve
 * clears the timer before its capture returns, B7), no "unknown" money still being polled. Unresolvable unknown
 * rows are never polled again, so they cannot change either (B12). Streams may close.
 */
export function isSettled(run: Run): boolean {
  const s = run.guard.getState();
  const polled = new Set(pollableIds(s));
  return run.ended && s.pendingHolds.length === 0 && !s.rows.some((r) => r.status === "held" || r.status === "pending" || r.status === "awaiting_payer" || polled.has(r.id));
}

/** Settled, and any unknown (hence unresolvable) money has sat for UNRESOLVABLE_TTL_MS since the run ended. */
function isEvictable(run: Run): boolean {
  return isSettled(run) && (unknownRowIds(run.guard.getState()).length === 0 || now() - (run.endedAt ?? Infinity) >= UNRESOLVABLE_TTL_MS);
}

/** Frees one slot: oldest evictable run (never one still running, holding, or with resolvable unknown money). False if none. */
function evictOne(): boolean {
  for (const [id, r] of runs) // Map iterates in insertion order = oldest first
    if (isEvictable(r)) return clearInterval(r.resolveTimer), runs.delete(id);
  return false;
}

/** A listener that throws (e.g. a closed SSE controller) is dropped; it never reaches the agent run (R2-E). */
function deliver(run: Run, l: (m: StreamMsg) => void, msg: StreamMsg): boolean {
  try {
    l(msg);
    return true;
  } catch {
    run.listeners.delete(l);
    return false;
  }
}

function push(run: Run, msg: StreamMsg) {
  run.messages.push(msg);
  for (const l of [...run.listeners]) deliver(run, l, msg);
}

/** Starts/stops the unknown-row poll. Feature-detected: guard.resolveUnknown lands with the guard's fix. */
function syncResolvePoll(run: Run, state: GuardState, everyMs: number) {
  const has = pollableIds(state).length > 0;
  if (!has) {
    clearInterval(run.resolveTimer);
    run.resolveTimer = undefined;
    return;
  }
  if (run.resolveTimer) return;
  run.resolveTimer = setInterval(() => {
    const resolve = (run.guard as { resolveUnknown?: (rowId: string) => unknown }).resolveUnknown;
    const ids = pollableIds(run.guard.getState());
    if (!ids.length) return syncResolvePoll(run, run.guard.getState(), everyMs);
    if (!resolve) return;
    for (const id of ids)
      void Promise.resolve()
        .then(() => resolve.call(run.guard, id))
        .catch((e) => console.error(`run ${run.id} resolveUnknown(${id}) failed:`, e));
  }, everyMs);
  (run.resolveTimer as { unref?: () => void }).unref?.();
}

const summarize = (m: Mandate) =>
  // R4 #11: the threshold is cumulative (guard autoPaidUsd), not per purchase.
  `budget $${m.budgetUsd}, max $${m.perItemCapUsd} per item, auto-pay up to $${m.approvalThresholdUsd} in total per run; anything beyond waits for approval, ` +
  `max quantity ${m.maxQuantity}, allowed merchants: ${m.merchantAllowlist.join(", ")}`;

const sha256 = (s: string) => createHash("sha256").update(s).digest();

/** True only for the token createRun returned for this run. Constant-time over equal-length digests. */
export function isOwner(run: Run, token: string | null | undefined): boolean {
  return !!token && timingSafeEqual(sha256(token), run.ownerHash);
}

/**
 * "Approve with PayPal" return/cancel URLs for a hold row, or undefined for the sandbox-card hold path.
 * PAYPAL_HOLD_PAYER = "paypal" (default) | "card": the card value is the instant fallback if sandbox buyer approval
 * breaks. No origin (a caller outside the HTTP route): card path, since PayPal needs absolute return URLs.
 */
export function payerUrlsFor(runId: string, origin: string | undefined) {
  if ((process.env.PAYPAL_HOLD_PAYER ?? "paypal").trim().toLowerCase() === "card" || !origin) return undefined;
  return (rowId: string) => {
    const back = `${origin}/demo/paypal-return?${new URLSearchParams({ run: runId, row: rowId })}`;
    return { returnUrl: back, cancelUrl: `${back}&cancelled=1` };
  };
}

/**
 * Input must already be validated with CreateRunSchema. Starts the run in the background.
 * ownerToken is returned exactly once; the run keeps only its sha256.
 * `origin` (e.g. https://carthold.example): where PayPal sends the buyer back after approving a hold.
 */
export function createRun(input: CreateRunInput, { origin }: { origin?: string } = {}): { run: Run; ownerToken: string } {
  const d = deps();
  if (g.__cartholdShuttingDown || (runs.size >= (d.maxRuns ?? MAX_RUNS) && !evictOne())) throw new RunsFullError();
  const mandate: Mandate = { ...DEFAULT_MANDATE, userRequest: input.userRequest };
  const id = crypto.randomUUID();
  // B1: Simulated runs are scripted, so the inspector stays regex-only (null) unless a test injects an llm.
  const guard = createGuard({
    mandate, ...d.guard, llm: d.guard?.llm ?? (input.mode === "redteam" ? null : undefined), payerUrls: payerUrlsFor(id, origin),
  });
  const ownerToken = randomBytes(32).toString("base64url");
  const run: Run = {
    id, mode: input.mode, mandate, guard, messages: [], listeners: new Set(), ended: false, ownerHash: sha256(ownerToken),
  };
  runs.set(run.id, run);
  kickOrphanSweep(d);
  // Feature-detected: guard.notePageRead lands with the guard's page-provenance fix (FINDINGS #2).
  const notePageRead = (guard as { notePageRead?: (slug: string) => void }).notePageRead;

  guard.subscribe((state) => {
    syncResolvePoll(run, state, d.resolveEveryMs ?? 30_000);
    push(run, { kind: "guard", state });
  });
  void Promise.resolve()
    .then(() =>
      d.runners[input.mode]({
        userRequest: mandate.userRequest,
        mandateSummary: summarize(mandate),
        onProposeOrder: async (order) => {
          // m6: no new money once the shutdown sweep began; an authorize already in flight is voided as it lands.
          if (g.__cartholdShuttingDown) return "BLOCKED by CartHold: server shutting down";
          const result = await guard.onProposeOrder(order);
          if (g.__cartholdShuttingDown) await Promise.allSettled(guard.getState().pendingHolds.map((id) => guard.systemVoid(id)));
          return result;
        },
        onPageRead: notePageRead ? (slug) => notePageRead.call(guard, slug) : undefined,
        onEvent: (event) => push(run, { kind: "agent", event }),
      }),
    )
    .catch((e) => {
      console.error(`run ${run.id} failed:`, e);
      push(run, { kind: "agent", event: { type: "done", reason: "error", error: "run failed, try again" } });
    })
    .finally(() => {
      run.ended = true;
      run.endedAt = now();
      push(run, { kind: "end" });
    });
  return { run, ownerToken };
}

/** Replays history, then the current guard state, then live messages. Returns unsubscribe. */
export function subscribeRun(run: Run, listener: (m: StreamMsg) => void): () => void {
  const unsubscribe = () => void run.listeners.delete(listener);
  for (const m of [...run.messages, { kind: "guard", state: run.guard.getState() } as StreamMsg])
    if (!deliver(run, listener, m)) return unsubscribe;
  run.listeners.add(listener);
  return unsubscribe;
}

/** A verified PayPal webhook event, offered to every run's guard (ids are unique, so at most one row matches). */
export async function applyPayPalEvent(e: PayPalEvent): Promise<boolean> {
  const changed = await Promise.all([...runs.values()].map((r: Run) => r.guard.applyPayPalEvent(e)));
  return changed.some(Boolean);
}

/**
 * Voids every pending hold in every run (shutdown sweep, B3). Waits at most capMs; never throws.
 * ponytail: best-effort only. A crash or kill -9 still orphans holds; PayPal's own authorization expiry is the
 * backstop until kickOrphanSweep (next process, first run) voids them from PayPal's event log.
 */
export async function voidAllHolds(capMs = 8_000): Promise<void> {
  g.__cartholdShuttingDown = true; // m6: createRun refuses and proposals are blocked from here on
  const sweep = () =>
    Promise.allSettled([...runs.values()].flatMap((r: Run) => r.guard.getState().pendingHolds.map((id: string) => r.guard.systemVoid(id))));
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Second pass catches holds that landed during the first (an authorize in flight when the flag flipped).
  await Promise.race([sweep().then(sweep), new Promise((r) => (timer = setTimeout(r, capMs)))]);
  clearTimeout(timer);
}

// Render sends SIGTERM on redeploy / spin-down; the in-process auto-void timers would die with the process.
// src/instrumentation.ts owns the SIGTERM handler (registered at boot, NEXT_MANUAL_SIG_HANDLE=1 in render.yaml) and
// calls this. Published on globalThis instead of imported: this module's PayPal imports are "server-only".
(globalThis as unknown as { __cartholdVoidAll?: () => Promise<unknown> }).__cartholdVoidAll = () => voidAllHolds();
