import { z } from "zod";
import { getRun, isOwner } from "../../../../../../lib/run/session";
import { fail, json, readJsonPost } from "../../../../../../lib/run/http";
import { clientIp, takeHoldSlot } from "../../../../../../lib/run/limits";

const Body = z.object({ action: z.enum(["approve", "reject"]) });

export async function POST(req: Request, ctx: { params: Promise<{ runId: string; rowId: string }> }) {
  // R4 #3: origin/content-type/body checks first; a cross-origin or text/plain POST never consumes the hold slot.
  const read = await readJsonPost(req);
  if (read instanceof Response) return read;
  const { runId, rowId } = await ctx.params;
  const run = getRun(runId);
  if (!run) return fail(404, "unknown run");
  // Owner capability: the runId is in the shareable /demo URL, so knowing it must not be enough to move money.
  const token = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? null;
  if (!isOwner(run, token)) return fail(403, "only the person who started this run can approve or reject its holds");
  // Slot only after the owner check: token-less viewers behind the owner's NAT can't burn the owner's 30/min.
  if (!takeHoldSlot(clientIp(req))) return fail(429, "too many approval requests from this address, slow down");
  const body = Body.safeParse(read.body);
  if (!body.success) return fail(400, 'invalid body: action must be "approve" or "reject"');
  try {
    await (body.data.action === "approve" ? run.guard.approve(rowId) : run.guard.reject(rowId));
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.startsWith("no pending hold")) return fail(409, msg);
    throw e;
  }
  return json({ state: run.guard.getState() });
}
