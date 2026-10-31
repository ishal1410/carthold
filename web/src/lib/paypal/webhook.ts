// PayPal webhook receiver (server only). Every event is verified by PayPal itself before anything is trusted.
// Sources:
//  - Webhooks v1 spec https://developer.paypal.com/api/webhooks/v1/schema.json
//    POST /v1/notifications/verify-webhook-signature, required: auth_algo, cert_url, transmission_id, transmission_sig,
//    transmission_time, webhook_id, webhook_event. auth_algo: "Extract this value from the `PAYPAL-AUTH-ALGO` response
//    header"; cert_url: "from the `PAYPAL-CERT-URL` response header"; webhook_id: "The ID of the webhook as configured in
//    your Developer Portal account." Response verification_status enum: SUCCESS | FAILURE.
//  - Integration guide https://developer.paypal.com/api/rest/webhooks/rest/
//    "rather than verifying the signature yourself you can post the event back to the verify-webhook-signature REST API
//    endpoint" ... "It is essential that the webhook_event data be posted back exactly as it was received."
//    The listener "must respond with an HTTP 2xx success status every time one is posted."
//    "PayPal will retry each delivery up to 25 times over 3 days."
//    The webhook id "does not come in the header or body of the message" -> env PAYPAL_WEBHOOK_ID.
//  - Payments v2 spec https://developer.paypal.com/api/payments/v2/schema.json: authorization / capture resources carry
//    supplementary_data.related_ids { order_id, authorization_id, capture_id }.
//  - Event names https://developer.paypal.com/api/rest/webhooks/event-names/: PAYMENT.CAPTURE.DENIED is listed under
//    Payments v1; the v2 table has PAYMENT.CAPTURE.DECLINED ("A payment capture is declined"). Both are handled.
import "server-only";
import { isPayPalUrl, MAX_HOLD_LIFETIME_MS, type PayPalEvent } from "../guard/guard";
import { fail, json } from "../run/http";
import { clientIp, takeWebhookSlot } from "../run/limits";
import { baseUrl, getAccessToken, paypalFetch } from "./client";
import { voidAuthorization } from "./orders";

export const WEBHOOK_EVENT_TYPES = [
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.DECLINED",
] as const;

/** PayPal event bodies are a few KB; anything far larger is not PayPal. */
const MAX_WEBHOOK_BYTES = 64 * 1024;
const SEEN_MAX = 1000;
// ponytail: in-memory, bounded, oldest-first eviction. A restart forgets it; replays are harmless anyway because
// guard.applyPayPalEvent is a no-op when the row already matches.
const seen = new Set<string>();

type RawEvent = {
  id?: unknown;
  event_type?: unknown;
  resource?: { id?: unknown; status?: unknown; supplementary_data?: { related_ids?: Record<string, unknown> } };
};
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** Verified event -> the ids the guard matches rows by. null: not an event CartHold acts on. */
export function toPayPalEvent(event: unknown): PayPalEvent | null {
  const e = (event ?? {}) as RawEvent;
  const type = str(e.event_type);
  const id = str(e.resource?.id);
  if (!type || !id || !(WEBHOOK_EVENT_TYPES as readonly string[]).includes(type)) return null;
  const rel = e.resource?.supplementary_data?.related_ids ?? {};
  const out: PayPalEvent = type.startsWith("PAYMENT.CAPTURE.")
    ? { type, captureId: id, authorizationId: str(rel.authorization_id) }
    : { type, authorizationId: id };
  if (str(rel.order_id)) out.orderId = str(rel.order_id);
  if (str(e.resource?.status)) out.status = str(e.resource?.status);
  if (!out.authorizationId) delete out.authorizationId;
  return out;
}

const HEADER_FIELDS = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

