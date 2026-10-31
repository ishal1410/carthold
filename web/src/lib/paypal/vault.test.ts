import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildPaymentTokenRequest, buildSetupTokenRequest, buildVaultAuthorizeOrder } from "./vault";

describe("vault request builders match PayPal doc examples", () => {
  it("setup token: payment_source.paypal with MERCHANT usage and return/cancel in experience_context", () => {
    const b = buildSetupTokenRequest({ returnUrl: "https://example.com/returnUrl", cancelUrl: "https://example.com/cancelUrl" });
    // Guide sample: usage_pattern IMMEDIATE, usage_type MERCHANT, customer_type CONSUMER, return_url/cancel_url.
    expect(b.payment_source.paypal).toMatchObject({
      usage_pattern: "IMMEDIATE",
      usage_type: "MERCHANT",
      customer_type: "CONSUMER",
      experience_context: { return_url: "https://example.com/returnUrl", cancel_url: "https://example.com/cancelUrl" },
    });
    expect(b.payment_source.paypal.description.length).toBeLessThanOrEqual(128); // spec maxLength
    expect(Object.keys(b.payment_source)).toEqual(["paypal"]);
  });

  it("payment token: payment_source.token {id, type SETUP_TOKEN}", () => {
    expect(buildPaymentTokenRequest("5C991763VB2781612")).toEqual({
      payment_source: { token: { id: "5C991763VB2781612", type: "SETUP_TOKEN" } },
    });
    expect(() => buildPaymentTokenRequest("../x")).toThrow();
  });

  it("order: Orders v2 single-step AUTHORIZE with vault_id + merchant-initiated stored_credential", () => {
    const unit = { amount: { currency_code: "USD", value: "100.00" } };
    // Orders v2 spec example (usage_pattern there is RECURRING_PREPAID; ours matches the setup token's IMMEDIATE).
    expect(buildVaultAuthorizeOrder(unit, "2w915838hr181240m")).toEqual({
      intent: "AUTHORIZE",
      purchase_units: [unit],
      payment_source: {
        paypal: {
          vault_id: "2w915838hr181240m",
          stored_credential: { payment_initiator: "MERCHANT", usage: "SUBSEQUENT", usage_pattern: "IMMEDIATE" },
        },
      },
    });
    expect(() => buildVaultAuthorizeOrder(unit, "")).toThrow();
  });
});
