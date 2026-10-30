import { writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createGuard, type PayPalApi } from "../../lib/guard/guard";
import { FIXTURE_MANDATE, FIXTURE_STEPS, type FixtureRun } from "./fixtures";
import recorded from "./fixture-run.json";

// The fixture is a recording of the REAL guard (regex inspector, fake PayPal ids) on FIXTURE_STEPS, so
// /demo?fixture=1 can only show flows the guard actually produces. After a guard/policy change, re-record:
//   UPDATE_FIXTURE=1 npx vitest run src/components/demo/fixtures.test.ts
const ORDERS = ["7KL55210AB998812C", "5O190127TN364715T", "1MN83472PQ556677R"];
const AUTHS = ["3XY99001ZZ441122Q", "8AB12345CD678901E", "6RS12093TU887766V"];
const CAPS = ["2GG27911LT0912345", "9FX40112HD7731220", "4HJ66120KL883301M"];

async function record(): Promise<FixtureRun> {
  delete process.env.GEMINI_API_KEY; // regex inspector only: no network
  let n = 0;
  const paypal = {
    createAuthorizeOrder: async () => {
      const i = n++;
      return { id: ORDERS[i], status: "COMPLETED", authorization: { id: AUTHS[i], status: "CREATED" } };
    },
    authorizeOrder: async () => {
      throw new Error("unused: createAuthorizeOrder already returns the authorization");
    },
    captureAuthorization: async (a: string) => ({ id: CAPS[AUTHS.indexOf(a)], status: "COMPLETED" }),
    voidAuthorization: async (a: string) => ({ authorizationId: a, status: "VOIDED" }),
    getOrder: async (id: string) => ({ id, status: "COMPLETED" }),
  } as unknown as PayPalApi;
  const g = createGuard({ mandate: FIXTURE_MANDATE, paypal, llm: undefined });
  const results: string[] = [];
  for (const s of FIXTURE_STEPS) {
    if (s.read) g.notePageRead(s.read);
    results.push(await g.onProposeOrder(s.order));
  }
  const state = g.getState();
  for (const id of state.pendingHolds) await g.reject(id).catch(() => {}); // clears the auto-void timers
  // Time-dependent fields are re-stamped by fixtures.ts at render time.
  const rows = state.rows.map((r) => {
    const copy: Partial<typeof r> = { ...r };
    delete copy.time;
    delete copy.expiresAt;
    return copy;
  });
  return JSON.parse(JSON.stringify({ rows, results }));
}

describe("demo fixture", () => {
  it("is exactly what the real guard produces for FIXTURE_STEPS", async () => {
    const real = await record();
    if (process.env.UPDATE_FIXTURE) writeFileSync(new URL("./fixture-run.json", import.meta.url), JSON.stringify(real, null, 2) + "\n");
    else expect(recorded).toEqual(real);
  });
});
