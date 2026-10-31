import { getStore } from "../../data/stores";

// Reason strings come from the guard: "warning: …" never blocks; "inspector: …" (except "inspector unavailable")
// is a blocking inspector finding; anything else is a policy reason (or a note on a paid/held row).
export const isWarning = (r: string) => /^warning\b/i.test(r);
export const isInspector = (r: string) => /^inspector\b/i.test(stripWarning(r));
export const isInspectorBlock = (r: string) => !isWarning(r) && isInspector(r) && !/^inspector unavailable\b/i.test(r);
/** The only reason that means "the agent obeyed text planted on a page". Drift/mismatch blocks are not this. */
export const isInjectionFollow = (r: string) => /^inspector: order follows injected text\b/i.test(r);
export const stripWarning = (r: string) => r.replace(/^warning:?\s*/i, "");

const rank = (r: string) =>
  isInjectionFollow(r) ? 0 : isInspectorBlock(r) ? 1 : isWarning(r) || /^inspector unavailable\b/i.test(r) ? 3 : 2;

/** Blocking first (injection-follow, other inspector blocks, policy), then warnings and notes. Stable. */
export function orderReasons(rs: string[]): string[] {
  return [...rs].sort((a, b) => rank(a) - rank(b));
}

/** The reason a blocked card leads with: never a warning. */
export const headline = (rs: string[]) => orderReasons(rs).find((r) => !isWarning(r)) ?? rs[0] ?? "";

/** Show the poisoned page only when the order actually followed injected text. */
export const hasInjection = (row: { status: string; reasons: string[] }) =>
  row.status === "blocked" && row.reasons.some(isInjectionFollow);

const BLOCKED = "BLOCKED by CartHold: ";
/** The trace shows the agent's BLOCKED result; re-list its reasons in the card's order so both read the same. */
export function refusedText(result: string, rows: { reasons: string[] }[]): string {
  if (!result.startsWith(BLOCKED)) return result;
  const row = rows.find((r) => BLOCKED + r.reasons.join("; ") === result);
  return row ? BLOCKED + orderReasons(row.reasons).join("; ") : result;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One reason as a sentence a shopper reads. Injection-follow names the page instead of quoting it. */
export function plainReason(r: string): string {
  const follow = /^inspector: order follows injected text on page ([\w-]+)/i.exec(r);
  if (follow) return `Followed text hidden on the ${getStore(follow[1])?.name ?? follow[1]} page`;
  return cap(stripWarning(r).replace(/^inspector:?\s*/i, "").replace(/^policy:?\s*/i, ""));
}

// Short "what broke" tags: [pattern, tag]. Unmatched reasons stay in the full list only.
const TAGS: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^inspector: order follows injected text/i, () => "followed hidden text"],
  [/^inspector: merchant page .* deviates/i, () => "page steered the order"],
  [/quantity (\d+) exceeds max quantity (\d+)/i, (m) => `qty ${m[1]} > ${m[2]}`],
  [/\$([\d.,]+) exceeds per-item cap \$([\d.,]+)/i, (m) => `$${m[1]} > $${m[2]} cap`],
  [/total \$([\d.,]+) exceeds remaining budget \$([\d.,]+)/i, (m) => `$${m[1]} > $${m[2]} left`],
  [/total (\$[\d.,]+) is over the (\$[\d.,]+) ask-me limit/i, (m) => `${m[1]} > ${m[2]} ask-me limit`],
  [/not in merchant catalog/i, () => "not in catalog"],
  [/^merchant .* not on allowlist/i, () => "store not allowed"],
  [/not traceable to user request/i, () => "not what you asked for"],
];

/** Deduped short tags for a row's blocking reasons, in orderReasons order. Warnings never tag. */
export function reasonTags(rs: string[]): string[] {
  const out = new Set<string>();
  for (const r of orderReasons(rs)) {
    if (isWarning(r)) continue;
    for (const [re, tag] of TAGS) {
      const m = re.exec(r);
      if (m) {
        out.add(tag(m));
        break;
      }
    }
  }
  return [...out];
}
