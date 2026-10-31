// Orders v2 AUTHORIZE flow + Payments v2 capture/void (server only).
// Sources (quoted in SPIKE.md):
//  - Orders v2 spec https://developer.paypal.com/api/orders/v2/schema.json
//    /authorize: "the buyer must first approve the order or a valid payment_source must be provided"
//  - Sandbox card flow https://developer.paypal.com/tools/sandbox/card-testing/
//    "Make a create order call with intent as AUTHORIZE that includes a payment_source object with a valid card number."
//    Test card 4012 8888 8888 1881, any future expiry, any 3-digit CVV.
//  - Payments v2 spec https://developer.paypal.com/api/payments/v2/schema.json
//    POST /v2/payments/authorizations/{id}/capture | /void
//  - Idempotency https://developer.paypal.com/api/rest/reference/idempotency/
//    PayPal-Request-Id: UUID recommended (38-char limit), unique per request AND per call type.
//  - Buyer approval (Orders v2 spec, components.schemas.paypal_wallet_experience_context):
//    return_url "The URL where the customer will be redirected upon approving a payment."
//    cancel_url "The URL where the customer will be redirected upon cancelling the payment approval."
//    user_action PAY_NOW: "Use this option when the final amount is known when the checkout is initiated".
//    shipping_preference NO_SHIPPING: "Removes the shipping address information from the API response and the Paypal site."
//    Order status PAYER_ACTION_REQUIRED: "Redirect the payer to the \"rel\":\"payer-action\" HATEOAS link returned as
//    part of the response prior to authorizing or capturing the order."
import "server-only";
import { PayPalError, paypalFetch } from "./client";

export type CartItem = { name: string; quantity: number; unitAmount: number /* USD */; sku?: string };
export type Merchant = { id: string; name: string };

export type Authorization = { id: string; status: string; expirationTime?: string };
export type OrderResult = {
  id: string;
  status: string; // CREATED | APPROVED | COMPLETED | PAYER_ACTION_REQUIRED | ...
  authorization?: Authorization;
  /** Set only on the fallback path: buyer must approve in a browser before authorize. */
  approveUrl?: string;
};
/** Buyer-approval redirect targets (absolute URLs on this app). */
export type PayerUrls = { returnUrl: string; cancelUrl: string };
export type CaptureResult = { id: string; status: string };
export type VoidResult = { authorizationId: string; status: string };

type RawOrder = {
  id: string;
  status: string;
  links?: { rel: string; href: string }[];
  purchase_units?: {
    payments?: { authorizations?: { id: string; status: string; expiration_time?: string }[] };
  }[];
};

// Money in cents to avoid float drift (0.1 + 0.2), then formatted as PayPal's "12.34" strings.
const cents = (usd: number) => Math.round(usd * 100);
const money = (c: number) => ({ currency_code: "USD", value: (c / 100).toFixed(2) });

export function orderTotalCents(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + cents(i.unitAmount) * i.quantity, 0);
}

function purchaseUnit(items: CartItem[], merchant: Merchant) {
  const total = orderTotalCents(items);
  return {
    reference_id: merchant.id,
    description: `CartHold: ${merchant.name}`.slice(0, 127),
    // Spec: when items are sent, amount.breakdown.item_total must equal sum(unit_amount * quantity).
    amount: { ...money(total), breakdown: { item_total: money(total) } },
    items: items.map((i) => ({
      name: i.name.slice(0, 127),
      quantity: String(i.quantity),
      unit_amount: money(cents(i.unitAmount)),
      ...(i.sku ? { sku: i.sku } : {}),
    })),
  };
}

function toResult(o: RawOrder): OrderResult {
  const a = o.purchase_units?.[0]?.payments?.authorizations?.[0];
  const approve = o.links?.find((l) => l.rel === "approve" || l.rel === "payer-action")?.href;
  return {
    id: o.id,
    status: o.status,
    ...(a ? { authorization: { id: a.id, status: a.status, expirationTime: a.expiration_time } } : {}),
    ...(approve && !a ? { approveUrl: approve } : {}),
  };
}

