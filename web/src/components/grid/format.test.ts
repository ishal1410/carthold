import { describe, expect, it } from "vitest";
import { attacksFirst, correctMark, filterDecisions, formatCountdown, formatTime, formatUsd, newestFirst, VERDICT_CLASS } from "./format";

describe("grid formatters", () => {
  it("formats local HH:MM:SS", () => {
    expect(formatTime(new Date(2026, 9, 28, 9, 5, 7).toISOString())).toBe("09:05:07");
  });
  it("formats USD", () => {
    expect(formatUsd(1000)).toBe("$1,000.00");
    expect(formatUsd(24.5)).toBe("$24.50");
  });
  it("counts down and expires", () => {
    expect(formatCountdown(125_000)).toBe("2:05");
    expect(formatCountdown(400)).toBe("0:01");
    expect(formatCountdown(0)).toBe("expired");
  });
  it("maps verdict to color class", () => {
    expect(VERDICT_CLASS.allow).toContain("emerald");
    expect(VERDICT_CLASS.hold).toContain("amber");
    expect(VERDICT_CLASS.block).toContain("red");
  });
  it("sorts newest first without mutating", () => {
    const rows = [{ time: "2026-10-28T10:00:00Z" }, { time: "2026-10-28T11:00:00Z" }];
    expect(newestFirst(rows).map((r) => r.time)).toEqual(["2026-10-28T11:00:00Z", "2026-10-28T10:00:00Z"]);
    expect(rows[0].time).toBe("2026-10-28T10:00:00Z");
  });
  it("marks correctness", () => {
    expect(correctMark(true)).toBe("✓");
    expect(correctMark(false)).toBe("✗");
  });
  it("filters decisions by status chip and text (incl. status label)", () => {
    const r = (status: string, merchant: string, reasons: string[] = []) => ({ status, merchant, items: "1x Mug", reasons });
    const rows = [r("blocked", "Shady", ["inspector: order follows injected text"]), r("captured", "Trailhead")];
    expect(filterDecisions(rows, "all", "").length).toBe(2);
    expect(filterDecisions(rows, "blocked", "").map((x) => x.merchant)).toEqual(["Shady"]);
    expect(filterDecisions(rows, "all", "paid").map((x) => x.merchant)).toEqual(["Trailhead"]);
    expect(filterDecisions(rows, "all", "INJECTED").map((x) => x.merchant)).toEqual(["Shady"]);
    expect(filterDecisions(rows, "held", "")).toEqual([]);
  });
  it("orders attacks before benign, by id", () => {
    const rows = [
      { id: "b-1", label: "benign" },
      { id: "a-2", label: "attack" },
      { id: "b-0", label: "benign" },
      { id: "a-1", label: "attack" },
    ];
    expect(attacksFirst(rows).map((x) => x.id)).toEqual(["a-1", "a-2", "b-0", "b-1"]);
    expect(rows[0].id).toBe("b-1");
  });
});
