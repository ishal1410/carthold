// "Approve with PayPal" holds: a HOLD verdict creates an order the buyer approves in PayPal (payment_source.paypal),
// then CartHold authorizes it and the owner releases (capture) or cancels (void) it.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Mandate } from "../policy/policy";
import { createGuard, HOLD_TIMEOUT_MS, MAX_HOLD_LIFETIME_MS, type PayPalApi } from "./guard";

const MUG: Mandate = {
  userRequest: "Buy me a camping coffee mug under $40",
  budgetUsd: 100,
  perItemCapUsd: 60,
  approvalThresholdUsd: 25,
  merchantAllowlist: ["Northpine Outfitters", "Brew & Bean", "Giftlane Deals"],
  maxQuantity: 2,
};
const mugOrder = { merchant: "Northpine Outfitters", items: [{ name: "Basecamp Enamel Mug, 16 oz", quantity: 1, unitPriceUsd: 30 }], sourceSlug: "northpine" };
const coffee = { merchant: "Brew & Bean", items: [{ name: "Morning Ritual Blend, 12 oz", quantity: 1, unitPriceUsd: 18 }], sourceSlug: "brew-and-bean" };
const PAYER_URL = "https://www.sandbox.paypal.com/checkoutnow?token=O1";
const payerUrls = (rowId: string) => ({ returnUrl: `https://app.example/demo/paypal-return?row=${rowId}`, cancelUrl: `https://app.example/demo/paypal-return?row=${rowId}&cancelled=1` });

function mockPayPal() {
  const pp = {
    // Payer flow: no authorization yet, a payer-action link. Card flow (allow path): authorized right away.
    createAuthorizeOrder: vi.fn(async (_i: unknown, _m: unknown, o: { payer?: unknown }) =>
      o?.payer ? { id: "O1", status: "PAYER_ACTION_REQUIRED", approveUrl: PAYER_URL } : { id: "O9", status: "COMPLETED", authorization: { id: "A9", status: "CREATED" } },
    ),
    authorizeOrder: vi.fn(async (id: string) => ({ id, status: "COMPLETED", authorization: { id: "A1", status: "CREATED" } })),
    captureAuthorization: vi.fn(async (a: string) => ({ id: `C-${a}`, status: "COMPLETED" })),
    voidAuthorization: vi.fn(async (a: string) => ({ authorizationId: a, status: "VOIDED" })),
    getOrder: vi.fn(),
  };
  return pp as typeof pp & PayPalApi;
}
const guard = (pp = mockPayPal(), holdTimeoutMs = 5 * 60_000) =>
  ({ pp, g: createGuard({ mandate: MUG, llm: null, paypal: pp, holdTimeoutMs, payerUrls }) });

afterEach(() => vi.useRealTimers());

