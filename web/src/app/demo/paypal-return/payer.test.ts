import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DecisionRow, GuardState } from "@/lib/guard/guard";
import { runSettled } from "@/components/demo/errors";
import { holdUpdates } from "@/components/demo/Trace";
import { VerdictStack, gist } from "@/components/demo/Verdicts";
import { statusLabel } from "@/components/grid/format";
import { PAYER_BACK_KEY, PAYER_MSG, openPayerWindow, parsePayerReturn, payerMessageFor } from "./payer";

const row = (p: Partial<DecisionRow>): DecisionRow => ({
  id: "d1", time: "2026-10-31T00:00:00.000Z", merchant: "Northpine Outfitters", items: "1x Basecamp Enamel Mug, 16 oz",
  amountUsd: 30, verdict: "hold", reasons: ["total $30.00 is over the $25.00 ask-me limit"], status: "held", ...p,
});
const state = (rows: DecisionRow[], pendingHolds: string[] = []): GuardState => ({ rows, pendingHolds, amountAtRiskUsd: 0, committedUsd: 30, unknownRows: [] });
const awaiting = row({ status: "awaiting_payer", paypalOrderId: "O1", payerActionUrl: "https://www.sandbox.paypal.com/checkoutnow?token=O1", expiresAt: "2099-01-01T00:00:00.000Z" });

describe("PayPal return page helpers", () => {
  it("parses PayPal's return query (token = order id) plus our run/row", () => {
    expect(parsePayerReturn("?run=r-1&row=d1&token=5O190127TN364715T&PayerID=ABC")).toEqual({ type: PAYER_MSG, run: "r-1", row: "d1", orderId: "5O190127TN364715T", cancelled: false });
    expect(parsePayerReturn("?run=r-1&row=d1&cancelled=1&token=O1")).toMatchObject({ cancelled: true, orderId: "O1" });
  });

  it("rejects missing or malformed params", () => {
    expect(parsePayerReturn("?row=d1&token=O1")).toBeNull();
    expect(parsePayerReturn("?run=r&token=O1")).toBeNull();
    expect(parsePayerReturn("?run=r&row=d1")).toBeNull(); // approval without an order id
    expect(parsePayerReturn("?run=r&row=d1&token=<script>")).toBeNull();
  });

  it("payerMessageFor accepts only a well-formed message for this run", () => {
    const m = parsePayerReturn("?run=r-1&row=d1&token=O1")!;
    expect(payerMessageFor(m, "r-1")).toEqual(m);
    expect(payerMessageFor(m, "other")).toBeNull();
    expect(payerMessageFor({ ...m, type: "x" }, "r-1")).toBeNull();
    expect(payerMessageFor("junk", "r-1")).toBeNull();
    expect(payerMessageFor({ ...m, orderId: 5 }, "r-1")).toBeNull();
  });
});

describe("awaiting_payer / expired / cancelled on the client", () => {
  it("awaiting_payer keeps the run unsettled", () => {
    expect(runSettled(state([awaiting]))).toBe(false);
    expect(runSettled(state([row({ status: "expired" })]))).toBe(true);
  });

  it("status labels", () => {
    expect(statusLabel("awaiting_payer")).toBe("Waiting for PayPal approval");
    expect(statusLabel("expired")).toBe("Expired");
    expect(statusLabel("cancelled")).toBe("Cancelled");
  });

  it("gist and hold updates say nothing was charged", () => {
    const exp = row({ status: "expired", decision: "expired", reasons: ["expired: the buyer did not approve in PayPal in time; nothing was authorized or charged"] });
    const can = row({ status: "cancelled", decision: "rejected", reasons: ["cancelled by user before PayPal approval; nothing was authorized or charged"] });
    expect(gist(exp)).toBe("PayPal approval timed out");
    expect(gist(can)).toBe("cancelled by you");
    expect(gist(can, true)).toBe("cancelled by the run's owner");
    const u = holdUpdates([exp, can]);
    expect(u[0]).toMatch(/PayPal approval timed out.*Nothing was authorized or charged/);
    expect(u[1]).toMatch(/You cancelled .*before PayPal approval.*Nothing was authorized or charged/);
  });

  it("hold card offers Approve with PayPal and Cancel (disabled when view only); no Release yet", () => {
    const html = (viewOnly: boolean) =>
      renderToStaticMarkup(createElement(VerdictStack, { guard: state([awaiting], ["d1"]), busy: {}, simulated: false, viewOnly, onDecide: () => {}, onReveal: () => {} }));
    const owner = html(false);
    expect(owner).toContain("Waiting for PayPal approval");
    expect(owner).toMatch(/<button(?![^>]*disabled="")[^>]*>(?:(?!<\/button>).)*Approve with PayPal/);
    expect(owner).toMatch(/<button(?![^>]*disabled="")[^>]*>(?:(?!<\/button>).)*Cancel/);
    expect(owner).not.toContain("Release");
    expect(html(true)).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Approve with PayPal/);
  });

  it("a held row offers Release and Cancel", () => {
    const html = renderToStaticMarkup(createElement(VerdictStack, { guard: state([row({ authorizationId: "A1", expiresAt: "2099-01-01T00:00:00.000Z" })], ["d1"]), busy: {}, simulated: false, viewOnly: false, onDecide: () => {}, onReveal: () => {} }));
    expect(html).toContain("Release $30.00");
    expect(html).toContain("Cancel");
  });
});

describe("openPayerWindow (m6)", () => {
  it("clears a stale back-link BEFORE opening: a popup copies sessionStorage, and the key would send it to /demo", () => {
    const log: string[] = [];
    const store = new Map([[PAYER_BACK_KEY, "{\"run\":\"old\"}"]]);
    const storage = { removeItem: (k: string) => (log.push(`remove ${k}`), void store.delete(k)) };
    const popup = {} as Window;
    const w = openPayerWindow(() => (log.push(`open (back key ${store.has(PAYER_BACK_KEY) ? "present" : "gone"})`), popup), () => storage);
    expect(w).toBe(popup);
    expect(log).toEqual([`remove ${PAYER_BACK_KEY}`, "open (back key gone)"]);
  });
  it("storage that throws (blocked site data) still opens", () => {
    const w = openPayerWindow(() => null, () => { throw new Error("SecurityError"); });
    expect(w).toBeNull();
  });
});
