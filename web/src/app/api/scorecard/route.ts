import { connection } from "next/server";
import corpus from "../../../data/attacks/corpus.json";
import { scoreCorpus, type CorpusEntry } from "../../../lib/inspector/scorecard";
import { json } from "../../../lib/run/http";

export async function GET() {
  await connection();
  return json(scoreCorpus(corpus as CorpusEntry[]));
}
