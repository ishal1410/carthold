import { afterEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
const unsubscribe = vi.fn();
vi.mock("../../../../../lib/run/session", () => ({
  // A run with a pending hold: never settled, no messages, so only the heartbeat writes.
  getRun: () => ({ listeners: new Set(), guard: { getState: () => ({ rows: [] }) } }),
  isSettled: () => false,
  subscribeRun: () => unsubscribe,
}));
vi.mock("../../../../../lib/run/limits", () => ({ acquireStream: () => () => {}, clientIp: () => "1.1.1.1" }));

import { GET } from "./route";

afterEach(() => vi.useRealTimers());

it("sends an SSE comment heartbeat every 25 s while idle, and stops it on abort", async () => {
  vi.useFakeTimers();
  const ac = new AbortController();
  const res = await GET(new Request("http://x", { signal: ac.signal }), { params: Promise.resolve({ runId: "r" }) });
  const reader = res.body!.getReader();
  await vi.advanceTimersByTimeAsync(24_999);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(new TextDecoder().decode((await reader.read()).value)).toBe(": ping\n\n");
  ac.abort();
  expect(unsubscribe).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  expect((await reader.read()).done).toBe(true);
});
