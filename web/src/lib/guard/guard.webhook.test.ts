// applyPayPalEvent: reconcile rows from verified PayPal webhooks (holds voided / captured outside CartHold, unknown rows).
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PayPalError } from "../paypal/client";
import type { Mandate } from "../policy/policy";
import { createGuard, type PayPalApi } from "./guard";

delete process.env.GEMINI_API_KEY;

const M = (userRequest: string): Mandate => ({
  userRequest, budgetUsd: 100, perItemCapUsd: 60, approvalThresholdUsd: 25,
  merchantAllowlist: ["Northpine Outfitters", "Brew & Bean", "Giftlane Deals"], maxQuantity: 2,
});
const MUGREQ = "Buy me a camping coffee mug under $40";
const mugOrder = { merchant: "Northpine Outfitters", items: [{ name: "Basecamp Enamel Mug, 16 oz", quantity: 1, unitPriceUsd: 30 }], sourceSlug: "northpine" };
const err5 = () => new PayPalError("boom", 503, undefined, undefined, {});

function pp(over: Record<string, unknown> = {}) {
  return {
    createAuthorizeOrder: vi.fn(async () => ({ id: "O1", status: "COMPLETED", authorization: { id: "A1", status: "CREATED" } })),
    authorizeOrder: vi.fn(),
    captureAuthorization: vi.fn(async (a: string) => ({ id: `C-${a}`, status: "COMPLETED" })),
    voidAuthorization: vi.fn(async (a: string) => ({ authorizationId: a, status: "VOIDED" })),
    ...over,
  } as unknown as PayPalApi & Record<string, ReturnType<typeof vi.fn>>;
}

