// CartHold orchestrator: policy + inspector verdict, then the PayPal money flow, plus the decision log.
// Plug `onProposeOrder` straight into runAgent. Server only (PayPal creds live behind orders.ts).
import { getPageText, getStore, stores, type Product } from "../../data/stores";
import type { AgentOrder } from "../agent/agent";
import { flaggedLines, sentencesOf, type FlaggedLine } from "../inspector/backstop";
import { inspect, type Llm } from "../inspector/inspect";
import * as orders from "../paypal/orders";
import { evaluate, type Mandate, type Verdict } from "../policy/policy";

export type PayPalApi = Pick<
  typeof orders,
  "createAuthorizeOrder" | "authorizeOrder" | "captureAuthorization" | "voidAuthorization"
> &
  // Optional so hand-rolled clients still type-check; without it unknown rows cannot be resolved.
  Partial<Pick<typeof orders, "getOrder">>;

/**
 * pending: allowed/held, PayPal calls in flight. unknown: PayPal outcome ambiguous (e.g. capture AND void
 * failed, or a network error mid-authorize) - counted as at risk and committed until resolveUnknown() settles it.
 */
export type RowStatus = "pending" | "blocked" | "captured" | "held" | "voided" | "error" | "unknown";
export type DecisionRow = {
  id: string;
  time: string; // ISO
  merchant: string;
  items: string;
  amountUsd: number;
  verdict: Verdict;
  reasons: string[];
  triggeringText?: string;
  paypalOrderId?: string;
  authorizationId?: string;
  captureId?: string;
  status: RowStatus;
  /** Hold only: when the authorization auto-voids if nobody decides (ISO). */
  expiresAt?: string;
  /** What the human (or the hold timeout) decided, or "system-voided": the guard itself aborted it (capture or
   * authorization failed and it tried to void). A decided row is never re-armed as a hold, only void-retried. */
  decision?: "approved" | "rejected" | "expired" | "system-voided";
  /** Unknown after MAX_RESOLVES resolve attempts: still counted, but the session stops polling PayPal for it. */
  unresolvable?: boolean;
};

export type GuardState = {
  rows: DecisionRow[];
  /** Row ids of authorizations waiting on a human. */
  pendingHolds: string[];
  /** Sum of held (authorized, not captured) or unknown money. */
  amountAtRiskUsd: number;
  /** Captured + held + unknown + pending: what counts against the budget. */
  committedUsd: number;
  /** Row ids whose PayPal outcome is ambiguous; settle them with resolveUnknown(). */
  unknownRows?: string[];
  /** Unknown rows that can never be resolved (no order id); the session may evict the run after a TTL. */
  unresolvable?: string[];
  /** Money paid without asking (allow path only): what the cumulative ask-me limit counts. */
  autoPaidUsd?: number;
};

