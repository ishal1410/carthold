import { CreateRunSchema, RunsFullError, createRun } from "../../../lib/run/session";
import { fail, json, readJsonPost } from "../../../lib/run/http";
import { clientIp, refundIpSlot, refundLiveSlot, refundSimulatedSlot, takeIpSlot, takeLiveSlot, takeSimulatedSlot } from "../../../lib/run/limits";

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
    const { run, ownerToken } = createRun(parsed.data);
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
