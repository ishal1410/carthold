import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PayPalNotSentError, baseUrl, getAccessToken, resetTokenCache } from "./client";
import { authorizeOrder, captureAuthorization, createAuthorizeOrder, getOrder, voidAuthorization } from "./orders";

type Call = { url: string; init: RequestInit };
let calls: Call[];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const authorized = (id = "ORDER1", authStatus = "CREATED") => ({
  id,
  status: "COMPLETED",
  purchase_units: [{ payments: { authorizations: [{ id: "AUTH1", status: authStatus, expiration_time: "x" }] } }],
});

/** Route mocked fetch by path; `cardRejected` makes the card create return 422. */
function mockPayPal({ cardRejected = false, createReturnsAuth = false, authStatus = "CREATED" } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const path = new URL(url).pathname;
      if (path === "/v1/oauth2/token") return json({ access_token: "TOKEN", expires_in: 32400 });
      const body = init.body ? JSON.parse(init.body as string) : undefined;
      if (path === "/v2/checkout/orders") {
        if (body.payment_source?.card) {
          if (cardRejected) return json({ name: "UNPROCESSABLE_ENTITY", message: "card not enabled" }, 422);
          return json(createReturnsAuth ? authorized() : { id: "ORDER1", status: "APPROVED" }, 201);
        }
        return json({ id: "ORDER2", status: "CREATED", links: [{ rel: "approve", href: "https://sandbox/approve" }] }, 201);
      }
      if (path.endsWith("/authorize")) return json(authorized("ORDER1", authStatus), 201);
      if (path.endsWith("/capture")) return json({ id: "CAP1", status: "COMPLETED" }, 201);
      if (path.endsWith("/void")) return new Response(null, { status: 204 });
      if (path.startsWith("/v2/checkout/orders/")) return json({ id: "ORDER1", status: "COMPLETED" });
      return json({ name: "NOT_FOUND" }, 404);
    }),
  );
}

const paths = () => calls.map((c) => `${c.init.method} ${new URL(c.url).pathname}`);
const merchant = { id: "northpine", name: "Northpine Outfitters" };

beforeEach(() => {
  calls = [];
  resetTokenCache();
  process.env.PAYPAL_CLIENT_ID = "cid";
  process.env.PAYPAL_CLIENT_SECRET = "csecret";
  delete process.env.PAYPAL_ENVIRONMENT;
});
afterEach(() => vi.unstubAllGlobals());

describe("client", () => {
  it("uses sandbox base by default and for SANDBOX, live for LIVE", () => {
    expect(baseUrl()).toBe("https://api-m.sandbox.paypal.com");
    process.env.PAYPAL_ENVIRONMENT = "SANDBOX";
    expect(baseUrl()).toBe("https://api-m.sandbox.paypal.com");
    process.env.PAYPAL_ENVIRONMENT = "LIVE";
    expect(baseUrl()).toBe("https://api-m.paypal.com");
  });

  it("caches the token until expiry and sends Basic auth", async () => {
    mockPayPal();
    await Promise.all([getAccessToken(), getAccessToken()]);
    await getAccessToken();
    expect(calls).toHaveLength(1);
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Basic " + Buffer.from("cid:csecret").toString("base64"));
    expect(calls[0].init.body).toBe("grant_type=client_credentials");
  });

  it("refetches after expiry", async () => {
    mockPayPal();
    vi.useFakeTimers();
    await getAccessToken();
    vi.setSystemTime(Date.now() + 32400 * 1000);
    await getAccessToken();
    vi.useRealTimers();
    expect(calls).toHaveLength(2);
  });

  it("error messages never contain the secret or token", async () => {
    mockPayPal({ cardRejected: true });
    const err = await getOrder("missing/../x").catch((e) => e);
    expect(String(err.message)).not.toMatch(/csecret|TOKEN/);
  });
});

