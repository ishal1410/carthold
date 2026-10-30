/** Splits `text` into plain and marked parts: every occurrence of every needle is marked (overlaps merged). */
export function markParts(text: string, needles: (string | undefined)[]): { text: string; marked: boolean }[] {
  const ranges: [number, number][] = [];
  for (const n of new Set(needles.filter((x): x is string => !!x && x.length > 0))) {
    for (let i = text.indexOf(n); i >= 0; i = text.indexOf(n, i + n.length)) ranges.push([i, i + n.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  const out: { text: string; marked: boolean }[] = [];
  let at = 0;
  for (const [s, e] of merged) {
    if (s > at) out.push({ text: text.slice(at, s), marked: false });
    out.push({ text: text.slice(s, e), marked: true });
    at = e;
  }
  if (at < text.length) out.push({ text: text.slice(at), marked: false });
  return out;
}
