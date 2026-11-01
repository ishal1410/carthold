// POST /api/paypal/webhook handler: fail closed without PAYPAL_WEBHOOK_ID, verify every event with PayPal's
// verify-webhook-signature postback (raw body posted back verbatim), replay-safe by event id.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MAX_HOLD_LIFETIME_MS } from "../guard/guard";
import { resetLimits } from "../run/limits";
import { resetTokenCache } from "./client";
import { handleWebhook, rfc3339, sweepOrphanedHolds, toPayPalEvent } from "./webhook";

const HEADERS = {
  "content-type": "application/json",
  "paypal-transmission-id": "tx-1",
  "paypal-transmission-time": new Date().toISOString(),
  "paypal-transmission-sig": "sig==",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
  "paypal-auth-algo": "SHA256withRSA",
};
let n = 0;
const voided = (id = `WH-${++n}`) => ({
  id,
  event_type: "PAYMENT.AUTHORIZATION.VOIDED",
  resource_type: "authorization",
  resource: { id: "A1", status: "VOIDED", supplementary_data: { related_ids: { order_id: "O1" } } },
});
const req = (body: string, headers: Record<string, string> = HEADERS) =>
  new Request("https://carthold.onrender.com/api/paypal/webhook", { method: "POST", headers, body });

/** PayPal sandbox stand-in: OAuth token + verify-webhook-signature answering `status`. Records verify bodies. */
function paypalStub(status: "SUCCESS" | "FAILURE" | 500 = "SUCCESS") {
  const verifyBodies: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "tok", expires_in: 3600 });
    if (url.endsWith("/v1/notifications/verify-webhook-signature")) {
      verifyBodies.push(String(init.body));
      return status === 500 ? new Response("{}", { status: 500 }) : Response.json({ verification_status: status });
    }
    throw new Error(`unexpected ${url}`);
  }));
  return verifyBodies;
}