describe("orders", () => {
  it("creates AUTHORIZE order with sandbox card, cents-exact totals and idempotency header", async () => {
    mockPayPal({ createReturnsAuth: true });
    const r = await createAuthorizeOrder([{ name: "Mug", quantity: 3, unitAmount: 0.1 }], merchant, { requestId: "req-1" });
    expect(r).toEqual({ id: "ORDER1", status: "COMPLETED", authorization: { id: "AUTH1", status: "CREATED", expirationTime: "x" } });
    const create = calls[1];
    const body = JSON.parse(create.init.body as string);
    expect(body.intent).toBe("AUTHORIZE");
    expect(body.payment_source.card.number).toBe("4012888888881881");
    expect(body.purchase_units[0].amount).toEqual({
      currency_code: "USD",
      value: "0.30",
      breakdown: { item_total: { currency_code: "USD", value: "0.30" } },
    });
    expect(body.purchase_units[0].items[0]).toEqual({ name: "Mug", quantity: "3", unit_amount: { currency_code: "USD", value: "0.10" } });
    const h = create.init.headers as Record<string, string>;
    expect(h["PayPal-Request-Id"]).toBe("req-1");
    expect(h.Authorization).toBe("Bearer TOKEN");
  });

  it("falls back to approve link when card payment_source is rejected", async () => {
    mockPayPal({ cardRejected: true });
    const r = await createAuthorizeOrder([{ name: "Mug", quantity: 1, unitAmount: 30 }], merchant);
    expect(r).toEqual({ id: "ORDER2", status: "CREATED", approveUrl: "https://sandbox/approve" });
    const ids = calls.slice(1).map((c) => (c.init.headers as Record<string, string>)["PayPal-Request-Id"]);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids.every((id) => id.length <= 38)).toBe(true);
  });

  it("#22 fallback create derives its request id from the caller's (deterministic retry)", async () => {
    mockPayPal({ cardRejected: true });
    await createAuthorizeOrder([{ name: "Mug", quantity: 1, unitAmount: 30 }], merchant, { requestId: "g1-d1-auth" });
    const ids = calls.slice(1).map((c) => (c.init.headers as Record<string, string>)["PayPal-Request-Id"]);
    expect(ids).toEqual(["g1-d1-auth", "g1-d1-auth-b"]);
  });

  it("#6 exposes a DENIED authorization status faithfully", async () => {
    mockPayPal({ authStatus: "DENIED" });
    const r = await authorizeOrder("ORDER1", "rid");
    expect(r.authorization).toMatchObject({ id: "AUTH1", status: "DENIED" });
  });

  it("rejects bad items before any network call", async () => {
    mockPayPal();
    await expect(createAuthorizeOrder([{ name: "x", quantity: 0, unitAmount: 1 }], merchant)).rejects.toThrow();
    await expect(createAuthorizeOrder([], merchant)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("captures and voids authorizations (void handles 204)", async () => {
    mockPayPal();
    expect(await captureAuthorization("AUTH1")).toEqual({ id: "CAP1", status: "COMPLETED" });
    expect(await voidAuthorization("AUTH1")).toEqual({ authorizationId: "AUTH1", status: "VOIDED" });
    expect(paths()).toContain("POST /v2/payments/authorizations/AUTH1/capture");
    expect(paths()).toContain("POST /v2/payments/authorizations/AUTH1/void");
  });

  it("getOrder uses GET", async () => {
    mockPayPal();
    expect((await getOrder("ORDER1")).status).toBe("COMPLETED");
    expect(paths()).toContain("GET /v2/checkout/orders/ORDER1");
  });
});

describe("R5: timeout and 401", () => {
  afterEach(() => vi.restoreAllMocks());

  it("B2: a hung PayPal call is aborted after 15s and surfaces as a no-status (network) error", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => AbortSignal.abort(new DOMException("timed out", "TimeoutError")));
    // Never resolves on its own: only the abort signal can end it.
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_res, rej) => {
      const s = init.signal!;
      if (s.aborted) rej(s.reason);
      s.addEventListener("abort", () => rej(s.reason));
    })));
    const err = await getAccessToken().catch((e) => e);
    expect(err).toMatchObject({ name: "TimeoutError" });
    expect((err as { status?: unknown }).status).toBeUndefined(); // guard: no status = "no response" -> unknown
    expect(timeout).toHaveBeenCalledWith(15_000);

    // paypalFetch itself (token cached) also times out.
    timeout.mockRestore();
    mockPayPal();
    await getAccessToken();
    const t2 = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => AbortSignal.abort(new DOMException("timed out", "TimeoutError")));
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => Promise.reject(init.signal!.reason)));
    await expect(getOrder("ORDER1")).rejects.toMatchObject({ name: "TimeoutError" });
    expect(t2).toHaveBeenCalledWith(15_000);
  });

  it("B8: a 401 clears the cached token, fetches a new one and retries once", async () => {
    let tokenN = 0;
    const orderAuth: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === "/v1/oauth2/token") return json({ access_token: `T${++tokenN}`, expires_in: 32400 });
      const a = (init.headers as Record<string, string>).Authorization;
      orderAuth.push(a);
      return a === "Bearer T1" ? json({ name: "AUTHENTICATION_FAILURE" }, 401) : json({ id: "ORDER1", status: "COMPLETED" });
    }));
    await getAccessToken(); // caches T1 (revoked server-side)
    await expect(getOrder("ORDER1")).resolves.toMatchObject({ id: "ORDER1" });
    expect(orderAuth).toEqual(["Bearer T1", "Bearer T2"]);
    expect(tokenN).toBe(2);
  });

  it("B8: a second 401 is thrown, not retried forever", async () => {
    let tokens = 0;
    let orderCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (new URL(url).pathname === "/v1/oauth2/token") return json({ access_token: `T${++tokens}`, expires_in: 32400 });
      orderCalls++;
      return json({ name: "AUTHENTICATION_FAILURE" }, 401);
    }));
    await expect(getOrder("ORDER1")).rejects.toMatchObject({ status: 401 });
    expect(orderCalls).toBe(2);
  });
});

