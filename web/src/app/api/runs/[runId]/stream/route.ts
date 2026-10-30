import { connection } from "next/server";
import { getRun, isSettled, subscribeRun, type StreamMsg } from "../../../../../lib/run/session";
import { fail } from "../../../../../lib/run/http";
import { acquireStream, clientIp } from "../../../../../lib/run/limits";

const STREAMS_PER_RUN = 10;
// Sent before we close a settled run's stream: EventSource would otherwise reconnect (~3s) and replay forever.
const NO_RECONNECT = "retry: 86400000\n\n";

export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  await connection();
  const run = getRun((await ctx.params).runId);
  if (!run) return fail(404, "unknown run");
  if (run.listeners.size >= STREAMS_PER_RUN) return fail(429, "too many open streams for this run");
  const release = acquireStream(clientIp(req));
  if (!release) return fail(429, "too many open streams from this address");

  const enc = new TextEncoder();
  const frame = (m: StreamMsg) => enc.encode(`data: ${JSON.stringify(m)}\n\n`);
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
