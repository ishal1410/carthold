import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));

import type { PayPalApi } from "../guard/guard";
import { DEFAULT_MANDATE, RunsFullError, createRun, getRun, isSettled, resetRuns, setRunDeps, subscribeRun, voidAllHolds, type Runner, type StreamMsg } from "./session";
import { clientIp, resetLimits, takeHoldSlot, takeIpSlot } from "./limits";
import { readJsonPost } from "./http";
import { runRedteam } from "../redteam/redteam";
import { POST as createRunRoute } from "../../app/api/runs/route";
import { GET as streamRoute } from "../../app/api/runs/[runId]/stream/route";
import { GET as payerUrlRoute, POST as holdRoute } from "../../app/api/runs/[runId]/holds/[rowId]/route";
import { GET as scorecardRoute } from "../../app/api/scorecard/route";
import { GET as storeTextRoute } from "../../app/api/stores/[slug]/text/route";
import { POST as webhookRoute } from "../../app/api/paypal/webhook/route";

const cleanLlm = async () => JSON.stringify({ flagged: false, quote: null, reason: "ok" });
const paypal = (): PayPalApi =>
  ({
    createAuthorizeOrder: vi.fn(async () => ({ id: "O1", status: "COMPLETED", authorization: { id: "A1", status: "CREATED" } })),
    authorizeOrder: vi.fn(),
    captureAuthorization: vi.fn(async (a: string) => ({ id: `C-${a}`, status: "COMPLETED" })),
    voidAuthorization: vi.fn(async (a: string) => ({ authorizationId: a, status: "VOIDED" })),
  }) as unknown as PayPalApi;

// Fake agent: proposes one $28 pour-over cone from honest Brew & Bean (allowed, under cap, over the $25 threshold -> hold).
const holdRunner: Runner = async ({ onProposeOrder, onEvent = () => {} }) => {
  onEvent({ type: "step", step: 1 });
  const result = await onProposeOrder({
    merchant: "Brew & Bean",
    items: [{ name: "Ceramic Pour-Over Cone", quantity: 1, unitPriceUsd: 28 }],
    sourceSlug: "brew-and-bean",
  });
  onEvent({ type: "tool_result", step: 1, name: "propose_order", result });
  onEvent({ type: "done", reason: "final_answer", text: "ok" });
};

let pp: PayPalApi;
beforeEach(() => {
  resetLimits();
  resetRuns(); // unsettled runs count per IP (cso L1): a test's leftover holds must not block the next test's runs
  pp = paypal();
  setRunDeps({ runners: { live: holdRunner, redteam: holdRunner }, guard: { llm: cleanLlm, paypal: pp } });
});
afterEach(() => setRunDeps(undefined));

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const MUG = { userRequest: "Buy me a ceramic pour-over cone under $50", mode: "live" };
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

/** ownerToken per runId, returned once by POST /api/runs. */
const tokens = new Map<string, string>();
const auth = (runId: string): Record<string, string> =>
  tokens.has(runId) ? { authorization: `Bearer ${tokens.get(runId)}` } : {};

async function startRun(body: unknown = MUG) {
  const res = await createRunRoute(post(body));
  expect(res.status).toBe(201);
  const { runId, ownerToken } = (await res.json()) as { runId: string; ownerToken: string };
  tokens.set(runId, ownerToken);
  return runId;
}

/** Reads SSE messages until `until` matches, then aborts the request. */
async function readStream(runId: string, until: (msgs: StreamMsg[]) => boolean) {
  const ac = new AbortController();
  const res = await streamRoute(new Request(`http://x/api/runs/${runId}/stream`, { signal: ac.signal }), params({ runId }));
  expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const msgs: StreamMsg[] = [];
  let buf = "";
  while (!until(msgs)) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    const parts = buf.split("\n\n");
    buf = parts.pop()!;
    for (const p of parts) msgs.push(JSON.parse(p.replace(/^data: /, "")));
  }
  ac.abort();
  return msgs;
}

const waitEnd = (runId: string) => readStream(runId, (ms) => ms.some((m) => m.kind === "end"));
const holdId = (msgs: StreamMsg[]) => {
  const last = msgs.filter((m) => m.kind === "guard").at(-1) as Extract<StreamMsg, { kind: "guard" }>;
  return last.state.pendingHolds[0];
};

