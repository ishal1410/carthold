// Vault spike step 1/3: create a PayPal Vault v3 setup token (sandbox) and print its approve URL.
// Run from web/: npx -y tsx --conditions=react-server scripts/vault-setup.mts [returnBaseUrl]
// Then open the approve URL in a browser, log in as a SANDBOX PERSONAL (buyer) account, approve.
// PayPal redirects to <base>/vault/return?approval_token_id=... (page may 404 locally; that's fine),
// then run vault-finish.mts with the setup token id printed here.
// Prints HTTP status / PayPal error name only on failure; never prints keys or access tokens.
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
const { createSetupToken } = await import("../src/lib/paypal/vault");
const { PayPalError } = await import("../src/lib/paypal/client");

const base = process.argv[2] ?? "http://localhost:3000";
try {
  const t = await createSetupToken({ returnUrl: `${base}/vault/return`, cancelUrl: `${base}/vault/cancel` });
  console.log("setup token", t.id, "status", t.status);
  console.log("approve url host", t.approveUrl ? new URL(t.approveUrl).host : "(none)");
  if (process.argv.includes("--print-url")) console.log("approve url", t.approveUrl);
} catch (e) {
  if (e instanceof PayPalError) console.log("FAILED status", e.status, "name", e.name_, "debug_id", e.debugId, JSON.stringify(e.details ?? null));
  else console.log("FAILED", (e as Error).name, (e as Error).message);
  process.exitCode = 1;
}