/**
 * Create an intent=AUTHORIZE order paid by the sandbox test card (no browser redirect).
 *
 * FALLBACK: if PayPal rejects the card payment_source (4xx, e.g. card processing not enabled on the
 * sandbox business account), re-create the order with no payment_source and return its rel:approve
 * link as `approveUrl`. A sandbox personal (buyer) account must open that link once and approve;
 * after that, authorizeOrder(id) works. A PAYER_ACTION_REQUIRED status (e.g. 3DS) also surfaces its
 * payer-action link as `approveUrl`.
 *
 * `requestId` defaults to a fresh UUID; pass a stable one to make retries of the same call idempotent.
 *
 * `payer`: no card at all. payment_source.paypal makes PayPal answer PAYER_ACTION_REQUIRED with a payer-action link
 * (returned as `approveUrl`); the buyer approves there, PayPal redirects to returnUrl, then authorizeOrder(id).
 */
export async function createAuthorizeOrder(
  items: CartItem[],
  merchant: Merchant,
  opts: { requestId?: string; cardName?: string; payer?: PayerUrls } = {},
): Promise<OrderResult> {
  if (items.length === 0) throw new Error("createAuthorizeOrder: no items");
  for (const i of items) {
    if (!Number.isInteger(i.quantity) || i.quantity < 1) throw new Error(`bad quantity for ${i.name}`);
    if (!(i.unitAmount > 0)) throw new Error(`bad unitAmount for ${i.name}`);
  }
  const unit = purchaseUnit(items, merchant);
  const requestId = opts.requestId ?? crypto.randomUUID();
  if (opts.payer) {
    const experience_context = {
      brand_name: "CartHold",
      shipping_preference: "NO_SHIPPING",
      user_action: "PAY_NOW",
      return_url: opts.payer.returnUrl,
      cancel_url: opts.payer.cancelUrl,
    };
    const order = await paypalFetch<RawOrder>("/v2/checkout/orders", {
      requestId,
      body: { intent: "AUTHORIZE", purchase_units: [unit], payment_source: { paypal: { experience_context } } },
    });
    return toResult(order);
  }
  try {
    const order = await paypalFetch<RawOrder>("/v2/checkout/orders", {
      requestId,
      body: {
        intent: "AUTHORIZE",
        purchase_units: [unit],
        payment_source: {
          // cardName "CCREJECT-REFUSED" simulates a decline (card-testing page).
          card: { name: opts.cardName ?? "CartHold", number: "4012888888881881", expiry: "2030-12", security_code: "123" },
        },
      },
    });
    return toResult(order);
  } catch (e) {
    // 5xx / network: let caller retry with the same requestId. 4xx on the card: buyer-approval fallback.
    if (!(e instanceof PayPalError) || e.status >= 500) throw e;
    const order = await paypalFetch<RawOrder>("/v2/checkout/orders", {
      // Different body -> must not reuse the card call's id; derived so a retry stays idempotent.
      // A fresh UUID is 36 chars, so "-b" keeps it within PayPal's 38-char limit.
      requestId: `${requestId}-b`,
      body: { intent: "AUTHORIZE", purchase_units: [unit] },
    });
    return toResult(order);
  }
}

/** POST /v2/checkout/orders/{id}/authorize -> money held. */
export async function authorizeOrder(id: string, requestId: string = crypto.randomUUID()): Promise<OrderResult> {
  const order = await paypalFetch<RawOrder>(`/v2/checkout/orders/${encodeURIComponent(id)}/authorize`, {
    body: {},
    requestId,
  });
  return toResult(order);
}

/** Full-amount capture (spec: "If amount is not specified, the full authorized amount is captured"). */
export async function captureAuthorization(
  authId: string,
  requestId: string = crypto.randomUUID(),
): Promise<CaptureResult> {
  const cap = await paypalFetch<{ id: string; status: string }>(
    `/v2/payments/authorizations/${encodeURIComponent(authId)}/capture`,
    { body: { final_capture: true }, requestId },
  );
  return { id: cap.id, status: cap.status };
}

/** Void a held authorization. Spec: 200 (with Prefer: return=representation) or 204 No Content. */
export async function voidAuthorization(authId: string, requestId: string = crypto.randomUUID()): Promise<VoidResult> {
  const res = await paypalFetch<{ id?: string; status?: string }>(
    `/v2/payments/authorizations/${encodeURIComponent(authId)}/void`,
    { requestId },
  );
  return { authorizationId: res.id ?? authId, status: res.status ?? "VOIDED" };
}

export async function getOrder(id: string): Promise<OrderResult> {
  return toResult(await paypalFetch<RawOrder>(`/v2/checkout/orders/${encodeURIComponent(id)}`, { method: "GET" }));
}
