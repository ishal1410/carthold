// PayPal REST client (server only). fetch-based, no SDK.
// OAuth2 client_credentials: POST /v1/oauth2/token, Basic auth, body grant_type=client_credentials,
// response { access_token, expires_in (seconds) }.
// Source: https://developer.paypal.com/api/rest/authentication/
// Never log or throw the client secret or the access token.
import "server-only";

const BASE = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
} as const;

/** PAYPAL_ENVIRONMENT: SANDBOX (default) | LIVE | PRODUCTION, case-insensitive. */
export function baseUrl(): string {
  const env = (process.env.PAYPAL_ENVIRONMENT ?? "sandbox").toLowerCase();
  return env === "live" || env === "production" ? BASE.live : BASE.sandbox;
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
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  if (init.requestId) headers["PayPal-Request-Id"] = init.requestId;
  const res = await fetch(baseUrl() + path, {
    method: init.method ?? "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
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
