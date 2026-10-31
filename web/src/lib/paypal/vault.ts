// PayPal Vault v3 ("save PayPal, no purchase") + merchant-initiated Orders v2 AUTHORIZE with vault_id.
// Request builders are pure; the three calls are thin wrappers over client.ts paypalFetch.
// Sources (official):
//  - Guide https://developer.paypal.com/docs/checkout/save-payment-methods/purchase-later/payment-tokens-api/paypal/
//    "Save a PayPal Wallet to the vault with the Payment Method Tokens v3 API, no purchase required."
//    "Payers don't need to be present when charged."
//  - Vault v3 OpenAPI https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/vault_payment_tokens_v3.json
//    setup_token_request.payment_source.paypal = wallet_base {description, usage_pattern, usage_type (required in
//    vault_paypal_wallet_base), customer_type, permit_multiple_payment_tokens} + experience_context {brand_name,
//    locale, return_url, cancel_url, shipping_preference, vault_instruction}.
//    payment_source.token = {id, type: "SETUP_TOKEN"} ("The setup token, which is a temporary reference to payment source.")
//  - Orders v2 OpenAPI https://developer.paypal.com/api/orders/v2/schema.json example
//    "samples_orders_create_..._authorize_single_step_paypal_with_vault_id_and_stored_credentials_usage_pattern":
//    {intent:"AUTHORIZE", payment_source:{paypal:{vault_id, stored_credential:{payment_initiator:"MERCHANT",
//    usage:"SUBSEQUENT", usage_pattern}}}} -> 201 status COMPLETED with purchase_units[0].payments.authorizations[0].
//    payment_initiator MERCHANT: "Payment is initiated by merchant on behalf of the customer without the active
//    engagement of customer."
import "server-only";
import { paypalFetch } from "./client";

type Link = { rel: string; href: string; method?: string };

export type SetupTokenRequest = {
  payment_source: {
    paypal: {
      description: string;
      usage_pattern: "IMMEDIATE";
      usage_type: "MERCHANT";
      customer_type: "CONSUMER";
      permit_multiple_payment_tokens: boolean;
      experience_context: { brand_name: string; return_url: string; cancel_url: string };
    };
  };
};
export type PaymentTokenRequest = { payment_source: { token: { id: string; type: "SETUP_TOKEN" } } };
export type VaultAuthorizeOrderRequest = {
  intent: "AUTHORIZE";
  purchase_units: unknown[];
  payment_source: {
    paypal: {
      vault_id: string;
      stored_credential: { payment_initiator: "MERCHANT"; usage: "SUBSEQUENT"; usage_pattern: "IMMEDIATE" };
    };
  };
};

export function buildSetupTokenRequest(o: { returnUrl: string; cancelUrl: string }): SetupTokenRequest {
  return {
    payment_source: {
      paypal: {
        description: "CartHold: let your shopping agent pay with PayPal; every charge is held for your approval.",
        // "On-demand instant payments - non-recurring, pre-paid, variable amount, variable frequency."
        usage_pattern: "IMMEDIATE",
        usage_type: "MERCHANT",
        customer_type: "CONSUMER",
        // ponytail: no customer login in CartHold; spec: "Use this when the customer has not logged in at merchant/platform."
        permit_multiple_payment_tokens: true,
        experience_context: { brand_name: "CartHold", return_url: o.returnUrl, cancel_url: o.cancelUrl },
      },
    },
  };
}

export function buildPaymentTokenRequest(setupTokenId: string): PaymentTokenRequest {
  if (!/^[0-9A-Za-z_-]{1,255}$/.test(setupTokenId)) throw new Error("bad setup token id"); // spec pattern
  return { payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } } };
}

export function buildVaultAuthorizeOrder(purchaseUnit: unknown, vaultId: string): VaultAuthorizeOrderRequest {
  if (!vaultId) throw new Error("vaultId required");
  return {
    intent: "AUTHORIZE",
    purchase_units: [purchaseUnit],
    payment_source: {
      paypal: {
        vault_id: vaultId,
        stored_credential: { payment_initiator: "MERCHANT", usage: "SUBSEQUENT", usage_pattern: "IMMEDIATE" },
      },
    },
  };
}

/** POST /v3/vault/setup-tokens -> {id, status: PAYER_ACTION_REQUIRED, approveUrl (rel "approve")}. */
export async function createSetupToken(o: { returnUrl: string; cancelUrl: string }, requestId = crypto.randomUUID()) {
  const r = await paypalFetch<{ id: string; status: string; customer?: { id: string }; links?: Link[] }>(
    "/v3/vault/setup-tokens",
    { body: buildSetupTokenRequest(o), requestId },
  );
  return { id: r.id, status: r.status, customerId: r.customer?.id, approveUrl: r.links?.find((l) => l.rel === "approve")?.href };
}

/** POST /v3/vault/payment-tokens -> vaultId (payment token id) after the buyer approved the setup token. */
export async function createPaymentToken(setupTokenId: string, requestId = crypto.randomUUID()) {
  const r = await paypalFetch<{ id: string; customer?: { id: string }; payment_source?: { paypal?: { email_address?: string } } }>(
    "/v3/vault/payment-tokens",
    { body: buildPaymentTokenRequest(setupTokenId), requestId },
  );
  return { vaultId: r.id, customerId: r.customer?.id, payerEmail: r.payment_source?.paypal?.email_address };
}
