// One Gemini REST call with a 20s timeout and a single retry on 429/5xx.
// Errors carry only the status; upstream bodies are logged server-side, never returned (FINDINGS #12, #24).
/** The one Gemini model every call uses (agent + inspector). Pinned, not the -latest alias: Google hot-swaps aliases on new releases (ai.google.dev/gemini-api/docs/models). */
export const GEMINI_MODEL = "gemini-3.5-flash-lite";
const BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
const TIMEOUT_MS = 20_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function postGemini(modelMethod: string, body: unknown, retryDelayMs = 1000): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(BASE + modelMethod, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return res.json();
    const retryable = res.status === 429 || res.status >= 500;
    console.error(`gemini ${res.status} (attempt ${attempt + 1}):`, (await res.text()).slice(0, 500));
    if (!retryable || attempt >= 1) throw new Error(`gemini ${res.status}`);
    await new Promise((r) => setTimeout(r, retryDelayMs));
  }
}