describe("m7: no token = nothing sent to PayPal", () => {
  afterEach(() => vi.restoreAllMocks());

  it("missing PAYPAL creds -> PayPalNotSentError, no request at all", async () => {
    mockPayPal();
    delete process.env.PAYPAL_CLIENT_SECRET;
    await expect(createAuthorizeOrder([{ name: "Mug", quantity: 1, unitAmount: 30 }], merchant)).rejects.toBeInstanceOf(PayPalNotSentError);
    expect(calls).toEqual([]);
  });

  it("token fetch timeout -> PayPalNotSentError, the order call is never made", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (new URL(url).pathname === "/v1/oauth2/token") throw new DOMException("timed out", "TimeoutError");
      return json({ id: "ORDER1", status: "COMPLETED" });
    }));
    await expect(getOrder("ORDER1")).rejects.toBeInstanceOf(PayPalNotSentError);
    expect(paths()).toEqual(["POST /v1/oauth2/token"]);
  });

  it("OAuth refused (bad creds) on create -> PayPalNotSentError, no buyer-approval fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return json({ error: "invalid_client" }, 401);
    }));
    await expect(createAuthorizeOrder([{ name: "Mug", quantity: 1, unitAmount: 30 }], merchant)).rejects.toBeInstanceOf(PayPalNotSentError);
    expect(paths()).toEqual(["POST /v1/oauth2/token"]);
  });

  it("401 then the refresh token fetch fails -> PayPalNotSentError (PayPal never acted)", async () => {
    let tokenN = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (new URL(url).pathname === "/v1/oauth2/token") {
        if (++tokenN > 1) throw new TypeError("fetch failed");
        return json({ access_token: "T1", expires_in: 32400 });
      }
      return json({ name: "AUTHENTICATION_FAILURE" }, 401);
    }));
    await expect(getOrder("ORDER1")).rejects.toBeInstanceOf(PayPalNotSentError);
  });
});
