// One JSON response shape for every API route: success body or { error }, never cached.
export const NO_STORE = { "cache-control": "no-store" };
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });
export const fail = (status: number, error: string) => json({ error }, status);

export const MAX_BODY_BYTES = 16_384;

/**
 * Boundary checks for state-changing POSTs: application/json only (415, blocks text/plain form CSRF),
 * same Origin when one is sent (403; PUBLIC_ORIGIN if set, else Host), body <= 16KB (413). Returns a Response to send back on failure,
 * else { body } where body is undefined for malformed JSON (callers answer 400).
 */
export async function readJsonPost(req: Request): Promise<Response | { body: unknown }> {
  if (!/^application\/json\s*(;|$)/i.test(req.headers.get("content-type") ?? ""))
    return fail(415, "content-type must be application/json");
  const origin = req.headers.get("origin");
  if (origin && !sameOrigin(origin, req)) return fail(403, "cross-origin request refused");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return fail(413, "request body too large");
  const text = await readCapped(req);
  if (text === null) return fail(413, "request body too large");
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { body: undefined };
  }
}

/** PUBLIC_ORIGIN (e.g. https://carthold.example) when set: exact match. Else Origin's host must equal Host. */
function sameOrigin(origin: string, req: Request): boolean {
  const pub = process.env.PUBLIC_ORIGIN?.trim().replace(/\/+$/, "");
  if (pub) return origin === pub;
  try {
    return new URL(origin).host === (req.headers.get("host") ?? new URL(req.url).host);
  } catch {
    return false;
  }
}

/** Reads the body chunk by chunk; null (and the stream cancelled) as soon as it passes MAX_BODY_BYTES. */
async function readCapped(req: Request): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      void reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}
