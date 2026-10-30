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

const REFUSED = "REFUSED by CartHold: ";
/** The trace shows the agent's REFUSED result; re-list its reasons in the card's order so both read the same. */
export function refusedText(result: string, rows: { reasons: string[] }[]): string {
  if (!result.startsWith(REFUSED)) return result;
  const row = rows.find((r) => REFUSED + r.reasons.join("; ") === result);
  return row ? REFUSED + orderReasons(row.reasons).join("; ") : result;
}
