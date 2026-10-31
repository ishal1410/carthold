// In-memory run registry: one guard + one agent run per runId, with a message log for SSE replay.
// Lives on globalThis so dev HMR doesn't drop runs (and their pending holds) mid-demo.
import { z } from "zod";
import { runAgent, type AgentEvent, type RunAgentOptions } from "../agent/agent";
import { createGuard, type Guard, type GuardOptions, type GuardState } from "../guard/guard";
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
};

/** Thrown by createRun when every stored run is still running or has a pending hold. */
export class RunsFullError extends Error {
  constructor() {
    super("server busy: too many active runs, try again shortly");
  }
}

const defaultDeps: RunDeps = {
  runners: { live: (o) => runAgent({ ...o, persona: "realistic" }), redteam: runRedteam },
};

const g = globalThis as unknown as { __cartholdRuns?: Map<string, Run>; __cartholdDeps?: RunDeps };
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
}; // test seam

const unknownRowIds = (state: GuardState) => state.rows.filter((r) => r.status === "unknown").map((r) => r.id);
// Feature-detected: guard flags rows it gave up resolving in state.unresolvable (R3 #5).
const unresolvableIds = (state: GuardState) => new Set((state as { unresolvable?: string[] }).unresolvable ?? []);
/** Unknown rows still worth polling PayPal for. */
const pollableIds = (state: GuardState) => {
  const dead = unresolvableIds(state);
  return unknownRowIds(state).filter((id) => !dead.has(id));
};

/** Nothing left that can change: agent finished, no pending hold, no money in "unknown". Streams may close. */
export function isSettled(run: Run): boolean {
  const s = run.guard.getState();
  return run.ended && s.pendingHolds.length === 0 && unknownRowIds(s).length === 0;
}

/** Settled, or ended with no pending hold and only unresolvable unknown rows for UNRESOLVABLE_TTL_MS. */
function isEvictable(run: Run): boolean {
  if (isSettled(run)) return true;
  const s = run.guard.getState();
  return run.ended && s.pendingHolds.length === 0 && pollableIds(s).length === 0 &&
    now() - (run.endedAt ?? Infinity) >= UNRESOLVABLE_TTL_MS;
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

/** Input must already be validated with CreateRunSchema. Starts the run in the background. */
export function createRun(input: CreateRunInput): Run {
  const d = deps();
  if (runs.size >= (d.maxRuns ?? MAX_RUNS) && !evictOne()) throw new RunsFullError();
  const mandate: Mandate = { ...DEFAULT_MANDATE, userRequest: input.userRequest };
  const guard = createGuard({ mandate, ...d.guard });
  const run: Run = { id: crypto.randomUUID(), mode: input.mode, mandate, guard, messages: [], listeners: new Set(), ended: false };
  runs.set(run.id, run);
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
        onProposeOrder: guard.onProposeOrder,
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
  return run;
}

/** Replays history, then the current guard state, then live messages. Returns unsubscribe. */
export function subscribeRun(run: Run, listener: (m: StreamMsg) => void): () => void {
  const unsubscribe = () => void run.listeners.delete(listener);
  for (const m of [...run.messages, { kind: "guard", state: run.guard.getState() } as StreamMsg])
    if (!deliver(run, listener, m)) return unsubscribe;
  run.listeners.add(listener);
  return unsubscribe;
}
