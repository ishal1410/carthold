// Vault spike step 2/3: exchange an APPROVED setup token for a payment token (vault_id).
// Run from web/: npx -y tsx --conditions=react-server scripts/vault-finish.mts <setupTokenId>
// Prints only a vault_id prefix (pass --full to print the whole id for step 3).
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
const { createPaymentToken } = await import("../src/lib/paypal/vault");
const { PayPalError } = await import("../src/lib/paypal/client");

const id = process.argv[2];
if (!id) throw new Error("usage: vault-finish.mts <setupTokenId>");
try {
  const t = await createPaymentToken(id);
  console.log("vault_id", process.argv.includes("--full") ? t.vaultId : `${t.vaultId.slice(0, 4)}...`, "payer", t.payerEmail ?? "?");
} catch (e) {
  if (e instanceof PayPalError) console.log("FAILED status", e.status, "name", e.name_, "debug_id", e.debugId, JSON.stringify(e.details ?? null));
  else console.log("FAILED", (e as Error).name, (e as Error).message);
  process.exitCode = 1;
}
