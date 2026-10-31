import type { Metadata } from "next";
import Scorecard from "@/components/demo/Scorecard";
import corpus from "@/data/attacks/corpus.json";
import { scoreCorpus, type CorpusEntry } from "@/lib/inspector/scorecard";

export const metadata: Metadata = { title: "Injection scorecard | CartHold" };

// Same function /api/scorecard serves, run at build time so the server HTML carries the real result.
const score = scoreCorpus(corpus as CorpusEntry[]);

export default function ScorecardPage() {
  return <Scorecard initial={score} />;
}