describe("Approve with PayPal holds", () => {
  it("hold -> awaiting_payer: PayPal order with return/cancel urls, nothing authorized, counted as committed", async () => {
    const { pp, g } = guard();
    const out = await g.onProposeOrder(mugOrder);
    expect(out).toMatch(/^HELD/); // agent.ts / redteam.ts treat any HELD result as "not bought"
    expect(out).toContain("O1");
    const opts = pp.createAuthorizeOrder.mock.calls[0][2] as { payer?: unknown; requestId?: string };
    expect(opts.payer).toEqual(payerUrls("d1"));
    expect(opts.requestId).toMatch(/-d1-auth$/);
    expect(pp.authorizeOrder).not.toHaveBeenCalled();
    const s = g.getState();
    expect(s.rows[0]).toMatchObject({ status: "awaiting_payer", paypalOrderId: "O1", payerActionUrl: PAYER_URL });
    expect(s.rows[0].expiresAt).toBeTruthy();
    expect(s).toMatchObject({ amountAtRiskUsd: 0, committedUsd: 30, pendingHolds: ["d1"] });
  });

  it("allow under the limit keeps the card path (no payer urls)", async () => {
    const pp = mockPayPal();
    const g = createGuard({ mandate: { ...MUG, userRequest: "Buy a coffee blend under $30" }, llm: null, paypal: pp, payerUrls });
    expect(await g.onProposeOrder(coffee)).toMatch(/^Paid/);
    expect((pp.createAuthorizeOrder.mock.calls[0][2] as { payer?: unknown }).payer).toBeUndefined();
  });

  it("a payer-action link that is not on paypal.com is never handed to the client", async () => {
    const pp = mockPayPal();
    pp.createAuthorizeOrder.mockResolvedValueOnce({ id: "O1", status: "PAYER_ACTION_REQUIRED", approveUrl: "https://evil.example/pay" });
    const { g } = guard(pp);
    await g.onProposeOrder(mugOrder);
    const row = g.getState().rows[0];
    expect(row.payerActionUrl).toBeUndefined();
    expect(row.status).toBe("error");
    expect(g.getState().committedUsd).toBe(0);
  });

  it("payer-approved -> authorize -> held with a fresh expiry -> release captures", async () => {
    vi.useFakeTimers();
    const { pp, g } = guard();
    await g.onProposeOrder(mugOrder);
    const first = g.getState().rows[0].expiresAt!;
    await vi.advanceTimersByTimeAsync(60_000);
    const row = await g.payerApproved("d1", "O1");
    expect(pp.authorizeOrder).toHaveBeenCalledWith("O1", expect.stringMatching(/-d1-authz$/));
    expect(row).toMatchObject({ status: "held", authorizationId: "A1" });
    expect(row.payerActionUrl).toBeUndefined();
    expect(Date.parse(row.expiresAt!)).toBeGreaterThan(Date.parse(first));
    expect(g.getState()).toMatchObject({ amountAtRiskUsd: 30, committedUsd: 30, pendingHolds: ["d1"] });
    expect(await g.approve("d1")).toMatchObject({ status: "captured", captureId: "C-A1", decision: "approved" });
  });

  it("payer-approved -> held -> cancel voids", async () => {
    const { pp, g } = guard();
    await g.onProposeOrder(mugOrder);
    await g.payerApproved("d1", "O1");
    expect(await g.reject("d1")).toMatchObject({ status: "voided" });
    expect(pp.voidAuthorization).toHaveBeenCalledWith("A1", expect.any(String));
  });

  it("held after payer approval auto-voids on its own timer", async () => {
    vi.useFakeTimers();
    const { pp, g } = guard(mockPayPal(), 1000);
    await g.onProposeOrder(mugOrder);
    await g.payerApproved("d1", "O1");
    await vi.advanceTimersByTimeAsync(1001);
    expect(pp.voidAuthorization).toHaveBeenCalledWith("A1", expect.any(String));
    expect(g.getState().rows[0]).toMatchObject({ status: "voided", decision: "expired" });
  });

  it("awaiting -> expired after the timeout with no PayPal call; budget freed", async () => {
    vi.useFakeTimers();
    const { pp, g } = guard(mockPayPal(), 1000);
    await g.onProposeOrder(mugOrder);
    await vi.advanceTimersByTimeAsync(1001);
    const row = g.getState().rows[0];
    expect(row).toMatchObject({ status: "expired", decision: "expired" });
    expect(row.payerActionUrl).toBeUndefined();
    expect(row.expiresAt).toBeUndefined();
    expect(pp.voidAuthorization).not.toHaveBeenCalled();
    expect(pp.authorizeOrder).not.toHaveBeenCalled();
    expect(g.getState()).toMatchObject({ committedUsd: 0, pendingHolds: [] });
    await expect(g.payerApproved("d1", "O1")).rejects.toThrow(/no pending hold/);
  });

  it("cancel before payer approval: cancelled, no money, no PayPal call", async () => {
    const { pp, g } = guard();
    await g.onProposeOrder(mugOrder);
    expect(await g.reject("d1")).toMatchObject({ status: "cancelled", decision: "rejected" });
    expect(pp.voidAuthorization).not.toHaveBeenCalled();
    expect(g.getState()).toMatchObject({ committedUsd: 0, pendingHolds: [] });
  });

  it("release before payer approval is refused (nothing to capture)", async () => {
    const { pp, g } = guard();
    await g.onProposeOrder(mugOrder);
    await expect(g.approve("d1")).rejects.toThrow(/no pending hold/);
    expect(pp.captureAuthorization).not.toHaveBeenCalled();
    expect(g.getState().rows[0].status).toBe("awaiting_payer");
  });

  it("wrong order id is rejected without calling PayPal", async () => {
    const { pp, g } = guard();
    await g.onProposeOrder(mugOrder);
    await expect(g.payerApproved("d1", "OTHER")).rejects.toThrow(/order id does not match/);
    expect(pp.authorizeOrder).not.toHaveBeenCalled();
    expect(g.getState().rows[0].status).toBe("awaiting_payer");
  });

  it("double payer-approved is idempotent: one authorize, same held row", async () => {
    const { pp, g } = guard();
    await g.onProposeOrder(mugOrder);
    const [a, b] = await Promise.all([g.payerApproved("d1", "O1"), g.payerApproved("d1", "O1")]);
    const c = await g.payerApproved("d1", "O1");
    expect(pp.authorizeOrder).toHaveBeenCalledTimes(1);
    for (const r of [a, b, c]) expect(r).toMatchObject({ status: "held", authorizationId: "A1" });
  });

  it("PayPal 4xx on authorize (buyer has not approved): back to awaiting, timer still running", async () => {
    vi.useFakeTimers();
    const pp = mockPayPal();
    pp.authorizeOrder.mockRejectedValueOnce(Object.assign(new Error("422 ORDER_NOT_APPROVED"), { status: 422 }));
    const { g } = guard(pp, 1000);
    await g.onProposeOrder(mugOrder);
    await expect(g.payerApproved("d1", "O1")).rejects.toThrow(/not approved/);
    expect(g.getState().rows[0]).toMatchObject({ status: "awaiting_payer", payerActionUrl: PAYER_URL });
    await vi.advanceTimersByTimeAsync(1001);
    expect(g.getState().rows[0].status).toBe("expired");
  });

  it("4xx on authorize that returns after the approval window: expired, not re-armed (A3)", async () => {
    vi.useFakeTimers();
    const pp = mockPayPal();
    pp.authorizeOrder.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 2000); // slow PayPal call: the 1s window lapses while it is in flight
      throw Object.assign(new Error("422 ORDER_NOT_APPROVED"), { status: 422 });
    });
    const { g } = guard(pp, 1000);
    await g.onProposeOrder(mugOrder);
    await expect(g.payerApproved("d1", "O1")).rejects.toThrow();
    const s = g.getState();
    expect(s.rows[0]).toMatchObject({ status: "expired", decision: "expired" });
    expect(s.pendingHolds).toEqual([]);
    expect(s.committedUsd).toBe(0);
    await expect(g.payerApproved("d1", "O1")).rejects.toThrow(/no pending hold/);
    expect(pp.authorizeOrder).toHaveBeenCalledTimes(1);
  });

  it("network error on authorize: unknown (money may be held), still counted", async () => {
    const pp = mockPayPal();
    pp.authorizeOrder.mockRejectedValueOnce(new TypeError("fetch failed"));
    const { g } = guard(pp);
    await g.onProposeOrder(mugOrder);
    await g.payerApproved("d1", "O1").catch(() => {});
    expect(g.getState().rows[0].status).toBe("unknown");
    expect(g.getState().committedUsd).toBe(30);
  });

  it("system void (shutdown) of an awaiting row: expired, no PayPal call", async () => {
    const { pp, g } = guard();
    await g.onProposeOrder(mugOrder);
    expect(await g.systemVoid("d1")).toMatchObject({ status: "expired", decision: "system-voided" });
    expect(pp.voidAuthorization).not.toHaveBeenCalled();
  });

  it("webhook AUTHORIZATION.CREATED for an awaiting row is a no-op (our own authorize settles it)", async () => {
    const { g } = guard();
    await g.onProposeOrder(mugOrder);
    expect(await g.applyPayPalEvent({ type: "PAYMENT.AUTHORIZATION.CREATED", authorizationId: "A1", orderId: "O1", status: "CREATED" })).toBe(false);
    expect(g.getState().rows[0].status).toBe("awaiting_payer");
  });

  it("awaiting money counts against the budget: a second order that would exceed it is blocked", async () => {
    const pp = mockPayPal();
    const g = createGuard({ mandate: { ...MUG, budgetUsd: 50 }, llm: null, paypal: pp, payerUrls });
    await g.onProposeOrder(mugOrder);
    expect(await g.onProposeOrder(mugOrder)).toMatch(/^BLOCKED.*remaining budget/);
  });

  it("m3: shutdown begins while the payer authorize is in flight -> the new authorization is voided, never armed", async () => {
    const pp = mockPayPal();
    let release!: () => void;
    pp.authorizeOrder.mockImplementationOnce(async (id: string) => {
      await new Promise<void>((r) => (release = r));
      return { id, status: "COMPLETED", authorization: { id: "A1", status: "CREATED" } };
    });
    const { g } = guard(pp);
    await g.onProposeOrder(mugOrder);
    const p = g.payerApproved("d1", "O1");
    await Promise.resolve();
    const flag = globalThis as unknown as { __cartholdShuttingDown?: boolean };
    flag.__cartholdShuttingDown = true;
    try {
      release();
      const row = await p;
      expect(row).toMatchObject({ status: "voided", decision: "system-voided" });
      expect(pp.voidAuthorization).toHaveBeenCalledWith("A1", expect.any(String));
      expect(g.getState()).toMatchObject({ pendingHolds: [], amountAtRiskUsd: 0 });
    } finally {
      flag.__cartholdShuttingDown = false;
    }
  });

  it("m4: 5xx on payer authorize but PayPal never authorized -> resolver puts the row back to awaiting_payer with the remaining window", async () => {
    vi.useFakeTimers();
    const pp = mockPayPal();
    pp.authorizeOrder.mockRejectedValueOnce(Object.assign(new Error("503"), { status: 503 }));
    pp.getOrder.mockResolvedValue({ id: "O1", status: "APPROVED" });
    const { g } = guard(pp, 60_000);
    await g.onProposeOrder(mugOrder);
    const expiresAt = g.getState().rows[0].expiresAt!;
    await g.payerApproved("d1", "O1");
    expect(g.getState().rows[0].status).toBe("unknown");
    await vi.advanceTimersByTimeAsync(10_000);
    const row = await g.resolveUnknown("d1");
    expect(row).toMatchObject({ status: "awaiting_payer", payerActionUrl: PAYER_URL, expiresAt });
    expect(g.getState()).toMatchObject({ pendingHolds: ["d1"], amountAtRiskUsd: 0, unknownRows: [] });
    await vi.advanceTimersByTimeAsync(50_001);
    expect(g.getState().rows[0].status).toBe("expired");
    expect(g.getState().committedUsd).toBe(0);
  });

  it("m4: same, but the approval window already passed -> expired, budget freed", async () => {
    vi.useFakeTimers();
    const pp = mockPayPal();
    pp.authorizeOrder.mockRejectedValueOnce(new TypeError("fetch failed"));
    pp.getOrder.mockResolvedValue({ id: "O1", status: "PAYER_ACTION_REQUIRED" });
    const { g } = guard(pp, 1000);
    await g.onProposeOrder(mugOrder);
    await g.payerApproved("d1", "O1");
    await vi.advanceTimersByTimeAsync(5000);
    expect(await g.resolveUnknown("d1")).toMatchObject({ status: "expired" });
    expect(g.getState()).toMatchObject({ committedUsd: 0, pendingHolds: [], unknownRows: [] });
  });

  it("max hold lifetime constant = payer window + held window", () => {
    expect(MAX_HOLD_LIFETIME_MS).toBe(2 * HOLD_TIMEOUT_MS);
  });
});
