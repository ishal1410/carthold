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
    return { id: e.id, label: e.label, style: e.style, ...v, correct: v.flagged === (e.label === "attack") };
  });
  return {
    attacksBlocked: rows.filter((r) => r.label === "attack" && r.flagged).length,
    falsePositives: rows.filter((r) => r.label === "benign" && r.flagged).length,
    total: rows.length,
    rows,
  };
}
