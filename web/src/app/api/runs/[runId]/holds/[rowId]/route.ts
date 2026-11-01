import { z } from "zod";
import { getRun, isOwner } from "../../../../../../lib/run/session";
import { fail, json, readJsonPost } from "../../../../../../lib/run/http";
import { clientIp, takeHoldSlot } from "../../../../../../lib/run/limits";

// payer-approved: PayPal sent the buyer back with token=<order id>; the guard checks it is this row's order, then authorizes.
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["approve", "reject"]) }),
  z.object({ action: z.literal("payer-approved"), orderId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/) }),
]);

const bearer = (req: Request) => /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? null;

/** m5: the payer-action link, owner only (the SSE stream never carries it). Browsers never attach a Bearer header
 * cross-site on their own, so this read needs no Origin check. */
export async function GET(req: Request, ctx: { params: Promise<{ runId: string; rowId: string }> }) {
  const { runId, rowId } = await ctx.params;
  const run = getRun(runId);
  if (!run) return fail(404, "unknown run");
  if (!isOwner(run, bearer(req))) return fail(403, "only the person who started this run can approve its holds");
  if (!takeHoldSlot(clientIp(req))) return fail(429, "too many approval requests from this address, slow down");
  const row = run.guard.getState().rows.find((r) => r.id === rowId);
  if (row?.status !== "awaiting_payer" || !row.payerActionUrl) return fail(409, `no pending hold ${rowId} waiting for PayPal approval`);
  return json({ payerActionUrl: row.payerActionUrl });
}

export async function POST(req: Request, ctx: { params: Promise<{ runId: string; rowId: string }> }) {
  // R4 #3: origin/content-type/body checks first; a cross-origin or text/plain POST never consumes the hold slot.
  const read = await readJsonPost(req);
  if (read instanceof Response) return read;
  const { runId, rowId } = await ctx.params;
  const run = getRun(runId);
  if (!run) return fail(404, "unknown run");
  // Owner capability: the runId is in the shareable /demo URL, so knowing it must not be enough to move money.
  if (!isOwner(run, bearer(req))) return fail(403, "only the person who started this run can approve or reject its holds");
  // Slot only after the owner check: token-less viewers behind the owner's NAT can't burn the owner's 30/min.
  if (!takeHoldSlot(clientIp(req))) return fail(429, "too many approval requests from this address, slow down");
  const body = Body.safeParse(read.body);
  if (!body.success) return fail(400, 'invalid body: action must be "approve", "reject" or "payer-approved" (with orderId)');
  const b = body.data;
  try {
    await (b.action === "payer-approved" ? run.guard.payerApproved(rowId, b.orderId) : b.action === "approve" ? run.guard.approve(rowId) : run.guard.reject(rowId));
  } catch (e) {
    const msg = (e as Error).message;
    if (/^(no pending hold|not approved in PayPal yet|approval window expired)/.test(msg)) return fail(409, msg);
    if (msg.startsWith("order id does not match")) return fail(400, msg);
    throw e;
  }
  return json({ state: run.guard.getState() });
}