beforeEach(() => {
  resetTokenCache();
  resetLimits();
  vi.stubEnv("PAYPAL_CLIENT_ID", "id");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret");
  vi.stubEnv("PAYPAL_WEBHOOK_ID", "WH123");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("handleWebhook", () => {
  it("503 when PAYPAL_WEBHOOK_ID is not set (fail closed, PayPal never called, nothing applied)", async () => {
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "");
    paypalStub();
    const apply = vi.fn();
    const res = await handleWebhook(req(JSON.stringify(voided())), apply);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "webhooks not configured" });
    expect(fetch).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("verified event: posts the raw body back verbatim with the transmission headers + webhook_id, then applies it", async () => {
    const bodies = paypalStub();
    const apply = vi.fn(async () => true);
    const raw = JSON.stringify(voided("WH-raw"), null, 2); // pretty-printed: must reach PayPal byte-for-byte, not re-serialized
    const res = await handleWebhook(req(raw), apply);
    expect(res.status).toBe(200);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain(`"webhook_event":${raw}`);
    expect(JSON.parse(bodies[0])).toMatchObject({
      auth_algo: "SHA256withRSA", cert_url: HEADERS["paypal-cert-url"], transmission_id: "tx-1",
      transmission_sig: "sig==", transmission_time: HEADERS["paypal-transmission-time"], webhook_id: "WH123",
    });
    expect(apply).toHaveBeenCalledWith({ type: "PAYMENT.AUTHORIZATION.VOIDED", authorizationId: "A1", orderId: "O1", status: "VOIDED" });
  });

  it("401 when PayPal says FAILURE; the payload is never applied", async () => {
    paypalStub("FAILURE");
    const apply = vi.fn();
    const res = await handleWebhook(req(JSON.stringify(voided())), apply);
    expect(res.status).toBe(401);
    expect(apply).not.toHaveBeenCalled();
  });

  it("400 when a transmission header is missing (no verify call)", async () => {
    paypalStub();
    const apply = vi.fn();
    const noSig = Object.fromEntries(Object.entries(HEADERS).filter(([k]) => k !== "paypal-transmission-sig"));
    const res = await handleWebhook(req(JSON.stringify(voided()), noSig), apply);
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("502 when the verify call itself fails (PayPal retries the delivery), not applied", async () => {
    paypalStub(500);
    const apply = vi.fn();
    expect((await handleWebhook(req(JSON.stringify(voided())), apply)).status).toBe(502);
    expect(apply).not.toHaveBeenCalled();
  });

  it("replay of the same event id is acknowledged but applied once", async () => {
    paypalStub();
    const apply = vi.fn(async () => true);
    const body = JSON.stringify(voided("WH-replay"));
    expect((await handleWebhook(req(body), apply)).status).toBe(200);
    const again = await handleWebhook(req(body), apply);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("an event whose apply throws is not marked seen, so PayPal's retry is processed", async () => {
    paypalStub();
    const apply = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(true);
    const body = JSON.stringify(voided("WH-retry"));
    expect((await handleWebhook(req(body), apply)).status).toBe(500);
    expect((await handleWebhook(req(body), apply)).status).toBe(200);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it("413 over the body cap, 400 on non-JSON", async () => {
    paypalStub();
    const apply = vi.fn();
    expect((await handleWebhook(req("x".repeat(70_000)), apply)).status).toBe(413);
    expect((await handleWebhook(req("not json"), apply)).status).toBe(400);
    expect(apply).not.toHaveBeenCalled();
  });

  it("m1: paypal-cert-url not https on paypal.com / *.paypal.com -> 400, never verified", async () => {
    paypalStub();
    const apply = vi.fn();
    for (const cert of ["https://evil.example/cert", "http://api.paypal.com/cert", "https://paypal.com.evil.example/c", "https://evilpaypal.com/c", "not a url"]) {
      expect((await handleWebhook(req(JSON.stringify(voided()), { ...HEADERS, "paypal-cert-url": cert }), apply)).status).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect((await handleWebhook(req(JSON.stringify(voided()), { ...HEADERS, "paypal-cert-url": "https://api.paypal.com/v1/notifications/certs/C" }), vi.fn())).status).toBe(200);
  });

  it("m1/L2: per-IP limit (20/min) answers 429 before any PayPal call", async () => {
    const bodies = paypalStub("FAILURE");
    const apply = vi.fn();
    const from = (ip: string) => req(JSON.stringify(voided()), { ...HEADERS, "x-forwarded-for": ip });
    for (let i = 0; i < 20; i++) expect((await handleWebhook(from("9.9.9.9"), apply)).status).toBe(401);
    expect((await handleWebhook(from("9.9.9.9"), apply)).status).toBe(429);
    expect(bodies).toHaveLength(20);
    expect((await handleWebhook(from("8.8.8.8"), apply)).status).toBe(401); // other address unaffected
  });

  it("L2: global cap (120/min across all addresses) answers 429 before any PayPal call", async () => {
    const bodies = paypalStub("FAILURE");
    const from = (ip: string) => req(JSON.stringify(voided()), { ...HEADERS, "x-forwarded-for": ip });
    for (let ip = 0; ip < 6; ip++) for (let i = 0; i < 20; i++) expect((await handleWebhook(from(`7.7.7.${ip}`), vi.fn())).status).toBe(401);
    expect((await handleWebhook(from("6.6.6.6"), vi.fn())).status).toBe(429);
    expect(bodies).toHaveLength(120);
  });

  it("m2: paypal-transmission-time older than 3 days or unparseable -> 400, never verified", async () => {
    paypalStub();
    const apply = vi.fn();
    const old = new Date(Date.now() - 3 * 86_400_000 - 60_000).toISOString();
    for (const t of [old, "yesterday-ish"]) {
      expect((await handleWebhook(req(JSON.stringify(voided()), { ...HEADERS, "paypal-transmission-time": t }), apply)).status).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString(); // PayPal retries for up to 3 days
    expect((await handleWebhook(req(JSON.stringify(voided()), { ...HEADERS, "paypal-transmission-time": recent }), apply)).status).toBe(200);
  });

  it("verified event of a type CartHold does not handle: 200, not applied", async () => {
    paypalStub();
    const apply = vi.fn();
    const res = await handleWebhook(req(JSON.stringify({ id: "WH-other", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "O1" } })), apply);
    expect(res.status).toBe(200);
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("toPayPalEvent (resource shapes: Payments v2 authorization / capture, supplementary_data.related_ids)", () => {
  it("authorization: resource.id is the authorization id", () => {
    expect(toPayPalEvent({ event_type: "PAYMENT.AUTHORIZATION.CREATED", resource: { id: "A9", status: "CREATED", supplementary_data: { related_ids: { order_id: "O9" } } } }))
      .toEqual({ type: "PAYMENT.AUTHORIZATION.CREATED", authorizationId: "A9", orderId: "O9", status: "CREATED" });
  });
  it("capture: resource.id is the capture id, authorization from related_ids", () => {
    expect(toPayPalEvent({ event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "C9", status: "COMPLETED", supplementary_data: { related_ids: { order_id: "O9", authorization_id: "A9" } } } }))
      .toEqual({ type: "PAYMENT.CAPTURE.COMPLETED", captureId: "C9", authorizationId: "A9", orderId: "O9", status: "COMPLETED" });
  });
  it("unhandled type or no resource id: null", () => {
    expect(toPayPalEvent({ event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "O1" } })).toBeNull();
    expect(toPayPalEvent({ event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} })).toBeNull();
  });
});

describe("sweepOrphanedHolds (crash recovery from PayPal's own event log)", () => {
  const BOOT = Date.parse("2026-10-31T12:00:00Z");
  const ev = (auth: string, order: string, created: string) => ({
    id: `E-${auth}`, create_time: created, event_type: "PAYMENT.AUTHORIZATION.CREATED",
    resource: { id: auth, status: "CREATED", supplementary_data: { related_ids: { order_id: order } } },
  });
  const order = (id: string, auth: string, status: string, description = "CartHold: Brew & Bean") => ({
    id, status: "COMPLETED", purchase_units: [{ description, payments: { authorizations: [{ id: auth, status }] } }],
  });
  function stub() {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${new URL(url).pathname}${new URL(url).search}`);
      const path = new URL(url).pathname;
      if (path === "/v1/oauth2/token") return Response.json({ access_token: "t", expires_in: 3600 });
      if (path === "/v1/notifications/webhooks-events") {
        const page2 = new URL(url).searchParams.get("page") === "2";
        return Response.json(page2
          ? { events: [ev("A5", "O5", "2026-10-31T11:00:00Z")] }
          : {
            events: [ev("A1", "O1", "2026-10-31T11:00:00Z"), ev("A2", "O2", "2026-10-31T11:00:00Z"), ev("A3", "O3", "2026-10-31T11:00:00Z"), ev("A4", "O4", "2026-10-31T12:00:05Z"), ev("A6", "O6", "2026-10-31T11:55:00Z")],
            links: [{ rel: "next", href: "https://api-m.sandbox.paypal.com/v1/notifications/webhooks-events?page=2" }],
          });
      }
      const m = /^\/v2\/checkout\/orders\/(O\d)$/.exec(path);
      if (m) return Response.json({ O1: order("O1", "A1", "CREATED"), O2: order("O2", "A2", "VOIDED"), O3: order("O3", "A3", "CREATED", "someone else's shop"), O4: order("O4", "A4", "CREATED"), O5: order("O5", "A5", "CREATED"), O6: order("O6", "A6", "CREATED") }[m[1]]);
      if (/^\/v2\/payments\/authorizations\/A\d\/void$/.test(path)) return new Response(null, { status: 204 });
      throw new Error(`unexpected ${url}`);
    }));
    return calls;
  }

  it("voids only CartHold authorizations still CREATED, older than any live hold can be, unknown to any run", async () => {
    const calls = stub();
    const voided = await sweepOrphanedHolds({ isKnown: (a) => a === "A5", now: BOOT + 60_000 });
    expect(voided).toEqual(["A1"]);
    expect(calls.filter((c) => c.endsWith("/void"))).toEqual(["POST /v2/payments/authorizations/A1/void"]);
    const list = calls.find((c) => c.startsWith("GET /v1/notifications/webhooks-events"))!;
    expect(list).toContain("event_type=PAYMENT.AUTHORIZATION.CREATED");
    expect(list).toContain("start_time=2026-10-01T12%3A01%3A00Z"); // no fractional seconds: PayPal 400s on ".000Z" // 30 days back: authorizations are valid 29 days
    expect(calls).not.toContain("GET /v2/checkout/orders/O4"); // authorized after boot: belongs to this process
    // M1: A6 is 5 min before boot, younger than the max hold lifetime: maybe a live hold of another instance
    // (zero-downtime deploy overlap) or a local dev run. Never voided, never even looked up.
    expect(calls).not.toContain("GET /v2/checkout/orders/O6");
    expect(list).toContain(`end_time=${encodeURIComponent(rfc3339(BOOT + 60_000 - MAX_HOLD_LIFETIME_MS - 60_000))}`);
    expect(list).not.toMatch(/\.\d{3}Z/);
    expect(calls).toContain("GET /v1/notifications/webhooks-events?page=2"); // followed links rel=next
  });

  it("live incident 2026-10-31: a hold made by an instance killed mid-deploy is voided once it is older than the max lifetime, even though it is younger than this process", async () => {
    const calls = stub();
    // A4 was authorized 5 s AFTER this process booted (the old instance was still serving during the deploy overlap).
    const voided = await sweepOrphanedHolds({ isKnown: () => false, now: Date.parse("2026-10-31T12:00:05Z") + MAX_HOLD_LIFETIME_MS + 61_000 });
    expect(voided).toContain("A4");
    expect(calls).toContain("POST /v2/payments/authorizations/A4/void");
  });

  it("never throws: a PayPal failure just ends the sweep", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await expect(sweepOrphanedHolds({ isKnown: () => false })).resolves.toEqual([]);
  });
});
