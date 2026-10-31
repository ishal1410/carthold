import { describe, expect, it } from "vitest";
import { verdictLabel } from "../grid/format";
import { actionError, runSettled, runStartError } from "./errors";
import type { DecisionRow, GuardState } from "@/lib/guard/guard";
import { fixtureState, settleFixtureHold } from "./fixtures";
import { holdUpdates } from "./Trace";
import { gist, paidUsd } from "./Verdicts";

const heldId = () => fixtureState().pendingHolds[0];

describe("recorded run hold settlement (B4)", () => {
  it("expiry voids the hold, clears it and frees the money, like the server's auto-void", () => {
    const g = fixtureState();
    const id = heldId();
    const amount = g.rows.find((r) => r.id === id)!.amountUsd;
    const s = settleFixtureHold(g, id, "expire");
    const row = s.rows.find((r) => r.id === id)!;
    expect(row.status).toBe("voided");
    expect(row.decision).toBe("expired");
    expect(row.expiresAt).toBeUndefined();
    expect(row.reasons).toContain("auto-voided: approval timed out");
    expect(s.pendingHolds).toEqual([]);
    expect(s.amountAtRiskUsd).toBe(0);
    expect(s.committedUsd).toBe(g.committedUsd - amount);
  });

  it("approving after expiry changes nothing", () => {
    const expired = settleFixtureHold(fixtureState(), heldId(), "expire");
    expect(settleFixtureHold(expired, heldId(), "approve")).toBe(expired);
  });

  it("approve captures and keeps the money committed", () => {
    const g = fixtureState();
    const s = settleFixtureHold(g, heldId(), "approve");
    expect(s.rows.find((r) => r.id === heldId())!.status).toBe("captured");
    expect(s.committedUsd).toBe(g.committedUsd);
    expect(s.amountAtRiskUsd).toBe(0);
  });
});

describe("paid KPI (B14)", () => {
  it("counts captured rows only, never pending or held", () => {
    const rows = [
      { status: "captured", amountUsd: 18 },
      { status: "pending", amountUsd: 20 },
      { status: "held", amountUsd: 30 },
      { status: "captured", amountUsd: 5 },
    ];
    expect(paidUsd(rows)).toBe(23);
  });
});

describe("view-only wording (B6)", () => {
  const approved = settleFixtureHold(fixtureState(), heldId(), "approve").rows.find((r) => r.verdict === "hold")!;
  it("owner tab says you", () => {
    expect(gist(approved, false)).toBe("approved by you");
    expect(holdUpdates([approved], false)[0]).toMatch(/^You approved the \$30\.00 hold/);
  });
  it("viewer tab credits the run's owner", () => {
    expect(gist(approved, true)).toBe("approved by the run's owner");
    expect(holdUpdates([approved], true)[0]).toMatch(/^The run's owner approved the \$30\.00 hold/);
    const rejected = settleFixtureHold(fixtureState(), heldId(), "reject").rows.find((r) => r.verdict === "hold")!;
    expect(gist(rejected, true)).toBe("rejected by the run's owner");
    expect(holdUpdates([rejected], true)[0]).toMatch(/^The run's owner rejected/);
  });
});

describe("action error text (C6b)", () => {
  it("keeps the server's 4xx message", () => {
    expect(actionError(400, "hold already decided")).toBe("hold already decided");
  });
  it("hides 5xx bodies and thrown errors", () => {
    expect(actionError(500, "qa-intercept")).toBe("Server error, try again.");
    expect(actionError(undefined)).toBe("Network error, try again.");
  });
  it("falls back when a 4xx has no message", () => {
    expect(actionError(404)).toBe("Request failed (HTTP 404).");
  });
});

describe("display words for CSV (C4d)", () => {
  it("exports the words the grid shows", () => {
    expect(verdictLabel("block")).toBe("Block");
    expect(verdictLabel("allow")).toBe("Allow");
  });
});

describe("m4: run start errors", () => {
  it("503 says the server is busy, without the body", () => {
    expect(runStartError(503, "too many active runs")).toBe("The server is busy. Try again in a minute.");
  });
  it("a mapped 4xx appends the server message once", () => {
    expect(runStartError(429, "daily demo limit reached")).toBe("Too many runs right now. Wait a minute and try again. daily demo limit reached");
  });
  it("an unmapped 4xx shows the server message once, no nested parentheses", () => {
    expect(runStartError(400, "invalid body: mode")).toBe("Run did not start: invalid body: mode");
    expect(runStartError(404)).toBe("Run did not start (HTTP 404).");
  });
  it("an unmapped 5xx stays generic", () => {
    expect(runStartError(500, "stack trace")).toBe("Run did not start. Server error, try again.");
  });
});

describe("m5: client settled check mirrors the server", () => {
  const row = (id: string, status: DecisionRow["status"]) => ({ id, status }) as DecisionRow;
  const g = (rows: DecisionRow[], extra: Partial<GuardState> = {}): GuardState =>
    ({ rows, pendingHolds: [], amountAtRiskUsd: 0, committedUsd: 0, unknownRows: rows.filter((r) => r.status === "unknown").map((r) => r.id), ...extra }) as GuardState;
  it("unsettled while a row is held or pending, even with no pending hold", () => {
    expect(runSettled(g([row("a", "held")]))).toBe(false);
    expect(runSettled(g([row("a", "pending")]))).toBe(false);
  });
  it("unsettled while a pending hold or a still-resolving unknown row exists", () => {
    expect(runSettled(g([row("a", "voided")], { pendingHolds: ["a"] }))).toBe(false);
    expect(runSettled(g([row("a", "unknown")]))).toBe(false);
  });
  it("settled once only final rows and unresolvable unknown rows remain", () => {
    expect(runSettled(g([row("a", "captured"), row("b", "unknown")], { unresolvable: ["b"] }))).toBe(true);
  });
});
