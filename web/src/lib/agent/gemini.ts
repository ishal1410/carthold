// One Gemini REST call with a 20s timeout and a single retry on 429/5xx.
// Errors carry only the status; upstream bodies are logged server-side, never returned (FINDINGS #12, #24).
/** The one Gemini model every call uses (agent + inspector). Pinned, not the -latest alias: Google hot-swaps aliases on new releases (ai.google.dev/gemini-api/docs/models). */
export const GEMINI_MODEL = "gemini-3.5-flash-lite";
const BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
const TIMEOUT_MS = 20_000;
const DEFAULT_RETRY_MS = 2_000;

/** Gemini still answered 429 after the retry (free tier: 15 requests/min). */
export class GeminiRateLimitError extends Error {
  constructor() {
    super("gemini 429");
    this.name = "GeminiRateLimitError";
  }
}

/** Wait Gemini asks for: RetryInfo.retryDelay in the 429 body ("7s"), else Retry-After (seconds), else null (no hint). */
function retryHint(res: Response, body: string): number | null {
  try {
    const details = (JSON.parse(body) as { error?: { details?: { retryDelay?: unknown }[] } }).error?.details ?? [];
    const d = details.find((x) => typeof x?.retryDelay === "string")?.retryDelay as string | undefined;
    const s = d ? parseFloat(d) : NaN;
    if (Number.isFinite(s)) return s * 1000;
  } catch {}
  const h = Number(res.headers.get("retry-after"));
  return res.headers.has("retry-after") && Number.isFinite(h) ? h * 1000 : null;
}

/** maxDelayMs caps the wait before the retry (tests pass 0). A 429 hint above it throws at once (m3: the retry would be refused anyway). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function postGemini(modelMethod: string, body: unknown, maxDelayMs = 10_000): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(BASE + modelMethod, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return res.json();
    const retryable = res.status === 429 || res.status >= 500;
    const text = await res.text();
    console.error(`gemini ${res.status} (attempt ${attempt + 1}):`, text.slice(0, 500));
    if (!retryable || attempt >= 1) throw res.status === 429 ? new GeminiRateLimitError() : new Error(`gemini ${res.status}`);
    const hint = res.status === 429 ? retryHint(res, text) : null;
    if (hint !== null && hint > maxDelayMs) throw new GeminiRateLimitError();
    const wait = Math.max(0, Math.min(hint ?? DEFAULT_RETRY_MS, maxDelayMs));
    await new Promise((r) => setTimeout(r, wait));
  }
}