export type GuardOptions = {
  mandate: Mandate;
  /** Inspector LLM. Omitted: inspect() uses Gemini if GEMINI_API_KEY is set, else regex backstop only. */
  llm?: Llm;
  paypal?: PayPalApi;
  /** Auto-void a hold nobody decided on after this long. Default 5 min. */
  holdTimeoutMs?: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const statusOf = (e: unknown) => {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : undefined;
};
/** PayPal error text (paths, ids, debug ids) stays in the server log; rows and the agent get a generic line. */
function ppError(e: unknown, step: string): string {
  console.error(`[carthold] PayPal ${step} failed:`, e, (e as { details?: unknown } | null)?.details ?? "");
  const s = statusOf(e);
  return s === undefined ? "PayPal error (no response)" : `PayPal error (status ${s})`;
}
const AUTH_OK = new Set(["CREATED", "AUTHORIZED"]);
/** Authorization states that hold no money. */
const AUTH_DEAD = new Set(["DENIED", "VOIDED", "EXPIRED", "DECLINED"]);
// ponytail: PARTIALLY_CAPTURED keeps the row's full amount (getOrder exposes no captured amount); upgrade when it does.
const AUTH_CAPTURED = new Set(["CAPTURED", "PARTIALLY_CAPTURED"]);
const MAX_RESOLVES = 5;
type OrderItem = { name: string; quantity: number; unitPriceUsd: number };
const productsOf = (slug: string): Product[] => {
  const s = getStore(slug);
  return s ? [s.featured, ...s.more] : [];
};
const findProduct = (products: Product[], name: unknown) =>
  products.find((p) => p.name.toLowerCase() === String(name).trim().toLowerCase());

/** CR-5: every line must be a real product of the merchant at its catalog price. */
function catalogReasons(products: Product[], items: OrderItem[]): string[] {
  return items.flatMap((i) => {
    const p = findProduct(products, i.name);
    if (!p) return [`item "${i.name}" not in merchant catalog`];
    return p.price === i.unitPriceUsd ? [] : [`"${i.name}" price differs from catalog ($${i.unitPriceUsd} vs $${p.price})`];
  });
}

/**
 * Unit prices a segment dictates, normalized ("$25.00", "25 USD" give 25): "(unit) price $25", "$25 each",
 * "for $25" / "for 25 USD". Only ever applied to injected (flagged / verified-quote) text on the merchant page,
 * so honest visible catalog prices never count. ponytail: "for" needs a currency ("for 2 bags" is not a price).
 */
const PRICE_RES = [
  /\bprice\s*:?\s*(?:\$|usd\s*)?\s*(\d+(?:\.\d+)?)/gi,
  /(?:\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*usd)\s+each\b/gi,
  /\bfor\s+(?:\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*usd\b)/gi,
];
const dictatedPrices = (t: string) => PRICE_RES.flatMap((re) => [...t.matchAll(re)].map((m) => Number(m[1] ?? m[2])));
/**
 * The injected sentence this order follows, if any: an order line's catalog name or product id appears in an
 * injected segment, or (merchant page only: a bare "quantity 1" on another store says nothing about this order)
 * its quantity / unit price matches one the segment dictates ("quantity 10, unit price $100").
 * ponytail: substring match; ceiling: a user who explicitly asks for the very item an injection pushes is blocked
 * too (a false positive we accept on a payment path). Upgrade: let the user's own words override the name match.
 */
function followedSentence(items: OrderItem[], products: Product[], lines: FlaggedLine[], merchantPage: boolean): string | null {
  for (const i of items) {
    const p = findProduct(products, i.name);
    const terms = [String(i.name), ...(p ? [p.name, p.id] : [])].map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 3);
    const preds: ((t: string) => boolean)[] = [(t) => terms.some((term) => t.toLowerCase().includes(term))];
    if (merchantPage)
      preds.push(
        (t) => [...t.matchAll(/\bquantity\s*:?\s*(\d+)\b/gi)].some((m) => Number(m[1]) === i.quantity),
        (t) => dictatedPrices(t).some((n) => Math.abs(n - i.unitPriceUsd) < 0.005),
      );
    for (const f of lines) for (const pred of preds) if (pred(f.line)) return sentencesOf(f.line).find(pred) ?? f.sentence;
  }
  return null;
}