async function heldGuard(paypal = pp()) {
  const g = createGuard({ mandate: M(MUGREQ), llm: null, paypal, holdTimeoutMs: 60_000 });
  expect(await g.onProposeOrder(mugOrder)).toMatch(/^HELD/);
  return { g, paypal };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("guard.applyPayPalEvent", () => {
  it("AUTHORIZATION.VOIDED on a held row: voided, timer cleared, approve refused, nothing at risk", async () => {
    vi.useFakeTimers();
    const { g, paypal } = await heldGuard();
    expect(await g.applyPayPalEvent({ type: "PAYMENT.AUTHORIZATION.VOIDED", authorizationId: "A1", orderId: "O1" })).toBe(true);
    expect(g.getState()).toMatchObject({ pendingHolds: [], amountAtRiskUsd: 0, committedUsd: 0 });
    expect(g.getState().rows[0].status).toBe("voided");
    await expect(g.approve("d1")).rejects.toThrow(/no pending hold/);
    await vi.advanceTimersByTimeAsync(120_000); // the old auto-void timer must be gone
    expect(paypal.voidAuthorization).not.toHaveBeenCalled();
  });

  it("is a no-op when the status already matches (replayed / late event)", async () => {
    const { g } = await heldGuard();
    await g.reject("d1");
    const before = g.getState().rows[0];
    expect(await g.applyPayPalEvent({ type: "PAYMENT.AUTHORIZATION.VOIDED", authorizationId: "A1" })).toBe(false);
    expect(g.getState().rows[0]).toEqual(before);
  });

  it("ignores events for authorizations / orders it does not know", async () => {
    const { g } = await heldGuard();
    expect(await g.applyPayPalEvent({ type: "PAYMENT.AUTHORIZATION.VOIDED", authorizationId: "ZZZ", orderId: "OZZ" })).toBe(false);
    expect(g.getState().rows[0].status).toBe("held");
  });

  it("CAPTURE.COMPLETED on a held row (captured outside CartHold): captured, timer cleared", async () => {
    const { g } = await heldGuard();
    expect(await g.applyPayPalEvent({ type: "PAYMENT.CAPTURE.COMPLETED", authorizationId: "A1", orderId: "O1", captureId: "C9" })).toBe(true);
    expect(g.getState().rows[0]).toMatchObject({ status: "captured", captureId: "C9" });
    expect(g.getState().pendingHolds).toEqual([]);
  });

  it("CAPTURE.COMPLETED resolves a PENDING-capture unknown row, matched by capture id", async () => {
    const paypal = pp({ captureAuthorization: vi.fn(async () => ({ id: "C7", status: "PENDING" })) });
    const { g } = await heldGuard(paypal);
    await g.approve("d1");
    expect(g.getState().rows[0].status).toBe("unknown");
    expect(await g.applyPayPalEvent({ type: "PAYMENT.CAPTURE.COMPLETED", captureId: "C7" })).toBe(true);
    expect(g.getState().rows[0].status).toBe("captured");
    expect(g.getState().amountAtRiskUsd).toBe(0);
  });

  it("CAPTURE.DENIED on an unknown PENDING-capture row: voids the authorization -> error, nothing held", async () => {
    const paypal = pp({ captureAuthorization: vi.fn(async () => ({ id: "C7", status: "PENDING" })) });
    const { g } = await heldGuard(paypal);
    await g.approve("d1");
    expect(await g.applyPayPalEvent({ type: "PAYMENT.CAPTURE.DENIED", captureId: "C7", authorizationId: "A1" })).toBe(true);
    expect(paypal.voidAuthorization).toHaveBeenCalledWith("A1", expect.any(String));
    expect(g.getState().rows[0].status).toBe("error");
    expect(g.getState().committedUsd).toBe(0);
  });

  it("CAPTURE.DENIED never touches a captured row", async () => {
    const { g, paypal } = await heldGuard();
    await g.approve("d1");
    expect(await g.applyPayPalEvent({ type: "PAYMENT.CAPTURE.DENIED", authorizationId: "A1" })).toBe(false);
    expect(g.getState().rows[0].status).toBe("captured");
    expect(paypal.voidAuthorization).not.toHaveBeenCalled();
  });

  it("AUTHORIZATION.CREATED resolves an unknown mid-authorize row (matched by order id) back into a hold", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const paypal = pp({
      createAuthorizeOrder: vi.fn(async () => ({ id: "O1", status: "CREATED" })),
      authorizeOrder: vi.fn(async () => { throw err5(); }),
    });
    const g = createGuard({ mandate: M(MUGREQ), llm: null, paypal, holdTimeoutMs: 60_000 });
    expect(await g.onProposeOrder(mugOrder)).toMatch(/^Payment status unknown/);
    expect(await g.applyPayPalEvent({ type: "PAYMENT.AUTHORIZATION.CREATED", authorizationId: "A5", orderId: "O1", status: "CREATED" })).toBe(true);
    expect(g.getState().rows[0]).toMatchObject({ status: "held", authorizationId: "A5" });
    expect(g.getState().pendingHolds).toEqual(["d1"]);
  });

  it("AUTHORIZATION.CREATED on a decided unknown row finishes the void instead of re-arming", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let n = 0;
    const paypal = pp({ voidAuthorization: vi.fn(async () => { if (n++ === 0) throw err5(); return {}; }) });
    const { g } = await heldGuard(paypal);
    await g.reject("d1"); // void fails -> unknown, decision rejected
    expect(g.getState().rows[0].status).toBe("unknown");
    expect(await g.applyPayPalEvent({ type: "PAYMENT.AUTHORIZATION.CREATED", authorizationId: "A1", orderId: "O1" })).toBe(true);
    expect(g.getState().rows[0].status).toBe("voided");
    expect(g.getState().pendingHolds).toEqual([]);
  });

  it("AUTHORIZATION.CREATED for a normal in-flight / held row changes nothing", async () => {
    const { g } = await heldGuard();
    expect(await g.applyPayPalEvent({ type: "PAYMENT.AUTHORIZATION.CREATED", authorizationId: "A1", orderId: "O1" })).toBe(false);
    expect(g.getState().rows[0].status).toBe("held");
  });
});
