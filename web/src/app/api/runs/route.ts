import { CreateRunSchema, RunsFullError, createRun } from "../../../lib/run/session";
import { fail, json, readJsonPost } from "../../../lib/run/http";
import { clientIp, refundIpSlot, refundLiveSlot, refundSimulatedSlot, takeIpSlot, takeLiveSlot, takeSimulatedSlot } from "../../../lib/run/limits";

let warnedNoOrigin = false;

export async function POST(req: Request) {
  const read = await readJsonPost(req);
  if (read instanceof Response) return read;
  const parsed = CreateRunSchema.safeParse(read.body);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return fail(400, `invalid body: ${i.path.join(".") || "body"}: ${i.message}`);
  }
  // R4 #3: slot taken only for a valid request, so junk bodies never create (or burn) a window.
  const ip = clientIp(req);
  if (!takeIpSlot(ip)) return fail(429, "too many runs from this address, try again in a few minutes");
  const live = parsed.data.mode === "live";
  if (live && !takeLiveSlot())
    return fail(429, "daily live run limit reached, try the Simulated compromised agent or come back tomorrow");
  if (!live && !takeSimulatedSlot())
    return fail(429, "daily demo limit reached, try the recorded run at /demo?fixture=1 or come back tomorrow");
  try {
    // PayPal sends the buyer back here after approving a hold. PUBLIC_ORIGIN when set (behind Render / Cloudflare).
    // A4: in production req.url may be the proxy's internal origin, so no PUBLIC_ORIGIN -> no origin -> card hold.
    let origin = process.env.PUBLIC_ORIGIN?.trim().replace(/\/+$/, "") || undefined;
    if (!origin && process.env.NODE_ENV !== "production") origin = new URL(req.url).origin;
    if (!origin && !warnedNoOrigin) {
      warnedNoOrigin = true;
      console.warn("[carthold] PUBLIC_ORIGIN unset in production: PayPal-approval holds disabled, using card holds");
    }
    const { run, ownerToken } = createRun(parsed.data, { origin });
    return json({ runId: run.id, ownerToken }, 201);
  } catch (e) {
    if (e instanceof RunsFullError) {
      // B11: no run was created, so neither slot was used.
      refundIpSlot(ip);
      if (live) refundLiveSlot();
      else refundSimulatedSlot();
      return fail(503, e.message);
    }
    throw e;
  }
}
