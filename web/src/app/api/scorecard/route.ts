import { connection } from "next/server";
import corpus from "../../../data/attacks/corpus.json";
import heldout from "../../../data/attacks/heldout.json";
import { scoreCorpus, type CorpusEntry } from "../../../lib/inspector/scorecard";
import { json } from "../../../lib/run/http";

// Top level stays the tuning set (corpus.json) for existing callers; `heldout` is the set never tuned against.
export async function GET() {
  await connection();
  return json({ ...scoreCorpus(corpus as CorpusEntry[]), heldout: scoreCorpus(heldout as CorpusEntry[]) });
}
