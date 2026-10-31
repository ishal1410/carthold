// Abuse limits (FINDINGS #18, R2-G/SSE): per-IP fixed windows, global daily cap on live runs, concurrent SSE streams per IP.
// ponytail: in-process counters; one instance only. Shared store (Upstash/Redis) if this ever scales out.
const RUN_LIMIT = 6;
const RUN_WINDOW_MS = 10 * 60_000;
const HOLD_LIMIT = 30;
const HOLD_WINDOW_MS = 60_000;
const STREAMS_PER_IP = 20;
const WEBHOOK_LIMIT = 60;
const WEBHOOK_WINDOW_MS = 60_000;
const MAX_WINDOWS = 10_000;

type Windows = Map<string, { start: number; end: number; count: number }>;
// R4 #3: run and hold windows live in separate maps, so spraying /api/runs can never fill the hold map.
type State = { runs: Windows; holds: Windows; webhooks: Windows; day: string; live: number; simDay: string; sim: number; streams: Map<string, number> };
const g = globalThis as unknown as { __cartholdLimits?: State };
const fresh = (): State => ({ runs: new Map(), holds: new Map(), webhooks: new Map(), day: "", live: 0, simDay: "", sim: 0, streams: new Map() });
const state = () => (g.__cartholdLimits ??= fresh());

export const resetLimits = () => void (g.__cartholdLimits = fresh());

/**
 * Client IP = the x-forwarded-for entry TRUSTED_PROXY_HOPS (default 1) from the right; "local" without the header.
 * Never the leftmost entry: proxies append, so anything left of our trusted hops is client-controlled.
 * Render appends the connecting address to any client-sent XFF instead of replacing it (a spoofed leftmost
 * value survives), so with Render's proxy as the only hop the rightmost entry is the real client:
 * https://feedback.render.com/features/p/send-the-correct-xforwardedfor
 * Put a CDN (e.g. Cloudflare) in front and you need TRUSTED_PROXY_HOPS=2.
 */
export function clientIp(req: Request): string {
  // Render sits behind Cloudflare and only appends to x-forwarded-for (live check 2026-10-30: 7 spoofed XFF requests all got 201).
  // Cloudflare overwrites True-Client-IP / CF-Connecting-IP, so on Render set CLIENT_IP_HEADER=true-client-ip.
  // https://community.render.com/t/accessing-client-ips-in-a-node-express-app/36282
  const named = process.env.CLIENT_IP_HEADER?.trim();
  const direct = named ? req.headers.get(named)?.split(",")[0]?.trim() : undefined;
  if (direct) return direct;
  const hops = req.headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  if (!hops.length) return "local";
  const n = Math.max(1, Math.floor(Number(process.env.TRUSTED_PROXY_HOPS ?? 1)) || 1);
  return hops[Math.max(0, hops.length - n)];
}

function takeSlot(windows: Windows, key: string, limit: number, windowMs: number, now: number, evictWhenFull: boolean): boolean {
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    if (!w && windows.size >= MAX_WINDOWS) {
      // R3 #13: sweep expired windows; never drop a live one for runs (that would reset an attacker's own limit).
      for (const [k, v] of windows) if (now >= v.end) windows.delete(k);
      if (windows.size >= MAX_WINDOWS) {
        // ponytail: O(n) sweep only when full. Runs: full of live windows = IP-spray, new IPs wait (fail closed;
        // a run costs LLM/PayPal calls). Holds: evict the oldest window instead (R4 #3d). A hold decision only acts
        // on a hold that already exists, so a sprayer resetting its own 30/min hold window gains nothing, while
        // refusing would lock a real user out of approving/rejecting their own pending hold.
        if (!evictWhenFull) return false;
        windows.delete(windows.keys().next().value!);
      }
    }
    windows.delete(key); // re-insert at the end: Map order = window start order, so first key = oldest
    windows.set(key, { start: now, end: now + windowMs, count: 1 });
    return true;
  }
  if (w.count >= limit) return false;
  w.count++;
  return true;
}

/** Counts one run attempt for ip; false once the window's limit is used up. Call only for a valid request. */
export const takeIpSlot = (ip: string, now = Date.now()) => takeSlot(state().runs, ip, RUN_LIMIT, RUN_WINDOW_MS, now, false);

/** Counts one hold decision for ip (30/min). Call only after readJsonPost accepted the request. */
export const takeHoldSlot = (ip: string, now = Date.now()) => takeSlot(state().holds, ip, HOLD_LIMIT, HOLD_WINDOW_MS, now, true);

/** Counts one webhook POST for ip (60/min), before any PayPal OAuth / verify call. Fails closed when the map is
 *  full of live windows: PayPal retries a refused delivery for 3 days, a flood must not reach PayPal's rate limit. */
export const takeWebhookSlot = (ip: string, now = Date.now()) => takeSlot(state().webhooks, ip, WEBHOOK_LIMIT, WEBHOOK_WINDOW_MS, now, false);

/** Reserves one concurrent SSE stream for ip. Returns its release fn (idempotent), or null at the cap. */
export function acquireStream(ip: string): (() => void) | null {
  const { streams } = state();
  const n = streams.get(ip) ?? 0;
  if (n >= STREAMS_PER_IP) return null;
  streams.set(ip, n + 1);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const s = state().streams;
    const left = (s.get(ip) ?? 1) - 1;
    if (left > 0) s.set(ip, left);
    else s.delete(ip);
  };
}

/** Counts one live run against today's (UTC) cap from LIVE_RUNS_PER_DAY (default 60). */
export function takeLiveSlot(now = new Date()): boolean {
  const s = state();
  const day = now.toISOString().slice(0, 10);
  if (s.day !== day) Object.assign(s, { day, live: 0 });
  const cap = Number(process.env.LIVE_RUNS_PER_DAY ?? 60);
  if (s.live >= (Number.isFinite(cap) ? cap : 60)) return false;
  s.live++;
  return true;
}

/** Counts one simulated run against today's (UTC) cap from SIMULATED_RUNS_PER_DAY (default 200). Simulated runs skip
 *  Gemini but still make real PayPal sandbox calls (the redteam clean-mug retry authorizes an order). */
export function takeSimulatedSlot(now = new Date()): boolean {
  const s = state();
  const day = now.toISOString().slice(0, 10);
  if (s.simDay !== day) Object.assign(s, { simDay: day, sim: 0 });
  const cap = Number(process.env.SIMULATED_RUNS_PER_DAY ?? 200);
  if (s.sim >= (Number.isFinite(cap) ? cap : 200)) return false;
  s.sim++;
  return true;
}

/** Gives back a simulated slot takeSimulatedSlot counted today (B11). */
export function refundSimulatedSlot() {
  const s = state();
  if (s.sim > 0) s.sim--;
}

/** Gives back a run slot takeIpSlot counted (B11: the run was never created). */
export function refundIpSlot(ip: string) {
  const w = state().runs.get(ip);
  if (w && w.count > 0) w.count--;
}

/** Gives back a live slot takeLiveSlot counted today (B11). */
export function refundLiveSlot() {
  const s = state();
  if (s.live > 0) s.live--;
}