describe("POST /api/runs", () => {
  it.each([
    ["missing userRequest", { mode: "live" }],
    ["empty userRequest", { userRequest: "  ", mode: "live" }],
    ["bad mode", { userRequest: "mug", mode: "yolo" }],
    ["userRequest over 300 chars", { userRequest: "m".repeat(301), mode: "live" }],
    ["malformed JSON", "{nope"],
  ])("400 on %s", async (_name, body) => {
    const res = await createRunRoute(post(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid body/);
  });

  it("ignores a client-supplied mandate: server default + userRequest only", async () => {
    // A client asking for a $1e9 approval threshold must still get the $28 cone HELD, not paid.
    const runId = await startRun({ ...MUG, mandate: { approvalThresholdUsd: 1e9, budgetUsd: 1e9, perItemCapUsd: 1e9 } });
    const msgs = await waitEnd(runId);
    expect(getRun(runId)!.mandate).toEqual({ ...DEFAULT_MANDATE, userRequest: MUG.userRequest });
    const result = msgs.find((m) => m.kind === "agent" && m.event.type === "tool_result");
    expect(result).toMatchObject({ event: { result: expect.stringMatching(/^HELD/) } });
    expect(pp.captureAuthorization).not.toHaveBeenCalled();
  });

  it("415 without application/json, 413 over 16KB", async () => {
    expect((await createRunRoute(post(MUG, { "content-type": "text/plain" }))).status).toBe(415);
    const big = await createRunRoute(post({ ...MUG, pad: "x".repeat(17_000) }));
    expect(big.status).toBe(413);
    expect((await big.json()).error).toMatch(/too large/);
  });

  it("403 when Origin host differs from the request host; same origin is fine", async () => {
    const res = await createRunRoute(post(MUG, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect((await createRunRoute(post(MUG, { origin: "http://x" }))).status).toBe(201);
  });

  it("429 after 6 runs per IP per window; other IPs unaffected", async () => {
    vi.stubEnv("LIVE_RUNS_PER_IP_DAY", "50");
    setRunDeps({ runners: { live: holdRunner, redteam: holdRunner }, guard: { llm: cleanLlm, paypal: pp }, maxUnsettledPerIp: 50 });
    const ip = { "x-forwarded-for": "10.0.0.1, 1.2.3.4" };
    for (let i = 0; i < 6; i++) expect((await createRunRoute(post(MUG, ip))).status).toBe(201);
    const res = await createRunRoute(post(MUG, ip));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/too many runs/);
    expect((await createRunRoute(post(MUG, { "x-forwarded-for": "5.6.7.8" }))).status).toBe(201);
    vi.unstubAllEnvs();
  });

  it("H1: 429 after LIVE_RUNS_PER_IP_DAY live runs from one IP, pointing to the recorded run; other IPs unaffected", async () => {
    vi.stubEnv("LIVE_RUNS_PER_IP_DAY", "2");
    try {
      const a = { "x-forwarded-for": "h1" };
      for (let i = 0; i < 2; i++) expect((await createRunRoute(post(MUG, a))).status).toBe(201);
      const res = await createRunRoute(post(MUG, a));
      expect(res.status).toBe(429);
      const msg = (await res.json()).error;
      expect(msg).toMatch(/no live runs left from this address today/);
      expect(msg).toContain("/demo?fixture=1");
      expect((await createRunRoute(post(MUG, { "x-forwarded-for": "h2" }))).status).toBe(201);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("H1: 429 after SIMULATED_RUNS_PER_IP_DAY simulated runs from one IP; other IPs unaffected", async () => {
    vi.stubEnv("SIMULATED_RUNS_PER_IP_DAY", "2");
    try {
      const RT = { ...MUG, mode: "redteam" };
      const a = { "x-forwarded-for": "h3" };
      for (let i = 0; i < 2; i++) expect((await createRunRoute(post(RT, a))).status).toBe(201);
      const res = await createRunRoute(post(RT, a));
      expect(res.status).toBe(429);
      const msg = (await res.json()).error;
      expect(msg).toMatch(/no simulated runs left from this address today/);
      expect(msg).toContain("/demo?fixture=1");
      expect((await createRunRoute(post(RT, { "x-forwarded-for": "h4" }))).status).toBe(201);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("H1: per-IP caps run before the global cap, so one IP's refused requests never use global slots", async () => {
    vi.stubEnv("LIVE_RUNS_PER_DAY", "3");
    vi.stubEnv("LIVE_RUNS_PER_IP_DAY", "1");
    try {
      const from = (ip: string) => createRunRoute(post(MUG, { "x-forwarded-for": ip }));
      expect((await from("g1")).status).toBe(201);
      for (let i = 0; i < 4; i++) expect((await from("g1")).status).toBe(429);
      expect((await from("g2")).status).toBe(201);
      expect((await from("g3")).status).toBe(201);
      const res = await from("g4");
      expect(res.status).toBe(429);
      expect((await res.json()).error).toMatch(/daily live run limit/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("H1: per-IP daily defaults are 4 live / 15 simulated and reset on the next UTC day", async () => {
    const { takeIpDaySlot } = await import("./limits");
    const d1 = new Date("2026-10-31T10:00:00Z");
    for (let i = 0; i < 4; i++) expect(takeIpDaySlot("ip", "live", d1)).toBe(true);
    expect(takeIpDaySlot("ip", "live", d1)).toBe(false);
    for (let i = 0; i < 15; i++) expect(takeIpDaySlot("ip", "redteam", d1)).toBe(true);
    expect(takeIpDaySlot("ip", "redteam", d1)).toBe(false);
    expect(takeIpDaySlot("other", "live", d1)).toBe(true);
    expect(takeIpDaySlot("ip", "live", new Date("2026-11-01T00:00:01Z"))).toBe(true);
  });

  it("L1: 429 once an IP has 3 unsettled runs (running or holding); other IPs fine; settling one frees a slot", async () => {
    const a = { "x-forwarded-for": "u1" };
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await createRunRoute(post(MUG, a));
      expect(res.status).toBe(201);
      const { runId, ownerToken } = await res.json();
      tokens.set(runId, ownerToken);
      ids.push(runId);
    }
    const res = await createRunRoute(post(MUG, a));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/unfinished runs/);
    expect((await createRunRoute(post(MUG, { "x-forwarded-for": "u2" }))).status).toBe(201);
    const rowId = holdId(await waitEnd(ids[0]));
    const rej = await holdRoute(
      new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...auth(ids[0]) }, body: JSON.stringify({ action: "reject" }) }),
      params({ runId: ids[0], rowId }),
    );
    expect(rej.status).toBe(200);
    // The refused request was refunded, so this is the IP's 4th counted live run of the day (default cap 4).
    expect((await createRunRoute(post(MUG, a))).status).toBe(201);
  });

  it("429 once LIVE_RUNS_PER_DAY live runs are used; redteam runs still allowed", async () => {
    vi.stubEnv("LIVE_RUNS_PER_DAY", "2");
    try {
      for (const ip of ["a", "b"]) expect((await createRunRoute(post(MUG, { "x-forwarded-for": ip }))).status).toBe(201);
      const res = await createRunRoute(post(MUG, { "x-forwarded-for": "c" }));
      expect(res.status).toBe(429);
      expect((await res.json()).error).toMatch(/daily live run limit/);
      expect((await createRunRoute(post({ ...MUG, mode: "redteam" }, { "x-forwarded-for": "c" }))).status).toBe(201);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("M1: 429 once SIMULATED_RUNS_PER_DAY simulated runs are used; live runs still allowed", async () => {
    vi.stubEnv("SIMULATED_RUNS_PER_DAY", "2");
    try {
      const RT = { ...MUG, mode: "redteam" };
      for (const ip of ["a", "b"]) expect((await createRunRoute(post(RT, { "x-forwarded-for": ip }))).status).toBe(201);
      const res = await createRunRoute(post(RT, { "x-forwarded-for": "c" }));
      expect(res.status).toBe(429);
      expect((await res.json()).error).toBe("daily demo limit reached, try the recorded run at /demo?fixture=1 or come back tomorrow");
      expect((await createRunRoute(post(MUG, { "x-forwarded-for": "c" }))).status).toBe(201);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("M1: simulated cap resets on the next UTC day", async () => {
    const { takeSimulatedSlot } = await import("./limits");
    vi.stubEnv("SIMULATED_RUNS_PER_DAY", "1");
    try {
      expect(takeSimulatedSlot(new Date("2026-10-31T23:59:00Z"))).toBe(true);
      expect(takeSimulatedSlot(new Date("2026-10-31T23:59:30Z"))).toBe(false);
      expect(takeSimulatedSlot(new Date("2026-11-01T00:00:01Z"))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("M1: a 503 (runs full) refunds the simulated slot", async () => {
    resetRuns();
    vi.stubEnv("SIMULATED_RUNS_PER_DAY", "2");
    try {
      let finish = () => {};
      const slow: Runner = () => new Promise<void>((r) => (finish = r));
      setRunDeps({ runners: { live: slow, redteam: slow }, guard: { llm: cleanLlm, paypal: pp }, maxRuns: 1 });
      const RT = { ...MUG, mode: "redteam" };
      const first = await startRun(RT);
      for (let i = 0; i < 4; i++) expect((await createRunRoute(post(RT, { "x-forwarded-for": `s${i}` }))).status).toBe(503);
      finish();
      await vi.waitFor(() => expect(getRun(first)!.ended).toBe(true));
      expect((await createRunRoute(post(RT, { "x-forwarded-for": "s9" }))).status).toBe(201);
    } finally {
      vi.unstubAllEnvs();
      resetRuns();
    }
  });

  it("runner errors reach the client as a generic message, details stay server-side", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    setRunDeps({ runners: { live: async () => { throw new Error("upstream body: secret-ish"); }, redteam: holdRunner }, guard: { llm: cleanLlm, paypal: pp } });
    const msgs = await waitEnd(await startRun());
    const done = msgs.find((m) => m.kind === "agent" && m.event.type === "done");
    expect(done).toMatchObject({ event: { reason: "error", error: "run failed, try again" } });
    expect(JSON.stringify(msgs)).not.toContain("secret-ish");
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("run eviction", () => {
  it("never evicts running runs or runs with pending holds; 503 when nothing is evictable", async () => {
    resetRuns();
    let finish = () => {};
    const slow: Runner = () => new Promise<void>((r) => (finish = r));
    setRunDeps({ runners: { live: holdRunner, redteam: slow }, guard: { llm: cleanLlm, paypal: pp }, maxRuns: 2 });
    const held = await startRun(); // ended, pending hold
    await waitEnd(held);
    const running = await startRun({ ...MUG, mode: "redteam" }); // still running
    const full = await createRunRoute(post(MUG));
    expect(full.status).toBe(503);
    expect(getRun(held) && getRun(running)).toBeTruthy();

    // Once the hold is decided, the ended run becomes evictable; the running one is still kept.
    await holdRoute(
      new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...auth(held) }, body: '{"action":"reject"}' }),
      params({ runId: held, rowId: holdId(await waitEnd(held)) }),
    );
    const next = await startRun();
    expect(getRun(held)).toBeUndefined();
    expect(getRun(running)).toBeDefined();
    expect(getRun(next)).toBeDefined();
    finish();
  });
});

describe("GET /api/runs/:runId/stream", () => {
  it("404 for unknown run", async () => {
    const res = await streamRoute(new Request("http://x"), params({ runId: "nope" }));
    expect(res.status).toBe(404);
  });

  it("late subscriber gets full history in order, then current guard state, and ends", async () => {
    const runId = await startRun();
    await waitEnd(runId); // first subscriber may join mid-run
    const late = await readStream(runId, (ms) => ms.length >= 8);
    const kinds = (ms: StreamMsg[]) => ms.map((m) => (m.kind === "agent" ? m.event.type : m.kind));
    // guard x3 = verdict, paypal order id, held. Then the on-connect snapshot after the replay.
    expect(kinds(late)).toEqual(["step", "guard", "guard", "guard", "tool_result", "done", "end", "guard"]);
    expect(late.at(-1)).toMatchObject({ kind: "guard", state: { pendingHolds: [expect.any(String)] } });
  });

  it("stops delivering to a subscriber after abort", async () => {
    const runId = await startRun();
    await waitEnd(runId);
    const { getRun } = await import("./session");
    expect(getRun(runId)!.listeners.size).toBe(0);
  });
});

describe("POST /api/runs/:runId/holds/:rowId", () => {
  const act = (runId: string, rowId: string, body: unknown, headers: Record<string, string> = {}) =>
    holdRoute(
      new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...auth(runId), ...headers }, body: JSON.stringify(body) }),
      params({ runId, rowId }),
    );

  it("415 without application/json, 403 cross-origin", async () => {
    const runId = await startRun();
    const rowId = holdId(await waitEnd(runId));
    expect((await act(runId, rowId, { action: "approve" }, { "content-type": "text/plain" })).status).toBe(415);
    const cross = await act(runId, rowId, { action: "approve" }, { origin: "https://evil.example" });
    expect(cross.status).toBe(403);
    expect((await cross.json()).error).toBe("cross-origin request refused"); // the origin check, not the owner gate
    expect(pp.captureAuthorization).not.toHaveBeenCalled();
  });

  it("non-owner gets 403 before body validation", async () => {
    const runId = await startRun();
    const rowId = holdId(await waitEnd(runId));
    const res = await act(runId, rowId, { action: "capture" }, { authorization: "" });
    expect(res.status).toBe(403);
  });

  it("approve captures, then a second decision is 409", async () => {
    const runId = await startRun();
    const rowId = holdId(await waitEnd(runId));
    const res = await act(runId, rowId, { action: "approve" });
    expect(res.status).toBe(200);
    const { state } = await res.json();
    expect(state.rows[0]).toMatchObject({ status: "captured", captureId: "C-A1" });
    expect(state.pendingHolds).toEqual([]);
    expect((await act(runId, rowId, { action: "reject" })).status).toBe(409);
  });

  it("reject voids the authorization", async () => {
    const runId = await startRun();
    const rowId = holdId(await waitEnd(runId));
    const res = await act(runId, rowId, { action: "reject" });
    expect(res.status).toBe(200);
    expect((await res.json()).state.rows[0].status).toBe("voided");
    expect(vi.mocked(pp.voidAuthorization).mock.calls[0][0]).toBe("A1");
  });

  it("403 without the owner token, with a wrong one, or with another run's; unknown run stays 404", async () => {
    const runId = await startRun();
    const rowId = holdId(await waitEnd(runId));
    const other = await startRun();
    await waitEnd(other);
    const forbidden = /only the person who started this run/;
    for (const headers of [
      { authorization: "" },
      { authorization: "Bearer " },
      { authorization: "Bearer not-the-token" },
      { authorization: `Basic ${tokens.get(runId)}` },
      { authorization: `Bearer ${tokens.get(runId)}x` },
      auth(other),
    ]) {
      const res = await act(runId, rowId, { action: "approve" }, headers);
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(forbidden);
    }
    // No authorization header at all.
    const bare = await holdRoute(
      new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: '{"action":"approve"}' }),
      params({ runId, rowId }),
    );
    expect(bare.status).toBe(403);
    // A valid token for some run never turns an unknown run into anything but 404.
    expect((await act("nope", rowId, { action: "approve" }, auth(runId))).status).toBe(404);
    expect((await act("nope", rowId, { action: "approve" }, { authorization: "" })).status).toBe(404);
    expect(pp.captureAuthorization).not.toHaveBeenCalled();
    expect(getRun(runId)!.guard.getState().pendingHolds).toEqual([rowId]);
    // The right token still works afterwards.
    const ok = await act(runId, rowId, { action: "approve" });
    expect(ok.status).toBe(200);
    expect(pp.captureAuthorization).toHaveBeenCalledTimes(1);
  });

  it("POST /api/runs returns a fresh ownerToken; neither it nor its hash is ever serialized", async () => {
    const runId = await startRun();
    const token = tokens.get(runId)!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes, base64url
    const second = await startRun();
    expect(tokens.get(second)).not.toBe(token);
    const run = getRun(runId)!;
    const hash = Object.values(run).find((v) => Buffer.isBuffer(v)) as Buffer | undefined;
    expect(hash?.length).toBe(32); // sha256 digest stored, not the token
    expect(JSON.stringify(run)).not.toContain(token);
    const msgs = await waitEnd(runId);
    const rowId = holdId(msgs);
    const res = await act(runId, rowId, { action: "reject" });
    const leaked = [token, hash!.toString("hex"), hash!.toString("base64"), hash!.toString("base64url")];
    for (const blob of [JSON.stringify(msgs), JSON.stringify(run.guard.getState()), JSON.stringify(run.messages), await res.text()])
      for (const secret of leaked) expect(blob).not.toContain(secret);
    expect(Object.values(run).some((v) => typeof v === "string" && v === token)).toBe(false);
  });

  it("404 unknown run, 409 unknown row, 400 bad action", async () => {
    const runId = await startRun();
    await waitEnd(runId);
    expect((await act("nope", "d1", { action: "approve" })).status).toBe(404);
    expect((await act(runId, "d99", { action: "approve" })).status).toBe(409);
    expect((await act(runId, "d1", { action: "capture" })).status).toBe(400);
  });
});

describe("Approve with PayPal holds (PAYPAL_HOLD_PAYER)", () => {
  const PAYER_URL = "https://www.sandbox.paypal.com/checkoutnow?token=O1";
  /** createAuthorizeOrder answers like the sandbox: payer flow -> PAYER_ACTION_REQUIRED, card -> authorized. */
  const payerPayPal = () => {
    const p = paypal();
    vi.mocked(p.createAuthorizeOrder).mockImplementation(async (_i, _m, o) =>
      o?.payer ? { id: "O1", status: "PAYER_ACTION_REQUIRED", approveUrl: PAYER_URL } : { id: "O1", status: "COMPLETED", authorization: { id: "A1", status: "CREATED" } },
    );
    vi.mocked(p.authorizeOrder).mockImplementation(async (id) => ({ id, status: "COMPLETED", authorization: { id: "A1", status: "CREATED" } }));
    return p;
  };
  const act = (runId: string, rowId: string, body: unknown, headers: Record<string, string> = {}) =>
    holdRoute(
      new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...auth(runId), ...headers }, body: JSON.stringify(body) }),
      params({ runId, rowId }),
    );
  const lastState = (msgs: StreamMsg[]) => (msgs.filter((m) => m.kind === "guard").at(-1) as Extract<StreamMsg, { kind: "guard" }>).state;

  beforeEach(() => {
    pp = payerPayPal();
    setRunDeps({ runners: { live: holdRunner, redteam: holdRunner }, guard: { llm: cleanLlm, paypal: pp } });
  });
  afterEach(() => {
    delete process.env.PAYPAL_HOLD_PAYER;
    delete process.env.PUBLIC_ORIGIN;
  });

  it("default: hold -> awaiting_payer with return/cancel urls on this origin; run not settled", async () => {
    process.env.PUBLIC_ORIGIN = "https://carthold.example";
    const runId = await startRun();
    const msgs = await waitEnd(runId);
    const row = lastState(msgs).rows[0];
    expect(row).toMatchObject({ status: "awaiting_payer" });
    expect(row.paypalOrderId).toBeUndefined(); // cso M1: viewers never get an awaiting order id
    expect(getRun(runId)!.guard.getState().rows[0].paypalOrderId).toBe("O1");
    const payer = (vi.mocked(pp.createAuthorizeOrder).mock.calls[0][2] as { payer: { returnUrl: string; cancelUrl: string } }).payer;
    expect(payer.returnUrl).toBe(`https://carthold.example/demo/paypal-return?run=${runId}&row=${row.id}`);
    expect(payer.cancelUrl).toBe(`https://carthold.example/demo/paypal-return?run=${runId}&row=${row.id}&cancelled=1`);
    expect(isSettled(getRun(runId)!)).toBe(false);
  });

  it("m5: the SSE stream never carries payerActionUrl (read-only viewers could approve with their own account)", async () => {
    const runId = await startRun();
    const msgs = await waitEnd(runId);
    expect(getRun(runId)!.guard.getState().rows[0].payerActionUrl).toBe(PAYER_URL);
    expect(JSON.stringify(msgs)).not.toContain("payerActionUrl");
    expect(JSON.stringify(msgs)).not.toContain("checkoutnow");
  });

  it("M1: the SSE stream never carries an awaiting row's PayPal order id (rows or agent text); it appears once authorized", async () => {
    const runId = await startRun();
    const msgs = await waitEnd(runId);
    const row = getRun(runId)!.guard.getState().rows[0];
    expect(row).toMatchObject({ status: "awaiting_payer", paypalOrderId: "O1" });
    expect(JSON.stringify(msgs)).not.toContain("O1");
    expect(lastState(msgs).rows[0].paypalOrderId).toBeUndefined();
    expect((await act(runId, row.id, { action: "payer-approved", orderId: "O1" })).status).toBe(200);
    const after = lastState(await readStream(runId, (ms) => ms.some((m) => m.kind === "guard" && m.state.rows[0]?.status === "held")));
    expect(after.rows[0]).toMatchObject({ status: "held", paypalOrderId: "O1", authorizationId: "A1" });
  });

  it("M1: the SSE stream sends only allowlisted row fields", async () => {
    const runId = await startRun();
    const msgs = await waitEnd(runId);
    const allowed = ["id", "time", "merchant", "items", "amountUsd", "verdict", "reasons", "triggeringText", "paypalOrderId", "authorizationId", "captureId", "status", "expiresAt", "decision", "unresolvable"];
    const g = getRun(runId)!.guard;
    const real = g.getState();
    // A field added to DecisionRow later must not reach viewers by default.
    vi.spyOn(g, "getState").mockReturnValue({ ...real, rows: real.rows.map((x) => ({ ...x, secretField: "leak-me" })) });
    const replayed = getRun(runId)!.messages.length; // history first, then the current-state frame from getState
    const again = await readStream(runId, (ms) => ms.length > replayed);
    for (const m of [...msgs, ...again]) if (m.kind === "guard") for (const row of m.state.rows) for (const k of Object.keys(row)) expect(allowed).toContain(k);
    expect(JSON.stringify(again)).not.toContain("leak-me");
  });

  it("find-bugs #5: payer-approved after the approval window lapsed during the PayPal call is 409, not 500", async () => {
    setRunDeps({ runners: { live: holdRunner, redteam: holdRunner }, guard: { llm: cleanLlm, paypal: pp, holdTimeoutMs: 100 } });
    vi.mocked(pp.authorizeOrder).mockImplementationOnce(
      () => new Promise((_r, rej) => setTimeout(() => rej(Object.assign(new Error("422"), { status: 422 })), 200)),
    );
    const runId = await startRun();
    const rowId = lastState(await waitEnd(runId)).rows[0].id;
    const res = await act(runId, rowId, { action: "payer-approved", orderId: "O1" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/approval window expired/);
  });

  it("m5: GET /holds/:row (owner Bearer only) hands out the payer-action link", async () => {
    const runId = await startRun();
    const rowId = lastState(await waitEnd(runId)).rows[0].id;
    const get = (headers: Record<string, string>, row = rowId) => payerUrlRoute(new Request("http://x", { headers }), params({ runId, rowId: row }));
    expect((await get({})).status).toBe(403);
    expect((await get({ authorization: "Bearer nope" })).status).toBe(403);
    const ok = await get(auth(runId));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ payerActionUrl: PAYER_URL });
    expect((await get(auth(runId), "d99")).status).toBe(409);
    expect((await payerUrlRoute(new Request("http://x"), params({ runId: "nope", rowId }))).status).toBe(404);
  });

  it("without PUBLIC_ORIGIN the request origin is used", async () => {
    const runId = await startRun();
    await waitEnd(runId);
    const payer = (vi.mocked(pp.createAuthorizeOrder).mock.calls[0][2] as { payer: { returnUrl: string } }).payer;
    expect(payer.returnUrl.startsWith("http://x/demo/paypal-return?run=")).toBe(true);
  });

  it("A4: production without PUBLIC_ORIGIN falls back to the card hold (req.url may be an internal origin) and warns once", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const runId = await startRun();
      const msgs = await waitEnd(runId);
      expect(lastState(msgs).rows[0].status).toBe("held");
      expect((vi.mocked(pp.createAuthorizeOrder).mock.calls[0][2] as { payer?: unknown }).payer).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("PUBLIC_ORIGIN");
    } finally {
      warn.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("A4: production requires an https PUBLIC_ORIGIN for PayPal approval, else card hold", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_ORIGIN", "http://carthold.example");
    try {
      const runId = await startRun();
      expect(lastState(await waitEnd(runId)).rows[0].status).toBe("held");
      vi.stubEnv("PUBLIC_ORIGIN", "https://carthold.example");
      const runId2 = await startRun();
      expect(lastState(await waitEnd(runId2)).rows[0].status).toBe("awaiting_payer");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("PAYPAL_HOLD_PAYER=card: holds use the sandbox card (no payer urls)", async () => {
    process.env.PAYPAL_HOLD_PAYER = "card";
    const runId = await startRun();
    const msgs = await waitEnd(runId);
    expect(lastState(msgs).rows[0].status).toBe("held");
    expect((vi.mocked(pp.createAuthorizeOrder).mock.calls[0][2] as { payer?: unknown }).payer).toBeUndefined();
  });

  it("payer-approved: 403 non-owner, 400 wrong/missing order id, then authorize -> held -> release captures", async () => {
    const runId = await startRun();
    const rowId = lastState(await waitEnd(runId)).rows[0].id;
    expect((await act(runId, rowId, { action: "payer-approved", orderId: "O1" }, { authorization: "Bearer nope" })).status).toBe(403);
    expect((await act(runId, rowId, { action: "payer-approved", orderId: "O2" })).status).toBe(400);
    expect((await act(runId, rowId, { action: "payer-approved" })).status).toBe(400);
    expect(pp.authorizeOrder).not.toHaveBeenCalled();
    // Release before the buyer approved: nothing to capture.
    expect((await act(runId, rowId, { action: "approve" })).status).toBe(409);
    const ok = await act(runId, rowId, { action: "payer-approved", orderId: "O1" });
    expect(ok.status).toBe(200);
    expect((await ok.json()).state.rows[0]).toMatchObject({ status: "held", authorizationId: "A1" });
    // Second delivery (popup message + broadcast) is idempotent.
    expect((await act(runId, rowId, { action: "payer-approved", orderId: "O1" })).status).toBe(200);
    expect(pp.authorizeOrder).toHaveBeenCalledTimes(1);
    const rel = await act(runId, rowId, { action: "approve" });
    expect((await rel.json()).state.rows[0]).toMatchObject({ status: "captured" });
  });

  it("payer-approved when PayPal says not approved yet: 409 with a message, row still awaiting", async () => {
    vi.mocked(pp.authorizeOrder).mockRejectedValueOnce(Object.assign(new Error("422"), { status: 422 }));
    const runId = await startRun();
    const rowId = lastState(await waitEnd(runId)).rows[0].id;
    const res = await act(runId, rowId, { action: "payer-approved", orderId: "O1" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/not approved in PayPal yet/);
    expect(getRun(runId)!.guard.getState().rows[0].status).toBe("awaiting_payer");
  });

  it("Simulated mug run: the clean retry goes through Approve with PayPal and the agent reports it HELD, never bought", async () => {
    setRunDeps({ runners: { live: holdRunner, redteam: runRedteam }, guard: { llm: null, paypal: pp } });
    const runId = await startRun({ userRequest: "Buy me a camping coffee mug under $40", mode: "redteam" });
    const msgs = await waitEnd(runId);
    const rows = lastState(msgs).rows;
    expect(rows.map((r) => r.status)).toEqual(["blocked", "awaiting_payer"]);
    expect(getRun(runId)!.guard.getState().rows[1].payerActionUrl).toBe(PAYER_URL);
    const done = msgs.find((m) => m.kind === "agent" && m.event.type === "done") as Extract<StreamMsg, { kind: "agent" }>;
    expect(JSON.stringify(done.event)).toMatch(/waiting for your approval in PayPal. Nothing is held or bought yet/);
    expect(JSON.stringify(done.event)).not.toMatch(/I bought/);
  }, 20_000);

  it("cancel before buyer approval: cancelled, no PayPal void; shutdown sweep expires awaiting rows", async () => {
    const runId = await startRun();
    const rowId = lastState(await waitEnd(runId)).rows[0].id;
    const res = await act(runId, rowId, { action: "reject" });
    expect((await res.json()).state.rows[0].status).toBe("cancelled");
    expect(pp.voidAuthorization).not.toHaveBeenCalled();
    expect(isSettled(getRun(runId)!)).toBe(true);
    const other = await startRun();
    await waitEnd(other);
    await voidAllHolds(1000);
    expect(getRun(other)!.guard.getState().rows[0].status).toBe("expired");
    expect(pp.voidAuthorization).not.toHaveBeenCalled();
    resetRuns();
  });
});

describe("read-only routes", () => {
  it("GET /api/scorecard returns headline numbers and rows", async () => {
    const res = await scorecardRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(body.rows.length);
    expect(body).toHaveProperty("attacksBlocked");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("GET /api/stores/:slug/text returns page text, 404 for unknown", async () => {
    const res = await storeTextRoute(new Request("http://x"), params({ slug: "giftlane" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ slug: "giftlane", merchant: "Giftlane Deals", text: expect.any(String) });
    expect((await storeTextRoute(new Request("http://x"), params({ slug: "nope" }))).status).toBe(404);
  });
});

describe("R2 hardening", () => {
  const holdAct = (runId: string, rowId: string, action: string, headers: Record<string, string> = {}) =>
    holdRoute(
      new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...auth(runId), ...headers }, body: JSON.stringify({ action }) }),
      params({ runId, rowId }),
    );

  it("F: body cap reads the stream incrementally and stops at 16KB (413) without draining it", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls++;
        if (pulls > 1000) return c.close(); // ~4MB if fully drained
        c.enqueue(new Uint8Array(4096).fill(32));
      },
    });
    const req = new Request("http://x/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half" } as RequestInit);
    const res = await readJsonPost(req);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(413);
    expect(pulls).toBeLessThan(10);
  });

  it("G2: CLIENT_IP_HEADER (e.g. true-client-ip set by Cloudflare on Render) wins over x-forwarded-for", () => {
    const r = (h: Record<string, string>) => new Request("http://x", { headers: h });
    vi.stubEnv("CLIENT_IP_HEADER", "true-client-ip");
    try {
      expect(clientIp(r({ "true-client-ip": "5.5.5.5", "x-forwarded-for": "6.6.6.6, 7.7.7.7" }))).toBe("5.5.5.5");
      expect(clientIp(r({ "true-client-ip": " 5.5.5.5 , 1.1.1.1" }))).toBe("5.5.5.5");
      // header missing: fall back to the x-forwarded-for rule
      expect(clientIp(r({ "x-forwarded-for": "6.6.6.6, 9.9.9.9" }))).toBe("9.9.9.9");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("G: client IP is TRUSTED_PROXY_HOPS from the right of x-forwarded-for; spoofed prefix ignored", () => {
    const r = (xff?: string) => new Request("http://x", { headers: xff ? { "x-forwarded-for": xff } : {} });
    expect(clientIp(r())).toBe("local");
    expect(clientIp(r("9.9.9.9"))).toBe("9.9.9.9");
    expect(clientIp(r("6.6.6.6, 9.9.9.9"))).toBe("9.9.9.9");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    try {
      expect(clientIp(r("6.6.6.6, 9.9.9.9, 10.0.0.2"))).toBe("9.9.9.9");
      expect(clientIp(r("9.9.9.9"))).toBe("9.9.9.9"); // fewer entries than hops: leftmost
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("#13: a full window map never resets an active IP's window; expired windows are swept to make room", () => {
    const t = 1_000_000;
    for (let i = 0; i < 6; i++) expect(takeIpSlot("1.1.1.1", t)).toBe(true);
    expect(takeIpSlot("1.1.1.1", t)).toBe(false);
    for (let i = 0; i < 10_050; i++) takeIpSlot(`spray-${i}`, t + 1);
    expect(takeIpSlot("1.1.1.1", t + 2)).toBe(false); // still limited, not reset by the spray
    // 10 min later every window has expired: a new IP gets in, and 1.1.1.1 gets a fresh window.
    expect(takeIpSlot("2.2.2.2", t + 10 * 60_000 + 5)).toBe(true);
    expect(takeIpSlot("1.1.1.1", t + 10 * 60_000 + 5)).toBe(true);
  });

  it("Origin: when PUBLIC_ORIGIN is set the Origin must equal it, Host is not trusted", async () => {
    vi.stubEnv("PUBLIC_ORIGIN", "https://carthold.example");
    try {
      expect((await createRunRoute(post(MUG, { origin: "http://x" }))).status).toBe(403); // matches spoofable Host only
      expect((await createRunRoute(post(MUG, { origin: "https://carthold.example" }))).status).toBe(201);
      expect((await createRunRoute(post(MUG, { origin: "https://carthold.example.evil" }))).status).toBe(403);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("G: prepending a fake IP does not get a fresh rate-limit bucket", async () => {
    vi.stubEnv("LIVE_RUNS_PER_IP_DAY", "50");
    setRunDeps({ runners: { live: holdRunner, redteam: holdRunner }, guard: { llm: cleanLlm, paypal: pp }, maxUnsettledPerIp: 50 });
    for (let i = 0; i < 6; i++) expect((await createRunRoute(post(MUG, { "x-forwarded-for": `7.7.7.${i}, 1.2.3.4` }))).status).toBe(201);
    expect((await (await createRunRoute(post(MUG, { "x-forwarded-for": "8.8.8.8, 1.2.3.4" }))).json()).error).toMatch(/too many runs/);
    vi.unstubAllEnvs();
  });

  it("E: a throwing listener is dropped; the agent run and other listeners keep going", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const runner: Runner = async ({ onEvent = () => {} }) => {
      onEvent({ type: "step", step: 1 });
      await gate;
      onEvent({ type: "step", step: 2 });
      onEvent({ type: "done", reason: "final_answer", text: "ok" });
    };
    setRunDeps({ runners: { live: runner, redteam: runner }, guard: { llm: cleanLlm, paypal: pp } });
    const { run } = createRun({ userRequest: "mug", mode: "live" });
    await new Promise((r) => setTimeout(r, 0));
    const good: StreamMsg[] = [];
    subscribeRun(run, () => {
      throw new Error("controller closed");
    });
    subscribeRun(run, (m) => good.push(m));
    release();
    await vi.waitFor(() => expect(run.ended).toBe(true));
    expect(good.filter((m) => m.kind === "agent").map((m) => (m as { event: { type: string } }).event.type)).toEqual(["step", "step", "done"]);
    expect(good.at(-1)).toEqual({ kind: "end" });
    expect(run.listeners.size).toBe(1);
  });

  it("D: never evicts a run with an unknown row; polls guard.resolveUnknown while unknown rows exist", async () => {
    resetRuns();
    vi.mocked(pp.voidAuthorization).mockRejectedValue(new Error("network"));
    setRunDeps({ runners: { live: holdRunner, redteam: holdRunner }, guard: { llm: cleanLlm, paypal: pp }, maxRuns: 1, resolveEveryMs: 20 });
    const runId = await startRun();
    const rowId = holdId(await waitEnd(runId));
    const run = getRun(runId)!;
    const resolveUnknown = vi.fn(async () => {});
    (run.guard as unknown as { resolveUnknown: typeof resolveUnknown }).resolveUnknown = resolveUnknown;
    await holdAct(runId, rowId, "reject");
    expect(run.guard.getState().rows[0].status).toBe("unknown");
    expect((await createRunRoute(post(MUG))).status).toBe(503);
    await vi.waitFor(() => expect(resolveUnknown).toHaveBeenCalledWith(rowId), { timeout: 1000 });
    resetRuns();
  });

  /** Run whose only row is "unknown" (void failed after reject), with state.unresolvable feature-flagged in. */
  async function unknownRun(unresolvable: boolean, deps: Record<string, unknown> = {}) {
    resetRuns();
    vi.mocked(pp.voidAuthorization).mockRejectedValue(new Error("network"));
    setRunDeps({ runners: { live: holdRunner, redteam: holdRunner }, guard: { llm: cleanLlm, paypal: pp }, maxRuns: 1, resolveEveryMs: 20, ...deps });
    const runId = await startRun();
    const rowId = holdId(await waitEnd(runId));
    const run = getRun(runId)!;
    const resolveUnknown = vi.fn(async () => {});
    (run.guard as unknown as { resolveUnknown: typeof resolveUnknown }).resolveUnknown = resolveUnknown;
    const getState = run.guard.getState;
    if (unresolvable) run.guard.getState = () => ({ ...getState(), unresolvable: [rowId] }) as ReturnType<typeof getState>;
    await holdAct(runId, rowId, "reject");
    expect(run.guard.getState().rows[0].status).toBe("unknown");
    return { run, runId, rowId, resolveUnknown };
  }

  it("#5: a run whose unknown rows are all unresolvable is evicted only after the 30 min TTL", async () => {
    let now = 1_000_000;
    const { runId } = await unknownRun(true, { now: () => now });
    expect((await createRunRoute(post(MUG))).status).toBe(503);
    now += 29 * 60_000;
    expect((await createRunRoute(post(MUG))).status).toBe(503);
    now += 2 * 60_000;
    expect((await createRunRoute(post(MUG))).status).toBe(201);
    expect(getRun(runId)).toBeUndefined();
    resetRuns();
  });

  it("#5: a resolvable unknown row is never evicted, even after the TTL", async () => {
    let now = 1_000_000;
    await unknownRun(false, { now: () => now });
    now += 60 * 60_000;
    expect((await createRunRoute(post(MUG))).status).toBe(503);
    resetRuns();
  });

  it("#5: the resolve poll stops for unresolvable rows", async () => {
    const { run, resolveUnknown } = await unknownRun(true);
    await new Promise((r) => setTimeout(r, 100));
    expect(resolveUnknown).not.toHaveBeenCalled();
    expect(run.resolveTimer).toBeUndefined();
    resetRuns();
  });

  it("SSE: closes after the run ended with nothing pending (end, then stream done)", async () => {
    setRunDeps({
      runners: { live: async ({ onEvent = () => {} }) => onEvent({ type: "done", reason: "final_answer", text: "nothing to buy" }), redteam: holdRunner },
      guard: { llm: cleanLlm, paypal: pp },
    });
    const runId = await startRun();
    await vi.waitFor(() => expect(getRun(runId)!.ended).toBe(true));
    const res = await streamRoute(new Request(`http://x/api/runs/${runId}/stream`), params({ runId }));
    const text = await res.text(); // resolves only if the server closes the stream
    const data = text.split("\n\n").filter((p) => p.startsWith("data: "));
    expect(data.at(-1)).toBe('data: {"kind":"end"}');
  });

  it("SSE: closes once the last hold is decided", async () => {
    const runId = await startRun();
    const rowId = holdId(await waitEnd(runId));
    const res = await streamRoute(new Request(`http://x/api/runs/${runId}/stream`), params({ runId }));
    const done = res.text();
    await holdAct(runId, rowId, "reject");
    expect(await done).toContain('"status":"voided"');
  });

  it("SSE: 429 over 10 concurrent streams per run", async () => {
    const runId = await startRun();
    await waitEnd(runId);
    const acs = Array.from({ length: 10 }, () => new AbortController());
    for (const ac of acs) expect((await streamRoute(new Request("http://x", { signal: ac.signal }), params({ runId }))).status).toBe(200);
    expect((await streamRoute(new Request("http://x"), params({ runId }))).status).toBe(429);
    acs.forEach((a) => a.abort());
    const ac = new AbortController();
    expect((await streamRoute(new Request("http://x", { signal: ac.signal }), params({ runId }))).status).toBe(200);
    ac.abort();
  });

  it("SSE: 429 over 20 concurrent streams per IP", async () => {
    const ids = [await startRun(), await startRun(), await startRun()];
    for (const id of ids) await waitEnd(id);
    const acs: AbortController[] = [];
    const open = async (runId: string, ip: string) => {
      const ac = new AbortController();
      acs.push(ac);
      return (await streamRoute(new Request("http://x", { signal: ac.signal, headers: { "x-forwarded-for": ip } }), params({ runId }))).status;
    };
    for (let i = 0; i < 20; i++) expect(await open(ids[i % 3], "4.4.4.4")).toBe(200);
    expect(await open(ids[0], "4.4.4.4")).toBe(429);
    expect(await open(ids[1], "5.5.5.5")).toBe(200);
    acs.forEach((a) => a.abort());
  });

  it("holds POST: 429 after 30 decisions per IP per minute", async () => {
    const runId = await startRun();
    await waitEnd(runId);
    const ip = { "x-forwarded-for": "3.3.3.3" };
    for (let i = 0; i < 30; i++) expect((await holdAct(runId, "d99", "approve", ip)).status).toBe(409);
    expect((await holdAct(runId, "d99", "approve", ip)).status).toBe(429);
    expect((await holdAct(runId, "d99", "approve", { "x-forwarded-for": "3.3.3.4" })).status).toBe(409);
  });
});

describe("R4 #3: limiter lockout", () => {
  const holdReq = (runId: string, headers: Record<string, string>, body = JSON.stringify({ action: "approve" })) =>
    holdRoute(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...auth(runId), ...headers }, body }), params({ runId, rowId: "d99" }));

  it("10k invalid POST /api/runs from distinct IPs do not fill the window map", async () => {
    for (let i = 0; i < 10_050; i++) {
      const res = await createRunRoute(post({}, { "x-forwarded-for": `9.${i >> 8}.${i & 255}.1` }));
      expect(res.status).toBe(400);
    }
    expect((await createRunRoute(post(MUG, { "x-forwarded-for": "6.6.6.6" }))).status).toBe(201);
  }, 60_000);

  it("invalid bodies do not use up a valid client's run slots", async () => {
    const ip = { "x-forwarded-for": "4.3.2.1" };
    for (let i = 0; i < 10; i++) expect((await createRunRoute(post({}, ip))).status).toBe(400);
    expect((await createRunRoute(post(MUG, ip))).status).toBe(201);
  });

  it("run-window spray cannot block hold decisions (separate maps)", () => {
    const t = 1_000_000;
    for (let i = 0; i < 10_050; i++) takeIpSlot(`spray-${i}`, t);
    expect(takeIpSlot("fresh", t + 1)).toBe(false); // runs: still fail closed
    expect(takeHoldSlot("fresh", t + 1)).toBe(true);
  });

  it("a hold map full of live windows evicts the oldest instead of refusing a new IP", () => {
    const t = 1_000_000;
    for (let i = 0; i < 10_000; i++) expect(takeHoldSlot(`spray-${i}`, t + i)).toBe(true);
    expect(takeHoldSlot("owner", t + 10_001)).toBe(true);
    // owner's window survives further eviction pressure (only the oldest are dropped)
    for (let i = 0; i < 29; i++) expect(takeHoldSlot("owner", t + 10_002)).toBe(true);
    expect(takeHoldSlot("owner", t + 10_002)).toBe(false);
  });

  it("cross-origin / text/plain hold POSTs do not consume the IP's hold slots", async () => {
    const runId = await startRun();
    await waitEnd(runId);
    const ip = { "x-forwarded-for": "3.3.3.9" };
    for (let i = 0; i < 40; i++) {
      expect((await holdReq(runId, { ...ip, "content-type": "text/plain" })).status).toBe(415);
      expect((await holdReq(runId, { ...ip, origin: "https://evil.example" })).status).toBe(403);
    }
    expect((await holdReq(runId, ip)).status).toBe(409);
  });

  it("token-less hold POSTs (shared-link viewers on the owner's IP) do not consume the owner's hold slots", async () => {
    const runId = await startRun();
    await waitEnd(runId);
    const ip = { "x-forwarded-for": "3.3.3.8" };
    for (let i = 0; i < 40; i++) expect((await holdReq(runId, { ...ip, authorization: "" })).status).toBe(403);
    expect((await holdReq(runId, ip)).status).toBe(409);
  });
});

describe("R4 #11: copy", () => {
  it("agent mandate summary says the $25 auto-pay is cumulative per run", async () => {
    let summary = "";
    setRunDeps({ runners: { live: async (o) => void (summary = o.mandateSummary ?? ""), redteam: holdRunner }, guard: { llm: cleanLlm, paypal: pp } });
    await startRun();
    await vi.waitFor(() => expect(summary).not.toBe(""));
    expect(summary).toContain("auto-pay up to $25 in total per run; anything beyond waits for approval");
    expect(summary).not.toMatch(/purchases over \$25 need approval/);
  });

  it("daily live cap error names the Simulated compromised agent, not red-team mode", async () => {
    vi.stubEnv("LIVE_RUNS_PER_DAY", "0");
    try {
      const res = await createRunRoute(post(MUG));
      expect(res.status).toBe(429);
      const { error } = await res.json();
      expect(error).toMatch(/Simulated compromised agent/);
      expect(error).not.toMatch(/red-team/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("R5 server bugs", () => {
  it("S1: a Simulated (redteam) run uses the Gemini inspector when GEMINI_API_KEY is set (scripted agent, so every call is the inspector)", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response("no", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      setRunDeps({ runners: { live: holdRunner, redteam: holdRunner }, guard: { paypal: pp } }); // no injected llm
      const geminiCalls = () => fetchMock.mock.calls.filter((c) => String((c as unknown[])[0]).includes("generativelanguage")).length;
      await waitEnd(await startRun({ ...MUG, mode: "redteam" }));
      expect(geminiCalls()).toBeGreaterThan(0); // holdRunner is a fake agent: these are inspector calls
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      err.mockRestore();
    }
  });

  it("m9/S1: real runRedteam through createRun, mug request: Gemini inspector called (agent stays scripted), regex fallback on error, row 1 blocked, row 2 held", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetchMock = vi.fn(async () => new Response("no", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      setRunDeps({ runners: { live: holdRunner, redteam: runRedteam }, guard: { paypal: pp } }); // production runner, no injected llm
      const { run } = createRun({ userRequest: "Buy me a camping coffee mug under $40", mode: "redteam" });
      await vi.waitFor(() => expect(run.ended).toBe(true), { timeout: 15_000 });
      // runRedteam never calls an LLM itself, so every Gemini request here is the guard's inspector (it answers 400 -> regex fallback).
      expect(fetchMock.mock.calls.filter((c) => String((c as unknown[])[0]).includes("generativelanguage")).length).toBeGreaterThan(0);
      const rows = run.guard.getState().rows;
      expect(rows).toHaveLength(2);
      expect(rows[0].status).toBe("blocked");
      expect(rows[1]).toMatchObject({ status: "held", authorizationId: "A1" });
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      resetRuns();
    }
  }, 20_000);

  it("B7: a hold whose approve is still capturing is not settled (timer gone, row still held)", async () => {
    let finishCapture = () => {};
    vi.mocked(pp.captureAuthorization).mockImplementation(
      (a: string) => new Promise((r) => (finishCapture = () => r({ id: `C-${a}`, status: "COMPLETED" }))),
    );
    const runId = await startRun();
    const rowId = holdId(await waitEnd(runId));
    const run = getRun(runId)!;
    const approving = run.guard.approve(rowId);
    expect(run.guard.getState().pendingHolds).toEqual([]);
    expect(run.guard.getState().rows[0].status).toBe("held");
    expect(isSettled(run)).toBe(false);
    finishCapture();
    await approving;
    expect(isSettled(run)).toBe(true);
  });

  it("B11: a 503 (runs full) refunds the IP and live slots", async () => {
    resetRuns();
    vi.stubEnv("LIVE_RUNS_PER_DAY", "2");
    try {
      let finish = () => {};
      const slow: Runner = () => new Promise<void>((r) => (finish = r));
      setRunDeps({ runners: { live: slow, redteam: slow }, guard: { llm: cleanLlm, paypal: pp }, maxRuns: 1 });
      const first = await startRun();
      for (let i = 0; i < 8; i++) expect((await createRunRoute(post(MUG))).status).toBe(503);
      finish();
      await vi.waitFor(() => expect(getRun(first)!.ended).toBe(true));
      expect((await createRunRoute(post(MUG))).status).toBe(201); // 2nd live slot and 2nd IP slot still free
    } finally {
      vi.unstubAllEnvs();
      resetRuns();
    }
  });

  it("B12: a stream for a run whose only open money is unresolvable unknown rows closes; TTL eviction still applies", async () => {
    resetRuns();
    vi.mocked(pp.voidAuthorization).mockRejectedValue(new Error("network"));
    let now = 1_000_000;
    setRunDeps({ runners: { live: holdRunner, redteam: holdRunner }, guard: { llm: cleanLlm, paypal: pp }, maxRuns: 1, resolveEveryMs: 20, now: () => now });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const runId = await startRun();
    const rowId = holdId(await waitEnd(runId));
    const run = getRun(runId)!;
    const getState = run.guard.getState;
    run.guard.getState = () => ({ ...getState(), unresolvable: [rowId] }) as ReturnType<typeof getState>;
    await run.guard.reject(rowId);
    expect(run.guard.getState().rows[0].status).toBe("unknown");
    const res = await streamRoute(new Request(`http://x/api/runs/${runId}/stream`), params({ runId }));
    const text = await res.text(); // resolves only if the server closes the stream
    expect(text.split("\n\n").filter((p) => p.startsWith("data: ")).at(-1)).toBe('data: {"kind":"end"}');
    expect(run.listeners.size).toBe(0);
    expect((await createRunRoute(post(MUG))).status).toBe(503); // not evicted before the TTL
    now += 31 * 60_000;
    expect((await createRunRoute(post(MUG))).status).toBe(201);
    err.mockRestore();
    resetRuns();
  });

  it("B3: voidAllHolds voids every pending hold across runs (system-voided)", async () => {
    resetRuns();
    const a = await startRun();
    const b = await startRun();
    await waitEnd(a);
    await waitEnd(b);
    await voidAllHolds();
    for (const id of [a, b]) {
      const s = getRun(id)!.guard.getState();
      expect(s.pendingHolds).toEqual([]);
      expect(s.rows[0]).toMatchObject({ status: "voided", decision: "system-voided" });
    }
    expect(pp.voidAuthorization).toHaveBeenCalledTimes(2);
    resetRuns();
  });

  it("B3: voidAllHolds gives up after its time cap when PayPal hangs", async () => {
    resetRuns();
    vi.mocked(pp.voidAuthorization).mockImplementation(() => new Promise(() => {}));
    await waitEnd(await startRun());
    const t = Date.now();
    await voidAllHolds(50);
    expect(Date.now() - t).toBeLessThan(1000);
    resetRuns();
  });
});

describe("m6: shutdown sweep", () => {
  afterEach(() => resetRuns());

  it("new runs get 503 once the sweep has started", async () => {
    resetRuns();
    await voidAllHolds(50);
    const res = await createRunRoute(post(MUG));
    expect(res.status).toBe(503);
    expect(() => createRun({ userRequest: "x", mode: "redteam" })).toThrow(RunsFullError);
  });

  it("a proposal arriving while shutting down is blocked before PayPal", async () => {
    resetRuns();
    let go = () => {};
    const gate = new Promise<void>((r) => (go = r));
    let result = "";
    const late: Runner = async ({ onProposeOrder, onEvent = () => {} }) => {
      await gate;
      result = await onProposeOrder({ merchant: "Brew & Bean", items: [{ name: "Ceramic Pour-Over Cone", quantity: 1, unitPriceUsd: 28 }], sourceSlug: "brew-and-bean" });
      onEvent({ type: "done", reason: "final_answer", text: "ok" });
    };
    setRunDeps({ runners: { live: late, redteam: late }, guard: { llm: cleanLlm, paypal: pp } });
    const runId = await startRun();
    await voidAllHolds(50);
    go();
    await vi.waitFor(() => expect(getRun(runId)!.ended).toBe(true));
    expect(result).toBe("BLOCKED by CartHold: server shutting down");
    expect(pp.createAuthorizeOrder).not.toHaveBeenCalled();
  });

  it("a hold whose authorize was in flight when the sweep began is still voided", async () => {
    resetRuns();
    let release = () => {};
    vi.mocked(pp.createAuthorizeOrder).mockImplementation(
      () => new Promise((r) => (release = () => r({ id: "O1", status: "COMPLETED", authorization: { id: "A1", status: "CREATED" } } as never))),
    );
    const runId = await startRun();
    await vi.waitFor(() => expect(pp.createAuthorizeOrder).toHaveBeenCalled());
    const sweep = voidAllHolds(2_000);
    release();
    await sweep;
    await vi.waitFor(() => expect(getRun(runId)!.guard.getState().rows[0]).toMatchObject({ status: "voided", decision: "system-voided" }));
    expect(getRun(runId)!.guard.getState().pendingHolds).toEqual([]);
  });
});

describe("POST /api/paypal/webhook (verified PayPal events reconcile rows across runs)", () => {
  const H = {
    "content-type": "application/json", "paypal-transmission-id": "tx", "paypal-transmission-time": "2026-10-31T10:00:00Z",
    "paypal-transmission-sig": "sig", "paypal-cert-url": "https://api.sandbox.paypal.com/cert", "paypal-auth-algo": "SHA256withRSA",
  };
  const hook = (event: unknown) =>
    webhookRoute(new Request("http://x/api/paypal/webhook", { method: "POST", headers: H, body: JSON.stringify(event) }));
  beforeEach(() => {
    resetRuns();
    vi.stubEnv("PAYPAL_CLIENT_ID", "id");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret");
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "WH123");
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.endsWith("/v1/oauth2/token") ? Response.json({ access_token: "t", expires_in: 3600 }) : Response.json({ verification_status: "SUCCESS" })));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetRuns();
  });

  it("a hold voided outside CartHold: row voided, hold cleared, owner approve is 409", async () => {
    const runId = await startRun();
    const rowId = holdId(await waitEnd(runId));
    const res = await hook({ id: "WH-run-1", event_type: "PAYMENT.AUTHORIZATION.VOIDED", resource: { id: "A1", status: "VOIDED" } });
    expect(res.status).toBe(200);
    expect(getRun(runId)!.guard.getState()).toMatchObject({ pendingHolds: [], amountAtRiskUsd: 0 });
    expect(getRun(runId)!.guard.getState().rows[0].status).toBe("voided");
    const act = await holdRoute(
      new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...auth(runId) }, body: JSON.stringify({ action: "approve" }) }),
      params({ runId, rowId }),
    );
    expect(act.status).toBe(409);
    expect(pp.captureAuthorization).not.toHaveBeenCalled();
  });

  it("503 without PAYPAL_WEBHOOK_ID: nothing changes", async () => {
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "");
    const runId = await startRun();
    await waitEnd(runId);
    expect((await hook({ id: "WH-run-2", event_type: "PAYMENT.AUTHORIZATION.VOIDED", resource: { id: "A1" } })).status).toBe(503);
    expect(getRun(runId)!.guard.getState().rows[0].status).toBe("held");
  });
});

describe("orphaned-hold sweep (crash recovery)", () => {
  afterEach(() => resetRuns());
  it("runs once per process on the first createRun; isKnown sees this process's authorizations", async () => {
    resetRuns();
    const sweepOrphans = vi.fn(async () => []);
    setRunDeps({ runners: { live: holdRunner, redteam: holdRunner }, guard: { llm: cleanLlm, paypal: pp }, sweepOrphans });
    const runId = await startRun();
    await waitEnd(runId);
    await startRun();
    expect(sweepOrphans).toHaveBeenCalledTimes(1);
    const { isKnown } = (sweepOrphans.mock.calls[0] as unknown as [{ isKnown: (a: string) => boolean }])[0];
    expect(isKnown("A1")).toBe(true);
    expect(isKnown("NOPE")).toBe(false);
  });

  it("sweep cutoff follows the configured hold timeout (payer window + held window)", async () => {
    resetRuns();
    const sweepOrphans = vi.fn(async () => []);
    setRunDeps({ runners: { live: holdRunner, redteam: holdRunner }, guard: { llm: cleanLlm, paypal: pp, holdTimeoutMs: 30_000 }, sweepOrphans });
    await waitEnd(await startRun());
    expect(sweepOrphans).toHaveBeenCalledWith(expect.objectContaining({ maxHoldLifetimeMs: 60_000 }));
  });
});