/** Postback verification. The raw body is spliced in as-is (never parsed and re-stringified). Throws if PayPal errs. */
async function verify(headers: Record<string, string>, raw: string, webhookId: string): Promise<boolean> {
  const fields = JSON.stringify({ ...headers, webhook_id: webhookId });
  const body = `${fields.slice(0, -1)},"webhook_event":${raw}}`;
  const res = await fetch(`${baseUrl()}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await getAccessToken()}`, "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`verify-webhook-signature -> ${res.status}`);
  return ((await res.json()) as { verification_status?: string }).verification_status === "SUCCESS";
}

const DAY = 86_400_000;
/** PayPal retries a delivery for up to 3 days; an older transmission is a replay. */
const MAX_TRANSMISSION_AGE_MS = 3 * DAY;
/** Margin on top of MAX_HOLD_LIFETIME_MS for clock skew and in-flight calls. */
const ORPHAN_MARGIN_MS = 60_000;
const CARTHOLD_PREFIX = "CartHold:"; // orders.ts purchaseUnit description
type RawOrder = { purchase_units?: { description?: string; payments?: { authorizations?: { id: string; status: string }[] } }[] };

/**
 * Crash recovery without a database: PayPal already stores every authorization CartHold made, as
 * PAYMENT.AUTHORIZATION.CREATED events (GET /v1/notifications/webhooks-events, filters event_type / start_time /
 * end_time, "Lists webhooks event notifications"; spec link above). Holds live only in process memory, so a CartHold
 * authorization made before this process booted, still CREATED, and unknown to every run, was orphaned by a crash:
 * void it. Only authorizations older than MAX_HOLD_LIFETIME_MS + margin before boot count: a younger one may be a live
 * hold of another instance (Render zero-downtime deploy overlap) or a local dev run on the same sandbox app. Window is 30 days (an authorization is valid 29). Best effort: never throws; returns the voided ids.
 * ponytail: 10 pages max and serial calls; enough for a demo app's volume, page further if that ever falls short.
 */
export async function sweepOrphanedHolds(o: { isKnown: (authId: string) => boolean; now?: number }): Promise<string[]> {
  const voided: string[] = [];
  // No live hold can outlive MAX_HOLD_LIFETIME_MS (awaiting + held windows), in this process or any other, so an
  // older CartHold authorization still CREATED is orphaned whoever made it (e.g. an instance killed mid-deploy).
  const cutoff = (o.now ?? Date.now()) - MAX_HOLD_LIFETIME_MS - ORPHAN_MARGIN_MS;
  const q = new URLSearchParams({
    event_type: "PAYMENT.AUTHORIZATION.CREATED",
    start_time: new Date((o.now ?? Date.now()) - 30 * DAY).toISOString(),
    end_time: new Date(cutoff).toISOString(),
    page_size: "50",
  });
  let path: string | undefined = `/v1/notifications/webhooks-events?${q}`;
  try {
    for (let page = 0; path && page < 10; page++) {
      const list: { events?: { create_time?: string; resource?: RawEvent["resource"] }[]; links?: { rel: string; href: string }[] } =
        await paypalFetch(path, { method: "GET" });
      for (const ev of list.events ?? []) {
        const authId = str(ev.resource?.id);
        const orderId = str(ev.resource?.supplementary_data?.related_ids?.order_id);
        if (!authId || !orderId || !(Date.parse(ev.create_time ?? "") < cutoff) || o.isKnown(authId)) continue;
        const unit = (await paypalFetch<RawOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { method: "GET" })).purchase_units?.[0];
        const auth = unit?.payments?.authorizations?.find((a) => a.id === authId);
        if (!unit?.description?.startsWith(CARTHOLD_PREFIX) || auth?.status !== "CREATED") continue;
        await voidAuthorization(authId, `orphan-${authId}`.slice(0, 38));
        voided.push(authId);
      }
      const next = list.links?.find((l) => l.rel === "next")?.href;
      path = next ? new URL(next).pathname + new URL(next).search : undefined;
    }
  } catch (e) {
    console.error("[carthold] orphaned-hold sweep stopped:", e);
  }
  if (voided.length) console.error(`[carthold] voided ${voided.length} orphaned hold(s): ${voided.join(", ")}`);
  return voided;
}

/** Body as text, or null once it passes MAX_WEBHOOK_BYTES (stream cancelled). */
async function readCapped(req: Request): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_WEBHOOK_BYTES) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_WEBHOOK_BYTES) {
      void reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Whole webhook flow. No Origin / content-type checks on purpose: PayPal (not a browser) calls this, and the
 * signature postback is the authentication. Non-2xx answers make PayPal retry, so only transient failures get 5xx.
 */
export async function handleWebhook(req: Request, apply: (e: PayPalEvent) => Promise<unknown>): Promise<Response> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim();
  if (!webhookId) return fail(503, "webhooks not configured");
  // m1: every request below this line may cost a PayPal OAuth + verify call; cap it per address first.
  if (!takeWebhookSlot(clientIp(req))) return fail(429, "too many webhook requests from this address");
  const raw = await readCapped(req);
  if (raw === null) return fail(413, "request body too large");
  let event: RawEvent;
  try {
    event = JSON.parse(raw) as RawEvent;
  } catch {
    return fail(400, "body is not JSON");
  }
  const headers: Record<string, string> = {};
  for (const [field, h] of Object.entries(HEADER_FIELDS)) {
    const v = req.headers.get(h);
    if (!v) return fail(400, `missing ${h} header`);
    headers[field] = v;
  }
  // m1/m2: cheap local checks before the PayPal round trip. PayPal's cert lives on paypal.com over https; a
  // transmission older than PayPal's 3-day retry window (or unparseable) is not a live delivery.
  if (!isPayPalUrl(headers.cert_url)) return fail(400, "paypal-cert-url is not a PayPal https URL");
  const sentAt = Date.parse(headers.transmission_time);
  if (!(Date.now() - sentAt <= MAX_TRANSMISSION_AGE_MS)) return fail(400, "paypal-transmission-time missing or too old");
  let ok: boolean;
  try {
    ok = await verify(headers, raw, webhookId);
  } catch (e) {
    console.error("[carthold] webhook verification call failed:", e);
    return fail(502, "could not verify webhook signature");
  }
  if (!ok) return fail(401, "webhook signature verification failed");

  const eventId = str(event.id);
  if (eventId && seen.has(eventId)) return json({ ok: true, duplicate: true });
  const pe = toPayPalEvent(event);
  if (pe) {
    try {
      await apply(pe);
    } catch (e) {
      console.error("[carthold] webhook apply failed:", e);
      return fail(500, "could not apply event"); // not marked seen: PayPal's retry gets another go
    }
  }
  if (eventId) {
    seen.add(eventId);
    if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value!);
  }
  return json({ ok: true });
}
