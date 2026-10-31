import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));

import type { PayPalApi } from "../guard/guard";
import { DEFAULT_MANDATE, createRun, getRun, resetRuns, setRunDeps, subscribeRun, type Runner, type StreamMsg } from "./session";
import { clientIp, resetLimits, takeHoldSlot, takeIpSlot } from "./limits";
import { readJsonPost } from "./http";
import { POST as createRunRoute } from "../../app/api/runs/route";
import { GET as streamRoute } from "../../app/api/runs/[runId]/stream/route";
import { POST as holdRoute } from "../../app/api/runs/[runId]/holds/[rowId]/route";
import { GET as scorecardRoute } from "../../app/api/scorecard/route";
import { GET as storeTextRoute } from "../../app/api/stores/[slug]/text/route";

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

async function startRun(body: unknown = MUG) {
  const res = await createRunRoute(post(body));
  expect(res.status).toBe(201);
  return ((await res.json()) as { runId: string }).runId;
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
    const ip = { "x-forwarded-for": "10.0.0.1, 1.2.3.4" };
    for (let i = 0; i < 6; i++) expect((await createRunRoute(post(MUG, ip))).status).toBe(201);
    const res = await createRunRoute(post(MUG, ip));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/too many runs/);
    expect((await createRunRoute(post(MUG, { "x-forwarded-for": "5.6.7.8" }))).status).toBe(201);
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
      new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: '{"action":"reject"}' }),
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
      new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }),
      params({ runId, rowId }),
    );

  it("415 without application/json, 403 cross-origin", async () => {
    const runId = await startRun();
    const rowId = holdId(await waitEnd(runId));
    expect((await act(runId, rowId, { action: "approve" }, { "content-type": "text/plain" })).status).toBe(415);
    expect((await act(runId, rowId, { action: "approve" }, { origin: "https://evil.example" })).status).toBe(403);
    expect(pp.captureAuthorization).not.toHaveBeenCalled();
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

  it("404 unknown run, 409 unknown row, 400 bad action", async () => {
    const runId = await startRun();
    await waitEnd(runId);
    expect((await act("nope", "d1", { action: "approve" })).status).toBe(404);
    expect((await act(runId, "d99", { action: "approve" })).status).toBe(409);
    expect((await act(runId, "d1", { action: "capture" })).status).toBe(400);
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
      new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ action }) }),
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
    for (let i = 0; i < 6; i++) expect((await createRunRoute(post(MUG, { "x-forwarded-for": `7.7.7.${i}, 1.2.3.4` }))).status).toBe(201);
    expect((await createRunRoute(post(MUG, { "x-forwarded-for": "8.8.8.8, 1.2.3.4" }))).status).toBe(429);
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
    const run = createRun({ userRequest: "mug", mode: "live" });
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
    holdRoute(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...headers }, body }), params({ runId, rowId: "d99" }));

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
