import { describe, expect, it } from "vitest";
import corpus from "../../data/attacks/corpus.json";
import heldout from "../../data/attacks/heldout.json";
import { scoreCorpus, wilson, type CorpusEntry } from "./scorecard";

describe("wilson", () => {
  it("matches the intervals in docs/evidence/2026-10-31-measurements.md", () => {
    expect(wilson(19, 20)).toEqual([76, 99]);
    expect(wilson(4, 12)).toEqual([14, 61]);
    expect(wilson(0, 20)).toEqual([0, 16]);
    expect(wilson(0, 8)).toEqual([0, 32]);
    expect(wilson(0, 10)).toEqual([0, 28]);
  });
});

describe("held-out set", () => {
  it("scores with the same function and has no false alarms", () => {
    const h = scoreCorpus(heldout as CorpusEntry[]);
    const t = scoreCorpus(corpus as CorpusEntry[]);
    expect(h.total).toBe(20);
    expect(h.falsePositives).toBe(0);
    // The point of the page: the tuning-set rate overstates the held-out rate.
    expect(h.attacksBlocked / 12).toBeLessThan(t.attacksBlocked / 20);
  });
});

describe("scoreCorpus rows", () => {
  it("carry each attack's expected trigger so the client never needs the corpus JSON", () => {
    const entry = (heldout as CorpusEntry[]).find((e) => e.label === "attack" && e.expectedTrigger)!;
    const row = scoreCorpus(heldout as CorpusEntry[]).rows.find((r) => r.id === entry.id)!;
    expect(row.expectedTrigger).toBe(entry.expectedTrigger);
  });
});
