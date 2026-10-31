// Vault spike step 3/3: buyer NOT present. vault_id -> Orders v2 intent=AUTHORIZE (merchant-initiated,
// single step per Orders v2 spec example) -> authorize if the create didn't already -> void. Prints ids only.
// Run from web/: npx -y tsx --conditions=react-server scripts/vault-authorize.mts <vaultId>
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
const { buildVaultAuthorizeOrder } = await import("../src/lib/paypal/vault");
const { paypalFetch, PayPalError } = await import("../src/lib/paypal/client");
const { authorizeOrder, voidAuthorization } = await import("../src/lib/paypal/orders");

type Order = { id: string; status: string; purchase_units?: { payments?: { authorizations?: { id: string; status: string }[] } }[] };
const vaultId = process.argv[2];
if (!vaultId) throw new Error("usage: vault-authorize.mts <vaultId>");
try {
  const unit = { reference_id: "spike", description: "CartHold vault spike", amount: { currency_code: "USD", value: "1.00" } };
  const o = await paypalFetch<Order>("/v2/checkout/orders", { body: buildVaultAuthorizeOrder(unit, vaultId), requestId: crypto.randomUUID() });
  console.log("order", o.id, "status", o.status);
  let auth = o.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth) auth = (await authorizeOrder(o.id)).authorization;
  console.log("authorization", auth?.id, auth?.status);
  if (auth) console.log("void", JSON.stringify(await voidAuthorization(auth.id)));
} catch (e) {
  if (e instanceof PayPalError) console.log("FAILED status", e.status, "name", e.name_, "debug_id", e.debugId, JSON.stringify(e.details ?? null));
  else console.log("FAILED", (e as Error).name, (e as Error).message);
  process.exitCode = 1;
}
