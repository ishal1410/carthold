// "Approve with PayPal" hand-off between the PayPal return page and the /demo tab that owns the run.
// PayPal sends the buyer back to the hold's return_url (or cancel_url) with token=<order id> appended; the order id is
// re-checked server-side against the row, so these helpers only validate shape.

export const PAYER_MSG = "carthold:paypal-return";
/** Same-origin BroadcastChannel: reaches the /demo tab even when PayPal's page cut window.opener. */
export const PAYER_CHANNEL = "carthold-paypal";
/** sessionStorage: the /demo URL to come back to (same-tab fallback when the popup was blocked). */
export const PAYER_BACK_KEY = "carthold:payer-back";
/** sessionStorage: the return message, handed from the return page to /demo in the same-tab fallback. */
export const PAYER_RETURN_KEY = "carthold:payer-return";

export type PayerReturn = { type: typeof PAYER_MSG; run: string; row: string; orderId: string; cancelled: boolean };

const ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * m6: drop any stale same-tab back-link, then open the popup. A popup starts with a copy of this tab's sessionStorage,
 * so a leftover PAYER_BACK_KEY would make the return page inside the popup navigate to /demo instead of messaging us.
 */
export function openPayerWindow(open: () => Window | null, storage: () => Pick<Storage, "removeItem"> = () => sessionStorage): Window | null {
  try {
    storage().removeItem(PAYER_BACK_KEY);
  } catch {}
  return open();
}

/** Return page query -> message, or null when it is not a CartHold PayPal return. A cancel may lack a token. */
export function parsePayerReturn(search: string): PayerReturn | null {
  const q = new URLSearchParams(search);
  const run = q.get("run") ?? "", row = q.get("row") ?? "", orderId = q.get("token") ?? "";
  const cancelled = q.get("cancelled") === "1";
  if (!ID.test(run) || !ID.test(row) || (!cancelled && !ID.test(orderId)) || (orderId && !ID.test(orderId))) return null;
  return { type: PAYER_MSG, run, row, orderId, cancelled };
}

/** A postMessage / BroadcastChannel / sessionStorage payload, accepted only if well formed and for this run. */
export function payerMessageFor(data: unknown, runId: string | null): PayerReturn | null {
  const m = data as Partial<PayerReturn> | null;
  if (!m || typeof m !== "object" || m.type !== PAYER_MSG || m.run !== runId) return null;
  if (typeof m.row !== "string" || !ID.test(m.row) || typeof m.orderId !== "string" || typeof m.cancelled !== "boolean") return null;
  if (!m.cancelled && !ID.test(m.orderId)) return null;
  return { type: PAYER_MSG, run: m.run, row: m.row, orderId: m.orderId, cancelled: m.cancelled };
}
