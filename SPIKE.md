# SPIKE: PayPal toolkit check + AUTHORIZE flow (2026-10-28)

Primary sources only: npm tarballs (extracted to `spike/_pkg/`, nothing executed), PayPal OpenAPI specs, PayPal developer docs, Google AI docs.

## 1. Toolkit tool list (read from `@paypal/agent-toolkit@1.11.0` dist, `ai-sdk/index.js`)

`@paypal/mcp@1.8.1` is a thin stdio wrapper: its `dist/index.js` only `require("@paypal/agent-toolkit/mcp")`, and its package.json pins `"@paypal/agent-toolkit": "latest"`. So the MCP server exposes the same tools.

All 47 tool `method`s: accept_dispute_claim, activate_recurring_series, cancel_invoice_auto_reminder, cancel_recurring_series, cancel_sent_invoice, cancel_subscription, create_conditional_rules_for_invoice, create_invoice, **create_order**, create_product, create_recurring_series, create_refund, create_shipment_tracking, create_subscription, create_subscription_plan, delete_invoice, delete_recurring_series, generate_invoice_number, generate_invoice_qr_code, get_dispute, get_invoice, get_merchant_insights, **get_order**, get_recurring_series, get_refund, get_shipment_tracking, list_disputes, list_invoices, list_products, list_subscription_plans, list_transactions, **pay_order**, record_payment_for_invoice, record_refund_for_invoice, search_invoicing, send_invoice, send_invoice_reminder, setup_invoice_auto_reminders, show_product_details, show_subscription_details, show_subscription_plan_details, update_invoice_auto_reminder, update_invoicing, update_plan, update_product, update_shipment_tracking, update_subscription.

Order tools (zod schemas from source):
- `create_order` (actions `orders.create`): `{ currencyCode: enum["USD"], items: [{ name, quantity=1, description?, itemCost, taxPercent=0, itemTotal }] (max 50), discount?=0, shippingCost?=0, shippingAddress?, notes?, returnUrl?="https://example.com/returnUrl", cancelUrl?="https://example.com/cancelUrl" }`
- `get_order` (`orders.get`): `{ id }`
- `pay_order` (`orders.capture`), name "Process payment for an authorized order": `{ id }` -> `POST /v2/checkout/orders/{id}/capture` with `{}` body.

**create_order hardcodes CAPTURE.** Source: `y={intent:"CAPTURE",purchase_units:[...]}`, and the only payment_source it ever sends is `{paypal:{experience_context:{return_url,cancel_url}}}` (buyer redirect). No `intent` parameter exists.

**No authorize / capture-authorization / void tools.** A grep of the bundle for `authorize`/`authorization`/`void` finds only the OAuth `Authorization` header and pay_order's description text. Note: pay_order's name says "authorized order", but it calls the *order* capture endpoint. It does not touch `/v2/payments/authorizations`.

=> AUTHORIZE, capture-authorization and void must be direct REST calls (see `spike/authorize-flow.ts`).

## 2. Orders v2 AUTHORIZE flow (sandbox, no browser)

Spec: https://developer.paypal.com/api/orders/v2/schema.json
- `checkout_payment_intent` AUTHORIZE: "The merchant intends to authorize a payment and place funds on hold after the customer makes a payment. Authorized payments are best captured within three days of authorization but are available to capture for up to 29 days. After the three-day honor period, the original authorized payment expires and you must re-authorize the payment."
- `POST /v2/checkout/orders/{id}/authorize`: "To successfully authorize payment for an order, the buyer must first approve the order or a valid payment_source must be provided in the request. A buyer can approve the order upon being redirected to the rel:approve URL..."
- `card_request` fields: `name`, `number` (`^[0-9]{13,19}$`), `expiry` ("For example: 2028-04"), `security_code` (3-4 digits). Spec note: "Passing card number, cvv and expiry directly via the API requires PCI SAQ D compliance" (applies to real cards; sandbox test cards are fine for a demo).
- `PayPal-Request-Id`: "A unique ID identifying the request header for idempotency purposes." (required: false)
- Order status `COMPLETED`: "A completed order can indicate a payment was authorized, an authorized payment was captured, or a payment was declined." `PAYER_ACTION_REQUIRED`: the order "requires an action from the payer (e.g. 3DS authentication)".

