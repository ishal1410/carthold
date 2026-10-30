// AgentGuard spike: PayPal sandbox AUTHORIZE -> capture | void, no browser.
// Usage: PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... npx tsx authorize-flow.ts [capture|void] [amount]
// Sources:
//  - Orders v2 spec: https://developer.paypal.com/api/orders/v2/schema.json
//    intent AUTHORIZE: "authorize a payment and place funds on hold after the customer makes a payment"
//    /authorize: "the buyer must first approve the order or a valid payment_source must be provided"
//  - Sandbox card flow: https://developer.paypal.com/tools/sandbox/card-testing/
//    "Make a create order call with intent as AUTHORIZE that includes a payment_source object with a valid card number."
//  - Payments v2 spec: https://developer.paypal.com/api/payments/v2/schema.json
//    POST /v2/payments/authorizations/{id}/capture | /void
// Requires Node 18+ (global fetch, crypto.randomUUID).

const BASE = "https://api-m.sandbox.paypal.com";
const mode = process.argv[2] ?? "capture";
const amount = process.argv[3] ?? "30.00";
if (mode !== "capture" && mode !== "void") throw new Error("argv[2] must be capture or void");

const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) throw new Error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET");

async function call(path: string, token: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": crypto.randomUUID(), // optional idempotency header per spec
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${text}`);
  return json;
}

async function main() {
  // 1. OAuth2 client_credentials token
  const tokRes = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!tokRes.ok) throw new Error(`token -> ${tokRes.status}: ${await tokRes.text()}`);
  const token: string = (await tokRes.json()).access_token;

  // 2. Create order, intent AUTHORIZE, sandbox test Visa from card-testing page.
  // Name "CCREJECT-REFUSED" would simulate a decline (same page).
  const order = await call("/v2/checkout/orders", token, {
    intent: "AUTHORIZE",
    purchase_units: [{ amount: { currency_code: "USD", value: amount }, description: "AgentGuard demo" }],
    payment_source: {
      card: { name: "Agent Guard", number: "4012888888881881", expiry: "2030-12", security_code: "123" },
    },
  });
  console.log("order", order.id, order.status);

  // 3. Authorize. ponytail: if create already returned COMPLETED with an authorization, reuse it
  // (spec: "A completed order can indicate a payment was authorized").
  const existing = order.purchase_units?.[0]?.payments?.authorizations?.[0];
  const authed = existing ? order : await call(`/v2/checkout/orders/${order.id}/authorize`, token, {});
  const auth = authed.purchase_units[0].payments.authorizations[0];
  console.log("authorization", auth.id, auth.status, auth.expiration_time ?? "");

  // 4. Capture (full amount when body has no amount) or void (204 No Content).
  if (mode === "capture") {
    const cap = await call(`/v2/payments/authorizations/${auth.id}/capture`, token, { final_capture: true });
    console.log("capture", cap.id, cap.status);
  } else {
    await call(`/v2/payments/authorizations/${auth.id}/void`, token);
    console.log("voided", auth.id);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
