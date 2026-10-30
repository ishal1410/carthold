import { CreateRunSchema, RunsFullError, createRun } from "../../../lib/run/session";
import { fail, json, readJsonPost } from "../../../lib/run/http";
import { clientIp, takeIpSlot, takeLiveSlot } from "../../../lib/run/limits";

export async function POST(req: Request) {
  const read = await readJsonPost(req);
  if (read instanceof Response) return read;
  const parsed = CreateRunSchema.safeParse(read.body);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return fail(400, `invalid body: ${i.path.join(".") || "body"}: ${i.message}`);
  }
  // R4 #3: slot taken only for a valid request, so junk bodies never create (or burn) a window.
  if (!takeIpSlot(clientIp(req))) return fail(429, "too many runs from this address, try again in a few minutes");
  if (parsed.data.mode === "live" && !takeLiveSlot())
    return fail(429, "daily live run limit reached, try the Simulated compromised agent or come back tomorrow");
  try {
    return json({ runId: createRun(parsed.data).id }, 201);
  } catch (e) {
    if (e instanceof RunsFullError) return fail(503, e.message);
    throw e;
  }
}
