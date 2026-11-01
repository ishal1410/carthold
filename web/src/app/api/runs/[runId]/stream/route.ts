import { connection } from "next/server";
import type { DecisionRow, GuardState } from "../../../../../lib/guard/guard";
import { getRun, isSettled, subscribeRun, type StreamMsg } from "../../../../../lib/run/session";
import { fail } from "../../../../../lib/run/http";
import { acquireStream, clientIp } from "../../../../../lib/run/limits";

const STREAMS_PER_RUN = 10;
// Sent before we close a settled run's stream: EventSource would otherwise reconnect (~3s) and replay forever.
const NO_RECONNECT = "retry: 86400000\n\n";
/** Row fields viewers may see. payerActionUrl is never one (m5): anyone with the run URL can watch, and the link would
 * let a viewer approve with their own PayPal account; the owner gets it from GET /api/runs/:id/holds/:row (Bearer). */
const VIEWER_FIELDS = [
  "id", "time", "merchant", "items", "amountUsd", "verdict", "reasons", "triggeringText", "paypalOrderId", "authorizationId",
  "captureId", "status", "expiresAt", "decision", "unresolvable",
] as const satisfies readonly (keyof DecisionRow)[];

/** cso M1: an order id rebuilds the approve link (checkoutnow?token=<id>), so viewers see it only once the order is
 * authorized (the link is inert by then). Authorization / capture ids stay: using them needs the merchant's API credentials. */
const orderIdVisible = (r: DecisionRow) => !!r.authorizationId && r.status !== "awaiting_payer";

/** One SSE payload for viewers: allowlisted row fields, and hidden order ids scrubbed from the whole message (agent tool
 * results quote them too). Hidden ids come from the current state, which has every row a replayed message can mention. */
function viewerFrame(m: StreamMsg, current: GuardState): string {
  const out: StreamMsg =
    m.kind === "guard"
      ? { ...m, state: { ...m.state, rows: m.state.rows.map((r) => Object.fromEntries(
          VIEWER_FIELDS.filter((k) => k !== "paypalOrderId" || orderIdVisible(r)).map((k) => [k, r[k]]),
        ) as DecisionRow) } }
      : m;
  let text = JSON.stringify(out);
  for (const r of current.rows) if (r.paypalOrderId && !orderIdVisible(r)) text = text.replaceAll(r.paypalOrderId, "[hidden]");
  return text;
}

export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  await connection();
  const run = getRun((await ctx.params).runId);
  if (!run) return fail(404, "unknown run");
  if (run.listeners.size >= STREAMS_PER_RUN) return fail(429, "too many open streams for this run");
  const release = acquireStream(clientIp(req));
  if (!release) return fail(429, "too many open streams from this address");

  const enc = new TextEncoder();
  const frame = (m: StreamMsg) => enc.encode(`data: ${viewerFrame(m, run.guard.getState())}\n\n`);
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      let live = false; // false during history replay: never close mid-replay
      let unsubscribe = () => {};
      cleanup = () => {
        if (!open) return;
        open = false;
        unsubscribe();
        release();
        try {
          controller.close();
        } catch {}
      };
      // Run over and nothing can change any more (no hold, no unknown money): final end, then close.
      const closeIfSettled = () => {
        if (!open || !isSettled(run)) return;
        try {
          controller.enqueue(enc.encode(NO_RECONNECT));
          controller.enqueue(frame({ kind: "end" }));
        } catch {}
        cleanup();
      };
      unsubscribe = subscribeRun(run, (m) => {
        // Throwing makes the session drop this subscriber; it never reaches the agent run (R2-E).
        if (!open) throw new Error("stream closed");
        try {
          controller.enqueue(frame(m));
        } catch (e) {
          cleanup();
          throw e;
        }
        if (live) closeIfSettled();
      });
      live = true;
      req.signal.addEventListener("abort", cleanup);
      closeIfSettled();
    },
    cancel: () => cleanup(),
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
