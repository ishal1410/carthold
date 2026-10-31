import { z } from "zod";
import { stores } from "../../data/stores";

// Deterministic policy engine. No LLM, no I/O: same input, same Decision.

export const MandateSchema = z.object({
  userRequest: z.string(),
  budgetUsd: z.number().nonnegative(),
  perItemCapUsd: z.number().nonnegative(),
  approvalThresholdUsd: z.number().nonnegative(),
  merchantAllowlist: z.array(z.string()),
  maxQuantity: z.number().int().positive(),
});

// PayPal charges whole cents; a sub-cent price would make policy and PayPal disagree on the amount.
const toCents = (usd: number) => Math.round(usd * 100);
function isWholeCents(usd: number) {
  return Math.abs(usd * 100 - toCents(usd)) < 1e-6;
}

// The order comes from the agent (untrusted), so it is validated here.
export const ProposedOrderSchema = z.object({
  merchant: z.string().min(1),
  items: z
    .array(z.object({ name: z.string().min(1), quantity: z.number().int().positive(), unitPriceUsd: z.number().nonnegative().refine(isWholeCents, "unit price must be whole cents") }))
    .min(1),
  source: z.object({ pageUrl: z.string(), triggeringText: z.string().optional() }),
});

export type Mandate = z.infer<typeof MandateSchema>;
export type ProposedOrder = z.infer<typeof ProposedOrderSchema>;
export type Verdict = "allow" | "hold" | "block";
export type Decision = { verdict: Verdict; reasons: string[]; amountUsd: number };

const NOT_TRACEABLE = "not traceable to user request";
const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, single: 1, two: 2, pair: 2, couple: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, dozen: 12,
};
const STOPWORDS = new Set([
  "the", "and", "for", "with", "set", "pack", "new", "item",
  // product modifiers, never the thing being bought
  "pro", "plus", "max", "mini", "lite", "ultra", "refurbished", "renewed", "used", "edition", "deluxe", "premium",
]);
// Size/qty tokens after a number ("16 oz", "3 x 4 oz", "2 pack") are dropped before picking the head noun.
const UNITS = new Set(["x", "oz", "fl", "ml", "l", "lb", "lbs", "g", "kg", "ct", "count", "pack", "pk", "pc", "pcs", "piece", "pieces", "inch", "in", "ft", "cm", "mm"]);

// ponytail: suffix-strip stemmer ("camping"->"camp", "mugs"->"mug"); misses irregulars like "glasses"/"glass". Swap for a real stemmer if false blocks show up.
const stem = (w: string) => w.replace(/ing$/, "").replace(/([^s])s$/, "$1");
const tokenize = (s: string) => s.toLowerCase().match(/\$?\d+(?:\.\d+)?|[a-z]+/g) ?? [];
const isNum = (t: string) => /^\$?\d/.test(t);
const keywords = (name: string) =>
  tokenize(name)
    .filter((t, i, all) => !(UNITS.has(t) && i > 0 && isNum(all[i - 1])))
    .filter((t) => /^[a-z]{3,}$/.test(t) && !STOPWORDS.has(t))
    .map(stem);
// Compound words count as a match: "earbuds" -> "earbud" ends with "bud".
const sameWord = (a: string, b: string) => a === b || (b.length >= 3 && a.endsWith(b)) || (a.length >= 3 && b.endsWith(a));

/**
 * Traceable only if the head noun (last keyword) or at least half the keywords appear in the request,
 * so one shared modifier ("coffee" in "Coffee Gift Card") is not enough.
 */
function traceable(request: string[], itemName: string): boolean {
  const want = keywords(itemName);
  const req = request.map(stem).filter((t) => /^[a-z]{3,}$/.test(t));
  const hit = (w: string) => req.some((r) => sameWord(r, w));
  return want.length > 0 && (hit(want[want.length - 1]) || want.filter(hit).length * 2 >= want.length);
}

const CONJUNCTIONS = new Set(["and", "or", "plus", "with", "also"]);
/**
 * Quantity stated in the 3 tokens before request[i] ("two bags of coffee"), default 1. Stops at a conjunction so
 * "3 mugs and coffee beans" doesn't give the beans 3, and skips sizes ("12 oz"). "$40" keeps its "$", so prices never count.
 * ponytail: tokenize drops punctuation, so "3 mugs, coffee beans" still reads 3; track separators if that matters.
 */
function quantityBefore(request: string[], i: number): number {
  for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
    const prev = request[j];
    if (CONJUNCTIONS.has(prev)) break;
    if (/^\d+$/.test(prev) && !UNITS.has(request[j + 1])) return Number(prev);
    if (prev in NUMBER_WORDS && !UNITS.has(request[j + 1])) return NUMBER_WORDS[prev];
  }
  return 1;
}

/** Quantity the user asked for next to a matched keyword, or null if the item isn't mentioned. */
function requestedQuantity(request: string[], itemName: string): number | null {
  const want = keywords(itemName);
  let found: number | null = null;
  request.forEach((tok, i) => {
    const s = stem(tok);
    if (/^[a-z]{3,}$/.test(s) && want.some((w) => sameWord(s, w))) found = Math.max(found ?? 0, quantityBefore(request, i));
  });
  return found;
}

// Catalog name -> what the item IS ("Morning Ritual Blend, 12 oz" -> "coffee beans"). Keyed by exact catalog name, so
// a renamed or invented item gets no kind (guard's catalog check blocks those anyway).
const KINDS = new Map(stores.flatMap((s) => [s.featured, ...s.more]).map((p) => [p.name.toLowerCase(), p.kinds.map((k) => tokenize(k).map(stem))]));

