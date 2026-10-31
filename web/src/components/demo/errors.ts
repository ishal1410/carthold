import type { GuardState } from "@/lib/guard/guard";

/**
 * User-facing text for a failed request. Server 4xx `error` strings are written for users, so they show as is;
 * 5xx bodies and thrown errors (network, aborted, JS) can be anything, so they get a generic line.
 */
export function actionError(status?: number, serverMessage?: string): string {
  if (status === undefined) return "Network error, try again.";
  if (status >= 500) return "Server error, try again.";
  return serverMessage || `Request failed (HTTP ${status}).`;
}

const RUN_ERRORS: Record<number, string> = {
  403: "The server rejected this run (cross-site request).",
  413: "That request is too long.",
  415: "The server rejected the request format.",
  429: "Too many runs right now. Wait a minute and try again.",
  503: "The server is busy. Try again in a minute.",
};

/** Text for a failed POST /api/runs. A 4xx server message is shown once; 5xx bodies never are (m4). */
export function runStartError(status: number, serverMessage?: string): string {
  const extra = status < 500 && serverMessage ? serverMessage : "";
  const mapped = RUN_ERRORS[status];
  if (mapped) return extra ? `${mapped} ${extra}` : mapped;
  if (status >= 500) return "Run did not start. Server error, try again.";
  return extra ? `Run did not start: ${extra}` : `Run did not start (HTTP ${status}).`;
}

/**
 * Client copy of the server's isSettled (lib/run/session.ts) minus the run-ended check (m5): nothing left that can
 * change while no hold is pending, no row is held, pending or awaiting PayPal approval, and every unknown row is one the guard gave up on.
 */
export function runSettled(g: GuardState): boolean {
  const dead = new Set(g.unresolvable ?? []);
  return g.pendingHolds.length === 0 && !g.rows.some((r) => r.status === "held" || r.status === "pending" || r.status === "awaiting_payer" || (r.status === "unknown" && !dead.has(r.id)));
}
