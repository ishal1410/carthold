// Real agent (Gemini) + real guard + REAL PayPal sandbox. Two agent runs max (free Gemini quota).
// Usage (from web/): npx -y tsx --conditions=react-server scripts/run-guarded.mts
//   (react-server condition makes the "server-only" marker import a no-op outside Next.)
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());

const { runAgent } = await import("../src/lib/agent/agent");
const { createGuard } = await import("../src/lib/guard/guard");
const orders = await import("../src/lib/paypal/orders");

const base = {
  budgetUsd: 100,
  perItemCapUsd: 60,
  approvalThresholdUsd: 25,
  merchantAllowlist: ["Trailhead Outfitters", "Brew & Bean", "GiftHub Deals"],
  maxQuantity: 2,
};

// Count every PayPal call so the block scenario can prove zero.
let paypalCalls = 0;
const counted = <F extends (...a: never[]) => Promise<unknown>>(f: F) => ((...a: Parameters<F>) => (paypalCalls++, f(...a))) as F;
const paypal = {
  createAuthorizeOrder: counted(orders.createAuthorizeOrder),
  authorizeOrder: counted(orders.authorizeOrder),
  captureAuthorization: counted(orders.captureAuthorization),
  voidAuthorization: counted(orders.voidAuthorization),
};

for (const userRequest of ["Buy me a camping coffee mug under $40", "Cheap wireless earbuds under $50"]) {
  console.log(`\n=== ${userRequest}`);
  paypalCalls = 0;
  const guard = createGuard({ mandate: { ...base, userRequest }, paypal, holdTimeoutMs: 10 * 60_000 });
  await runAgent({
    userRequest,
    onProposeOrder: async (o) => {
      const r = await guard.onProposeOrder(o);
      console.log(`  propose ${o.merchant}: ${o.items.map((i) => `${i.quantity}x ${i.name} $${i.unitPriceUsd}`).join(", ")} -> ${r}`);
      return r;
    },
    onEvent: (e) => {
      if (e.type === "tool_call" && e.name !== "propose_order") console.log(`  [${e.step}] ${e.name} ${JSON.stringify(e.args)}`);
      else if (e.type === "done") console.log(`  done: ${e.reason}${e.error ? ` ${e.error}` : ""}`);
    },
  });
  console.log(`  amount at risk before approval: $${guard.getState().amountAtRiskUsd}`);
  for (const id of guard.getState().pendingHolds) {
    const row = await guard.approve(id); // script stands in for the human tapping Approve
    console.log(`  approved ${id} -> ${row.status}`);
  }
  const s = guard.getState();
  console.log(`  paypal calls: ${paypalCalls}, amount at risk now: $${s.amountAtRiskUsd}`);
  for (const r of s.rows)
    console.log(`  row ${r.id} ${r.verdict}/${r.status} $${r.amountUsd} order=${r.paypalOrderId ?? "-"} auth=${r.authorizationId ?? "-"} capture=${r.captureId ?? "-"} reasons=${JSON.stringify(r.reasons)}`);
}
