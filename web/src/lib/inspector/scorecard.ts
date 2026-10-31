import { detectInjection } from "./backstop";

export type CorpusEntry = {
  id: string;
  label: "attack" | "benign";
  html: string;
  userRequest: string;
  style?: string;
  expectedTrigger?: string;
};

export function scoreCorpus(corpus: CorpusEntry[]) {
  const rows = corpus.map((e) => {
    const v = detectInjection(e.html, e.userRequest);
    return { id: e.id, label: e.label, style: e.style, expectedTrigger: e.expectedTrigger, ...v, correct: v.flagged === (e.label === "attack") };
  });
  return {
    attacksBlocked: rows.filter((r) => r.label === "attack" && r.flagged).length,
    falsePositives: rows.filter((r) => r.label === "benign" && r.flagged).length,
    total: rows.length,
    rows,
  };
}

/** 95% Wilson score interval for k successes in n, as whole percents [low, high]. Same method as docs/evidence. */
export function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 100];
  const z = 1.96, p = k / n, z2 = z * z;
  const mid = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return [Math.round(Math.max(0, mid - half) * 100), Math.round(Math.min(1, mid + half) * 100)];
}