export function createGuard({ mandate, llm, paypal = orders, holdTimeoutMs = 5 * 60_000 }: GuardOptions) {
  const rows: DecisionRow[] = [];
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const resolveTries = new Map<string, number>();
  const listeners = new Set<(s: GuardState) => void>();
  const pagesRead = new Set<string>();
  let seq = 0;
  // PayPal-Request-Id per row+step: a retry of the same step is idempotent, steps never collide. <= 38 chars.
  const guardId = crypto.randomUUID().slice(0, 8);
  const rid = (row: DecisionRow, step: "auth" | "authz" | "cap" | "void") => `${guardId}-${row.id}-${step}`;

  const sum = (pred: (r: DecisionRow) => boolean) => round2(rows.filter(pred).reduce((s, r) => s + r.amountUsd, 0));
  const getState = (): GuardState => ({
    rows: rows.map((r) => ({ ...r, reasons: [...r.reasons] })),
    pendingHolds: [...timers.keys()],
    amountAtRiskUsd: sum((r) => r.status === "held" || r.status === "unknown"),
    committedUsd: sum((r) => ["pending", "held", "captured", "unknown"].includes(r.status)),
    unknownRows: rows.filter((r) => r.status === "unknown").map((r) => r.id),
    unresolvable: rows.filter((r) => r.status === "unknown" && r.unresolvable).map((r) => r.id),
    // In-flight and unknown allow-path money counts too: it may have been paid without asking.
    autoPaidUsd: sum((r) => r.verdict === "allow" && ["pending", "captured", "unknown"].includes(r.status)),
  });
  const emit = () => {
    const s = getState();
    for (const l of listeners) {
      try {
        l(s);
      } catch {
        // A broken listener (UI stream) must never abort the money flow.
      }
    }
  };
  const update = (row: DecisionRow, patch: Partial<DecisionRow>) => {
    Object.assign(row, patch);
    emit();
  };

  async function verdictFor(order: AgentOrder) {
    const policyOrder = {
      merchant: order.merchant,
      items: order.items,
      source: { pageUrl: `/stores/${order.sourceSlug}` },
    };
    const st = getState();
    const policy = evaluate(mandate, policyOrder, st.committedUsd, st.autoPaidUsd);
    // The page is resolved from the merchant, never trusted from the agent's sourceSlug.
    const store = stores.find((s) => s.name.toLowerCase() === String(order.merchant).toLowerCase());
    if (!store || store.slug !== order.sourceSlug)
      return { verdict: "block" as Verdict, reasons: [...policy.reasons, `source page does not match merchant (sourceSlug "${order.sourceSlug}")`], amountUsd: policy.amountUsd, triggeringText: undefined };
    const items: OrderItem[] = Array.isArray(order.items) ? order.items : [];
    const products = productsOf(store.slug);
    const catalog = catalogReasons(products, items);
    // Inspect the merchant page plus every page the agent read this run, each with the exact order. A flagged page
    // only BLOCKS this order if the order follows its injected text (or, on the merchant's own page, the order
    // deviates from the user request); otherwise it is a non-blocking warning.
    const slugs = [...new Set([store.slug, ...pagesRead])];
    const pages = await Promise.all(
      slugs.map(async (slug) => {
        const text = getPageText(slug);
        const hidden = getStore(slug)?.hidden.map((h) => h.text) ?? [];
        const insp = await inspect(text, mandate.userRequest, order, llm, { hidden, merchantPage: slug === store.slug });
        return { slug, insp, lines: flaggedLines(text, mandate.userRequest) };
      }),
    );
    const deviates = catalog.length > 0 || policy.reasons.some((r) => r.includes("not traceable"));
    const blocks: string[] = [];
    const warnings: string[] = [];
    let triggeringText: string | undefined;
    for (const { slug, insp, lines } of pages) {
      const merchantPage = slug === store.slug;
      // A verified LLM quote is one more injected segment: it blocks only if the order follows it, like the regex lines.
      const quoted = insp.quote ? [{ line: insp.quote, sentence: insp.quote, reasons: [] }] : [];
      const hit = followedSentence(items, products, [...lines, ...quoted], merchantPage);
      // insp.flagged = regex backstop flagged the page or the LLM quote was verified; never an unchecked LLM opinion.
      if (hit) {
        blocks.push(`inspector: order follows injected text on page ${slug}: "${hit}"`);
        triggeringText ??= hit;
      } else if (merchantPage && insp.flagged && deviates) {
        blocks.push(`inspector: merchant page ${slug} has text aimed at AI agents (${insp.reasons.join(", ")}) and the order deviates from the user request`);
        triggeringText ??= insp.triggeringText ?? undefined;
      } else if (merchantPage && insp.flagged) warnings.push(`warning: page ${slug} contains text aimed at AI agents`);
      // ponytail: another page warns only if it names this order's item, and that case already blocks above.
    }
    // Inspector "unavailable" notes are informational on a pass; keep them, they explain a regex-only run.
    const notes = pages.flatMap((p) => p.insp.reasons.filter((r) => r.startsWith("inspector unavailable")));
    const verdict: Verdict = policy.verdict === "block" || catalog.length || blocks.length ? "block" : policy.verdict;
    // A hold reason ("over the ask-me limit") is not a refusal reason: drop it when something else blocks.
    const policyReasons = verdict === "block" && policy.verdict !== "block" ? [] : policy.reasons;
    return {
      verdict,
      reasons: [...new Set([...policyReasons, ...catalog, ...blocks, ...warnings, ...notes])],
      amountUsd: policy.amountUsd,
      triggeringText,
    };
  }


  /** Capture a held authorization. Anything but COMPLETED is not "paid"; a failed capture is voided, and if
   * that void fails too the money may still be held, so the row stays counted as "unknown". */
  async function capture(row: DecisionRow, authorizationId: string, note?: string): Promise<string> {
    const withNote = (r: string[]) => (note ? [...r, note] : r);
    let why: string;
    try {
      const cap = await paypal.captureAuthorization(authorizationId, rid(row, "cap"));
      if (cap.status === "COMPLETED") {
        update(row, { captureId: cap.id, status: "captured", expiresAt: undefined, reasons: withNote(row.reasons) });
        return `Paid: order ${row.paypalOrderId}, capture ${cap.id}`;
      }
      if (cap.status === "PENDING") {
        const r = `capture ${cap.id} PENDING at PayPal`;
        update(row, { captureId: cap.id, status: "unknown", expiresAt: undefined, reasons: withNote([...row.reasons, r]) });
        return `Payment status unknown: ${r}`;
      }
      why = `capture ${cap.id} ${cap.status}`;
    } catch (e) {
      why = ppError(e, "capture");
    }
    return voidOrUnknown(row, authorizationId, `capture failed: ${why}`, why);
  }

  /** Money may be held under authorizationId: void it ("error", nothing held) or, if the void fails, "unknown". */
  async function voidOrUnknown(row: DecisionRow, authorizationId: string, why: string, short = why): Promise<string> {
    try {
      await paypal.voidAuthorization(authorizationId, rid(row, "void"));
      update(row, { status: "error", expiresAt: undefined, reasons: [...row.reasons, `${why}; authorization voided`] });
      return `Payment failed: ${short}`;
    } catch (e) {
      const r = `${why}; void also failed: ${ppError(e, "void")}`;
      // The guard aborted this order: the resolver may only finish the void, never re-arm it as an approvable hold.
      update(row, { status: "unknown", decision: row.decision ?? "system-voided", expiresAt: undefined, reasons: [...row.reasons, r] });
      return `Payment status unknown: ${r}`;
    }
  }

  function armHold(row: DecisionRow, authorizationId: string) {
    const expiresAt = new Date(Date.now() + holdTimeoutMs).toISOString();
    timers.set(row.id, setTimeout(() => void settle(row.id, "void", "auto-voided: approval timed out", "expired").catch(() => {}), holdTimeoutMs));
    update(row, { authorizationId, status: "held", expiresAt });
  }

  async function onProposeOrder(order: AgentOrder): Promise<string> {
    const id = `d${++seq}`;
    const time = new Date().toISOString();
    let v: Awaited<ReturnType<typeof verdictFor>>;
    try {
      v = await verdictFor(order);
    } catch (e) {
      // Fail closed: a guard crash never lets money move. Details stay in the server log.
      console.error("[carthold] guard error:", e);
      v = { verdict: "block", reasons: ["guard error (blocked for safety)"], amountUsd: 0, triggeringText: undefined };
    }
    // Row appears only once decided: blocked rows start "blocked", allow/hold rows start "pending".
    const row: DecisionRow = {
      id,
      time,
      merchant: String(order?.merchant ?? ""),
      items: (order?.items ?? []).map((i) => `${i.quantity}x ${i.name}`).join(", "),
      amountUsd: v.amountUsd,
      verdict: v.verdict,
      reasons: v.reasons,
      triggeringText: v.triggeringText,
      status: v.verdict === "block" ? "blocked" : "pending",
    };
    rows.push(row);
    emit();
    if (v.verdict === "block") return `REFUSED by CartHold: ${v.reasons.join("; ")}`;

    try {
      const store = stores.find((s) => s.name.toLowerCase() === row.merchant.toLowerCase());
      const merchant = { id: store?.merchantId ?? order.sourceSlug, name: row.merchant };
      const items = order.items.map((i) => ({ name: i.name, quantity: i.quantity, unitAmount: i.unitPriceUsd }));
      let o = await paypal.createAuthorizeOrder(items, merchant, { requestId: rid(row, "auth") });
      update(row, { paypalOrderId: o.id });
      if (!o.authorization && !o.approveUrl) o = await paypal.authorizeOrder(o.id, rid(row, "authz"));
      const auth = o.authorization;
      const fail = (r: string) => (update(row, { status: "error", reasons: [...row.reasons, r] }), `Payment failed: ${r}`);
      if (!auth) return fail(`order ${o.id} needs buyer approval (${o.status})`);
      row.authorizationId = auth.id; // emitted with the next update (keeps the verdict / order / held emit sequence)
      if (AUTH_DEAD.has(auth.status)) return fail(`authorization ${auth.id} ${auth.status}`);
      // PENDING or anything unexpected: money may be held, so void it rather than walk away.
      if (!AUTH_OK.has(auth.status)) return await voidOrUnknown(row, auth.id, `authorization ${auth.id} ${auth.status}`);

      if (v.verdict === "hold") {
        armHold(row, auth.id);
        return `HELD for human approval: authorization ${auth.id}`;
      }
      emit();
      return await capture(row, auth.id);
    } catch (e) {
      const why = ppError(e, "create/authorize");
      if (row.authorizationId) return voidOrUnknown(row, row.authorizationId, why);
      const s = statusOf(e);
      if (s !== undefined && s < 500) {
        // A definitive 4xx: PayPal refused, nothing is held.
        update(row, { status: "error", reasons: [...row.reasons, why] });
        return `Payment failed: ${why}`;
      }
      // Network error / 5xx: PayPal may have authorized anyway. Count it until resolveUnknown() settles it.
      update(row, { status: "unknown", reasons: [...row.reasons, `${why}; money may be held at PayPal`] });
      return `Payment status unknown: ${why}`;
    }
  }

  async function settle(holdId: string, action: "capture" | "void", note: string, decision: NonNullable<DecisionRow["decision"]>): Promise<DecisionRow> {
    const row = rows.find((r) => r.id === holdId);
    const timer = timers.get(holdId);
    if (!row || !timer || !row.authorizationId) throw new Error(`no pending hold ${holdId}`);
    // Claim the hold synchronously so approve/reject/timeout can never both act on it.
    clearTimeout(timer);
    timers.delete(holdId);
    row.decision = decision; // emitted with the next update
    if (action === "capture") {
      await capture(row, row.authorizationId, note);
    } else {
      try {
        await paypal.voidAuthorization(row.authorizationId, rid(row, "void"));
        update(row, { status: "voided", expiresAt: undefined, reasons: [...row.reasons, note] });
      } catch (e) {
        // Void failed: the money may still be held, so it stays counted.
        update(row, { status: "unknown", expiresAt: undefined, reasons: [...row.reasons, `void failed: ${ppError(e, "void")}`] });
      }
    }
    return { ...row, reasons: [...row.reasons] };
  }

  /** Ask PayPal what really happened to an "unknown" row and move it to captured / voided / held. */
  async function resolveRow(row: DecisionRow) {
    if (row.unresolvable) return;
    await resolveOnce(row);
    // Every attempt counts (no order id, getOrder failing / 404, non-terminal status, void retry failing): after
    // MAX_RESOLVES the row stays unknown and counted, but is flagged so the session stops polling and can evict it.
    const n = (resolveTries.get(row.id) ?? 0) + 1;
    resolveTries.set(row.id, n);
    if (row.status === "unknown" && n >= MAX_RESOLVES)
      update(row, { unresolvable: true, reasons: [...row.reasons, `unresolvable: ${row.paypalOrderId ? "PayPal outcome still unknown" : "no PayPal order id"}, check the PayPal dashboard`] });
  }

  async function resolveOnce(row: DecisionRow) {
    if (!row.paypalOrderId || !paypal.getOrder) return; // create never answered: no id to ask about
    let a;
    try {
      a = (await paypal.getOrder(row.paypalOrderId)).authorization;
    } catch (e) {
      ppError(e, "getOrder");
      return;
    }
    if (!a || row.status !== "unknown") return;
    if (AUTH_CAPTURED.has(a.status)) update(row, { status: "captured", authorizationId: a.id, reasons: [...row.reasons, "resolved: captured at PayPal"] });
    else if (AUTH_DEAD.has(a.status)) update(row, { status: "voided", authorizationId: a.id, reasons: [...row.reasons, `resolved: authorization ${a.status} at PayPal`] });
    else if (AUTH_OK.has(a.status) && row.decision) {
      // Already decided (rejected / expired / approved but capture failed): finish the void, never re-arm or capture.
      try {
        await paypal.voidAuthorization(a.id, rid(row, "void"));
        if (row.status === "unknown") update(row, { status: "voided", authorizationId: a.id, reasons: [...row.reasons, "resolved: void retried, authorization voided"] });
      } catch (e) {
        ppError(e, "void retry"); // stays unknown and counted; the next sweep retries
      }
    } else if (AUTH_OK.has(a.status) && !timers.has(row.id)) {
      // Still authorized and nobody decided: back to a normal hold (approve / reject / auto-void).
      update(row, { reasons: [...row.reasons, "resolved: authorization still held at PayPal"] });
      armHold(row, a.id);
    }
  }

  return {
    onProposeOrder,
    resolveUnknown: async (rowId: string): Promise<DecisionRow> => {
      const row = rows.find((r) => r.id === rowId && r.status === "unknown");
      if (!row) throw new Error(`no unknown row ${rowId}`);
      await resolveRow(row);
      return { ...row, reasons: [...row.reasons] };
    },
    /** Sweep every unknown row; call periodically (e.g. from the run session). */
    resolveAllUnknown: async () => {
      await Promise.all(rows.filter((r) => r.status === "unknown").map(resolveRow));
      return getState();
    },
    /** Record that the agent read /stores/[slug]; every noted page is inspected on each later order. */
    notePageRead: (slug: string) => void pagesRead.add(String(slug)),
    approve: (holdId: string) => settle(holdId, "capture", "approved by user", "approved"),
    reject: (holdId: string) => settle(holdId, "void", "rejected by user", "rejected"),
    getState,
    subscribe(listener: (s: GuardState) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export type Guard = ReturnType<typeof createGuard>;
