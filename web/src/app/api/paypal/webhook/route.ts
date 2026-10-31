// PayPal -> CartHold webhook. Verified with PayPal's verify-webhook-signature before anything is applied
// (see lib/paypal/webhook.ts). Fails closed (503) until PAYPAL_WEBHOOK_ID is set.
import { handleWebhook } from "../../../../lib/paypal/webhook";
import { applyPayPalEvent } from "../../../../lib/run/session";

export const POST = (req: Request) => handleWebhook(req, applyPayPalEvent);