Sandbox card flow, https://developer.paypal.com/tools/sandbox/card-testing/ (Authorize payment section):
1. "Make a create order call with intent as AUTHORIZE that includes a payment_source object with a valid card number."
2. "Authorize the order."
3. "Complete the authorized order using capture authorized payment call."
4. "Confirm that the capture status is COMPLETED in the authorization response."
- Test card: "Test using a Visa card number, such as 4012 8888 8888 1881, with a future expiration date and any 3-digit CVV."
- Declines: "Enter a rejection trigger in the First Name or Name on Card to simulate credit card error scenarios." e.g. `CCREJECT-REFUSED`. This is useful for a "card declined" demo beat.

Payments v2 spec: https://developer.paypal.com/api/payments/v2/schema.json
- `POST /v2/payments/authorizations/{authorization_id}/capture`: "Captures an authorized payment, by ID." Body: `amount` ("If amount is not specified, the full authorized amount is captured"), `final_capture`, `invoice_id`.
- `POST /v2/payments/authorizations/{authorization_id}/void`: "Voids, or cancels, an authorized payment, by ID. You cannot void an authorized payment that has been fully captured." Responses: 200 / 204.

**Answer: yes**, the docs describe create(AUTHORIZE + card payment_source) -> authorize with no redirect. UNVERIFIED until run: whether the sandbox app's default business account has card processing enabled (the card-testing page doesn't mention ACDC eligibility). Fallback if create returns an error or `PAYER_ACTION_REQUIRED`: buyer-approve the `rel:approve` link once with a sandbox personal account. That link does need a browser. (Since verified: the card path works, see "Verified sandbox runs" below.)

## 3. Decision: direct REST, no toolkit

CartHold does not use `@paypal/agent-toolkit` or `@paypal/mcp` at runtime, and the package is not installed. The reason is section 1: the toolkit's `create_order` hardcodes `intent: "CAPTURE"` with a buyer-redirect payment source, and it has no tools for authorize, capture-authorization or void. CartHold's safety primitive is an authorization hold that a human captures or voids, so every PayPal step is a direct REST call in `web/src/lib/paypal` (OAuth, create AUTHORIZE order with a sandbox card, authorize, capture, void). The agent only sees one `propose_order` tool and never holds PayPal credentials.

## 4. Free LLM

https://ai.google.dev/gemini-api/docs/pricing: Gemini 2.5 Flash, 2.5 Flash-Lite and 3 Flash Preview all show Free Tier input/output "Free of charge" (free-tier data "Used to improve our products": Yes). https://ai.google.dev/gemini-api/docs/function-calling: "Function calling lets you connect models to external tools and APIs." **Yes**, free tier with function calling.

## Verified sandbox runs

Real PayPal sandbox ids from verified runs:

| Flow | Ids |
|---|---|
| Spike `authorize-flow.ts void` | authorization voided: `9S0542931V850621T` |
| Spike `authorize-flow.ts capture` | capture: `7VE43424H86013848` |
| Guarded run: hold, then human Approve | order `8HC52952RT288635L`, capture `8VE65984J0016352T` |
| Round-1 QA run in the browser: Approve | order `0WW91005W72065834`, capture `12543692F1954200M` |
| Round-1 QA run in the browser: Reject | authorization `6KP64629H7699140C` voided |
| Round-2 QA run in the browser: Approve | order `1E943314CU814705W`, capture `01K348840S099210H` |
| Round-2 QA run in the browser: Reject | authorization `9PV35600E0696470Y` voided |
| Round-3 live run `091f3156`: Gemini followed the Trailhead note, was refused, retried with the mug alone, held, approved | order `05S854780E163201L`, authorization `5CP66355XD594173N`, capture `9CB73521V0143864G` |

The card `payment_source` worked on the default sandbox business account, so no buyer redirect is needed.

What happened in each run, with sources: [docs/evidence/2026-10-29-live-runs.md](docs/evidence/2026-10-29-live-runs.md).
