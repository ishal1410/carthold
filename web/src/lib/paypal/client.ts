// PayPal REST client (server only). fetch-based, no SDK.
// OAuth2 client_credentials: POST /v1/oauth2/token, Basic auth, body grant_type=client_credentials,
// response { access_token, expires_in (seconds) }.
// Source: https://developer.paypal.com/api/rest/authentication/
// Never log or throw the client secret or the access token.
import "server-only";

// Sandbox ONLY, hard-coded: this hackathon build must never touch real money (no live PayPal path exists).
const SANDBOX = "https://api-m.sandbox.paypal.com";

/** Always the PayPal sandbox. A PAYPAL_ENVIRONMENT other than SANDBOX is refused, never silently honoured. */
export function baseUrl(): string {
  const env = (process.env.PAYPAL_ENVIRONMENT ?? "sandbox").toLowerCase();
  if (env !== "sandbox") throw new Error("CartHold is sandbox-only: PAYPAL_ENVIRONMENT must be SANDBOX");
  return SANDBOX;
}

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly name_: string | undefined, // PayPal error "name", e.g. UNPROCESSABLE_ENTITY
    readonly debugId: string | undefined,
    readonly details: unknown,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

/**
 * m7: no access token (creds missing, OAuth refused, token fetch timed out / network error), so the request itself was
 * never sent and PayPal cannot have acted on it. Not a PayPalError on purpose: callers must not read it as a
 * PayPal 4xx (orders.ts would try the buyer-approval fallback) or as "no response" (money may be held).
 */
export class PayPalNotSentError extends Error {
  constructor(cause: unknown) {
    super("PayPal request not sent: no access token", { cause });
    this.name = "PayPalNotSentError";
  }
}

/** B2: a hung PayPal call aborts. The abort error has no HTTP status, so the guard treats it as "no response". */
const TIMEOUT_MS = 15_000;

let cached: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string> | null = null;

/** Test hook: drop the cached token. */
export function resetTokenCache() {
  cached = null;
  inflight = null;
}

export async function getAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  // ponytail: share one in-flight token request so parallel tool calls don't each fetch a token.
  inflight ??= fetchToken().finally(() => (inflight = null));
  return inflight;
}

async function fetchToken(): Promise<string> {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not set");
  const res = await fetch(`${baseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    // Body is PayPal's error JSON (error, error_description); it never echoes the secret.
    throw new PayPalError(`PayPal OAuth failed: ${res.status}`, res.status, undefined, undefined, await safeJson(res));
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  // Refresh 60s early so a token never expires mid-request.
  cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
  return json.access_token;
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return text;
  }
}

/**
 * Authenticated JSON call. `requestId` sets PayPal-Request-Id (idempotency: a retry with the same id
 * returns the original result instead of creating a duplicate).
 * Source: https://developer.paypal.com/api/rest/reference/idempotency/
 * Prefer: return=representation asks for the full resource in the response.
 */
export async function paypalFetch<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; requestId?: string } = {},
): Promise<T> {
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    let token: string;
    try {
      token = await getAccessToken();
    } catch (e) {
      throw new PayPalNotSentError(e);
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
    if (init.requestId) headers["PayPal-Request-Id"] = init.requestId;
    res = await fetch(baseUrl() + path, {
      method: init.method ?? "POST",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // B8: a cached token PayPal no longer accepts (revoked / rotated creds): drop it and retry once with a fresh
    // one. Safe for POSTs: same PayPal-Request-Id, and a 401 means PayPal never acted on the request.
    if (res.status !== 401 || attempt >= 1) break;
    void res.body?.cancel().catch(() => {});
    cached = null;
  }
  const json = (await safeJson(res)) as Record<string, unknown> | undefined;
  if (!res.ok) {
    const err = (json ?? {}) as { name?: string; message?: string; debug_id?: string; details?: unknown };
    throw new PayPalError(
      `${init.method ?? "POST"} ${path} -> ${res.status} ${err.name ?? ""} ${err.message ?? ""}`.trim(),
      res.status,
      err.name,
      err.debug_id,
      err.details,
    );
  }
  return (json ?? {}) as T; // 204 No Content (e.g. void) -> {}
}