/**
 * Quantity the user asked for next to the item's catalog kind, or null if no kind is named. The WHOLE kind phrase must
 * appear as consecutive whole words: "camping coffee mug" names "mug", not "coffee kit" or "coffee beans".
 */
function kindQuantity(request: string[], itemName: string): number | null {
  const stems = request.map(stem);
  let found: number | null = null;
  for (const kind of KINDS.get(itemName.trim().toLowerCase()) ?? [])
    stems.forEach((_, i) => {
      if (kind.length && kind.every((w, j) => stems[i + j] === w)) found = Math.max(found ?? 0, quantityBefore(request, i));
    });
  return found;
}

function priceCeiling(request: string): number | null {
  const m = request.toLowerCase().match(/(?:under|below|less than|max|up to|at most|no more than)\s*\$\s*(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

const usd = (n: number) => `$${n % 1 ? n.toFixed(2) : n}`;

/** One-line human description of the (cumulative) approval rule, for the UI. */
export function describeApprovalRule(mandate: Pick<Mandate, "approvalThresholdUsd">): string {
  return `Pays up to ${usd(mandate.approvalThresholdUsd)} in total without asking; anything beyond that waits for your approval`;
}

/**
 * spentSoFarUsd = committed money (captured + held + unknown + in flight): the budget check.
 * autoPaidUsd = money paid WITHOUT asking (allow path only): the cumulative ask-me check. Defaults to spentSoFarUsd.
 */
export function evaluate(mandate: Mandate, rawOrder: ProposedOrder, spentSoFarUsd: number, autoPaidUsd = spentSoFarUsd): Decision {
  const parsed = ProposedOrderSchema.safeParse(rawOrder);
  if (!parsed.success) return { verdict: "block", reasons: [`invalid order: ${parsed.error.issues[0].message}`], amountUsd: 0 };
  const order = parsed.data;

  const amountUsd = order.items.reduce((c, i) => c + i.quantity * toCents(i.unitPriceUsd), 0) / 100;
  const blocks: string[] = [];

  const allow = mandate.merchantAllowlist.map((m) => m.toLowerCase());
  if (!allow.includes(order.merchant.toLowerCase())) blocks.push(`merchant "${order.merchant}" not on allowlist`);

  // Repeated lines of the same item are summed, so splitting 10 units into 5 lines of 2 doesn't dodge the checks.
  const lines = new Map<string, { name: string; quantity: number }>();
  for (const item of order.items) {
    // Sorted keyword set: "Ritual Morning Blend" is the same line as "Morning Ritual Blend" (CR-7).
    const key = [...new Set(keywords(item.name))].sort().join(" ") || item.name.toLowerCase().trim();
    const line = lines.get(key) ?? lines.set(key, { name: item.name, quantity: 0 }).get(key)!;
    line.quantity += item.quantity;
  }
  const totalUnits = order.items.reduce((s, i) => s + i.quantity, 0);
  if (totalUnits > mandate.maxQuantity) blocks.push(`total quantity ${totalUnits} exceeds max quantity ${mandate.maxQuantity}`);

  const request = tokenize(mandate.userRequest);
  const ceiling = priceCeiling(mandate.userRequest);
  for (const item of order.items) {
    if (item.unitPriceUsd > mandate.perItemCapUsd)
      blocks.push(`"${item.name}" $${item.unitPriceUsd} exceeds per-item cap $${mandate.perItemCapUsd}`);
    if (ceiling !== null && item.unitPriceUsd > ceiling)
      blocks.push(`"${item.name}" price $${item.unitPriceUsd} ${NOT_TRACEABLE} (user said under $${ceiling})`);
  }
  for (const { name, quantity } of lines.values()) {
    if (quantity > mandate.maxQuantity) blocks.push(`"${name}" quantity ${quantity} exceeds max quantity ${mandate.maxQuantity}`);

    // Provenance: what is bought, how many, and at what price must come from the user's words, not the page.
    // Either the item's own name words or its catalog kind ("coffee beans") must come from the user.
    const byName = traceable(request, name) ? requestedQuantity(request, name) : null;
    const byKind = kindQuantity(request, name);
    const asked = byName === null ? byKind : Math.max(byName, byKind ?? 0);
    if (asked === null) blocks.push(`item "${name}" ${NOT_TRACEABLE}`);
    else if (quantity > asked) blocks.push(`"${name}" quantity ${quantity} ${NOT_TRACEABLE} (asked for ${asked})`);
  }

  const remaining = mandate.budgetUsd - spentSoFarUsd;
  if (amountUsd > remaining) blocks.push(`total $${amountUsd} exceeds remaining budget $${remaining}`);

  if (blocks.length) return { verdict: "block", reasons: blocks, amountUsd };
  // Cumulative: splitting one big purchase into small orders still crosses the threshold.
  const limit = usd(mandate.approvalThresholdUsd);
  if (amountUsd > mandate.approvalThresholdUsd)
    return { verdict: "hold", reasons: [`total ${usd(amountUsd)} is over the ${limit} ask-me limit`], amountUsd };
  if (autoPaidUsd + amountUsd > mandate.approvalThresholdUsd)
    return { verdict: "hold", reasons: [`auto-pay limit ${limit} reached (${usd(autoPaidUsd)} already auto-paid)`], amountUsd };
  return { verdict: "allow", reasons: [], amountUsd };
}
