// Registers CartHold's webhook on the PayPal app, once. Sandbox only (client.baseUrl throws for any other PAYPAL_ENVIRONMENT).
// Lists the app's webhooks (GET /v1/notifications/webhooks); creates one (POST, { url, event_types: [{ name }] })
// only if none already points at WEBHOOK_URL. Prints the webhook id (not a secret) for PAYPAL_WEBHOOK_ID.
// Source: https://developer.paypal.com/api/webhooks/v1/schema.json (webhooks.list / webhooks.post / webhooks.delete)
// Usage (from web/):
//   npx -y tsx --conditions=react-server scripts/paypal-webhook-register.mts
//   npx -y tsx --conditions=react-server scripts/paypal-webhook-register.mts --delete <WEBHOOK_ID>   (undo; 204 No Content)
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());

const { baseUrl, getAccessToken, paypalFetch } = await import("../src/lib/paypal/client");
const { WEBHOOK_EVENT_TYPES } = await import("../src/lib/paypal/webhook");

const WEBHOOK_URL = "https://carthold.onrender.com/api/paypal/webhook";
const self = "npx -y tsx --conditions=react-server scripts/paypal-webhook-register.mts";
console.log(`PayPal API: ${baseUrl()}`);

const del = process.argv.indexOf("--delete");
if (del !== -1) {
  const id = process.argv[del + 1];
  if (!/^[A-Za-z0-9]+$/.test(id ?? "")) throw new Error("usage: --delete <WEBHOOK_ID>");
  const res = await fetch(`${baseUrl()}/v1/notifications/webhooks/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${await getAccessToken()}` },
  });
  console.log(`DELETE webhook ${id} -> ${res.status}${res.status === 204 ? " (deleted)" : ""}`);
  process.exit(res.status === 204 ? 0 : 1);
}

type Webhook = { id: string; url: string; event_types?: { name: string }[] };
const { webhooks = [] } = await paypalFetch<{ webhooks?: Webhook[] }>("/v1/notifications/webhooks", { method: "GET" });
let hook = webhooks.find((w) => w.url === WEBHOOK_URL);
if (hook) {
  console.log("Already registered, nothing created.");
  const have = new Set(hook.event_types?.map((e) => e.name));
  const missing = WEBHOOK_EVENT_TYPES.filter((t) => !have.has(t));
  if (missing.length) console.log(`WARNING: existing webhook is missing event types: ${missing.join(", ")}`);
} else {
  hook = await paypalFetch<Webhook>("/v1/notifications/webhooks", {
    body: { url: WEBHOOK_URL, event_types: WEBHOOK_EVENT_TYPES.map((name) => ({ name })) },
  });
  console.log("Created.");
}
console.log(`webhook id:  ${hook.id}`);
console.log(`webhook url: ${hook.url}`);
console.log(`events:      ${(hook.event_types ?? []).map((e) => e.name).join(", ")}`);
console.log(`\nSet PAYPAL_WEBHOOK_ID=${hook.id} in the Render dashboard (carthold -> Environment).`);
console.log(`Undo: ${self} --delete ${hook.id}`);
