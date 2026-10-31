import { describe, expect, it } from "vitest";
import { describeApprovalRule, evaluate, type Mandate, type ProposedOrder } from "./policy";

// Demo mandate: $150 budget, $60/item cap, approve above $25.
const mandate: Mandate = {
  userRequest: "Get me a camping mug and a small gift for my sister.",
  budgetUsd: 150,
  perItemCapUsd: 60,
  approvalThresholdUsd: 25,
  merchantAllowlist: ["northpine", "brew-and-bean", "giftlane"],
  maxQuantity: 3,
};

const order = (over: Partial<ProposedOrder> = {}): ProposedOrder => ({
  merchant: "northpine",
  items: [{ name: "Enamel Camp Mug", quantity: 1, unitPriceUsd: 20 }],
  source: { pageUrl: "/stores/northpine/mug" },
  ...over,
});

describe("policy rules", () => {
  it("passes a clean in-limit order", () => {
    const d = evaluate(mandate, order(), 0);
    expect(d).toEqual({ verdict: "allow", reasons: [], amountUsd: 20 });
  });

  it("blocks when remaining budget is exceeded", () => {
    const d = evaluate(mandate, order(), 140);
    expect(d.verdict).toBe("block");
    expect(d.reasons.join()).toMatch(/budget/i);
  });

  it("blocks when an item exceeds the per-item cap", () => {
    const d = evaluate(mandate, order({ items: [{ name: "Camp Mug", quantity: 1, unitPriceUsd: 75 }] }), 0);
    expect(d.verdict).toBe("block");
    expect(d.reasons.join()).toMatch(/per-item cap/i);
  });

  it("blocks a merchant not on the allowlist", () => {
    const d = evaluate(mandate, order({ merchant: "quicktech" }), 0);
    expect(d.verdict).toBe("block");
    expect(d.reasons.join()).toMatch(/allowlist/i);
  });

  it("blocks quantity over mandate.maxQuantity", () => {
    const m = { ...mandate, userRequest: "buy 5 camping mugs" };
    const d = evaluate(m, order({ items: [{ name: "Camp Mug", quantity: 5, unitPriceUsd: 5 }] }), 0);
    expect(d.verdict).toBe("block");
    expect(d.reasons.join()).toMatch(/max quantity/i);
  });

  it("holds an order above the approval threshold", () => {
    const d = evaluate(mandate, order({ items: [{ name: "Enamel Camp Mug", quantity: 1, unitPriceUsd: 30 }] }), 0);
    expect(d).toEqual({ verdict: "hold", reasons: ["total $30 is over the $25 ask-me limit"], amountUsd: 30 });
  });

  it("blocks a malformed order from the agent (negative quantity)", () => {
    const d = evaluate(mandate, order({ items: [{ name: "Camp Mug", quantity: -1, unitPriceUsd: 20 }] }), 0);
    expect(d.verdict).toBe("block");
    expect(d.reasons.join()).toMatch(/invalid order/i);
  });

  it("matches merchants case-insensitively", () => {
    expect(evaluate(mandate, order({ merchant: "NorthPine" }), 0).verdict).toBe("allow");
  });
});

describe("provenance: order must trace to the user's own words", () => {
  const mug: Mandate = { ...mandate, userRequest: "a coffee mug under $40" };

  it("blocks 10 gift cards when the user asked for a coffee mug", () => {
    const d = evaluate(
      { ...mug, perItemCapUsd: 1000, budgetUsd: 5000, maxQuantity: 20 },
      order({ merchant: "giftlane", items: [{ name: "$100 Gift Card", quantity: 10, unitPriceUsd: 100 }] }),
      0,
    );
    expect(d.verdict).toBe("block");
    expect(d.reasons.some((r) => r.includes("not traceable to user request"))).toBe(true);
  });

  it("traces compound words: 'earbuds' request matches 'Pulse Buds Pro'", () => {
    const d = evaluate(
      { ...mandate, userRequest: "Cheap wireless earbuds under $50" },
      order({ items: [{ name: "Pulse Buds Pro, refurbished", quantity: 1, unitPriceUsd: 20 }] }),
      0,
    );
    expect(d.reasons.join()).not.toMatch(/not traceable/);
  });

  it("allows a $30 mug when the threshold is above it", () => {
    const d = evaluate({ ...mug, approvalThresholdUsd: 50 }, order({ items: [{ name: "Ceramic Coffee Mug", quantity: 1, unitPriceUsd: 30 }] }), 0);
    expect(d.verdict).toBe("allow");
  });

  it("holds a $30 mug when the threshold is below it", () => {
    const d = evaluate(mug, order({ items: [{ name: "Ceramic Coffee Mug", quantity: 1, unitPriceUsd: 30 }] }), 0);
    expect(d.verdict).toBe("hold");
  });

  it("blocks a quantity larger than the user asked for", () => {
    const d = evaluate(mug, order({ items: [{ name: "Ceramic Coffee Mug", quantity: 2, unitPriceUsd: 10 }] }), 0);
    expect(d.verdict).toBe("block");
    expect(d.reasons.join()).toMatch(/quantity 2 not traceable to user request/);
  });

  it("allows the quantity the user stated as a word or digit", () => {
    const two = { ...mug, userRequest: "two coffee mugs" };
    const three = { ...mug, userRequest: "3 coffee mugs", approvalThresholdUsd: 100 };
    const item = (q: number) => order({ items: [{ name: "Coffee Mug", quantity: q, unitPriceUsd: 5 }] });
    expect(evaluate(two, item(2), 0).verdict).toBe("allow");
    expect(evaluate(three, item(3), 0).verdict).toBe("allow");
  });

  it("does not read the $ price as a quantity", () => {
    const d = evaluate({ ...mug, maxQuantity: 100 }, order({ items: [{ name: "Coffee Mug", quantity: 40, unitPriceUsd: 1 }] }), 0);
    expect(d.verdict).toBe("block");
    expect(d.reasons.join()).toMatch(/asked for 1\)/);
  });

  it("blocks a unit price above the user's stated ceiling", () => {
    const d = evaluate({ ...mug, approvalThresholdUsd: 100 }, order({ items: [{ name: "Coffee Mug", quantity: 1, unitPriceUsd: 45 }] }), 0);
    expect(d.verdict).toBe("block");
    expect(d.reasons.join()).toMatch(/\$40/);
  });

  it("traces stemmed words: 'camping' request matches 'Camp Mug'", () => {
    const d = evaluate(mandate, order({ items: [{ name: "Camp Mug", quantity: 1, unitPriceUsd: 10 }] }), 0);
    expect(d.verdict).toBe("allow");
  });
});

describe("FINDINGS #3: approval threshold is cumulative across orders", () => {
  it("holds split $25 orders once committed + amount crosses the threshold", () => {
    const item = order({ items: [{ name: "Enamel Camp Mug", quantity: 1, unitPriceUsd: 25 }] });
    expect([0, 25, 50, 75].map((spent) => evaluate(mandate, item, spent).verdict)).toEqual(["allow", "hold", "hold", "hold"]);
  });
});

describe("FINDINGS #4: repeated line items are aggregated", () => {
  const blend = { name: "Morning Ritual Blend", quantity: 2, unitPriceUsd: 2.5 };
  const m = { ...mandate, userRequest: "Buy two coffee blend bags", merchantAllowlist: ["brew-and-bean"] };

  it("blocks 5 duplicate lines of qty 2 when the user asked for two", () => {
    const d = evaluate(m, order({ merchant: "brew-and-bean", items: Array(5).fill(blend) }), 0);
    expect(d.verdict).toBe("block");
    expect(d.reasons.join()).toMatch(/quantity 10 exceeds max quantity/);
    expect(d.reasons.join()).toMatch(/quantity 10 not traceable to user request \(asked for 2\)/);
  });

  it("blocks when total units across different items exceed maxQuantity", () => {
    const req = { ...mandate, userRequest: "2 camping mugs and 2 gift cards", approvalThresholdUsd: 100 };
    const d = evaluate(req, order({ items: [{ name: "Camp Mug", quantity: 2, unitPriceUsd: 5 }, { name: "Gift Card", quantity: 2, unitPriceUsd: 5 }] }), 0);
    expect(d.verdict).toBe("block");
    expect(d.reasons.join()).toMatch(/total quantity 4 exceeds max quantity 3/);
  });
});

describe("FINDINGS #8: cents are exact", () => {
  it("rejects non-whole-cent unit prices [40.005, 59.995]", () => {
    const d = evaluate({ ...mandate, userRequest: "a camping mug and a gift" },
      order({ items: [{ name: "Camp Mug", quantity: 1, unitPriceUsd: 40.005 }, { name: "Gift Box", quantity: 1, unitPriceUsd: 59.995 }] }), 0);
    expect(d.verdict).toBe("block");
    expect(d.reasons.join()).toMatch(/invalid order/i);
  });

  it("rejects 2 x 12.125", () => {
    const d = evaluate({ ...mandate, userRequest: "two camping mugs" }, order({ items: [{ name: "Camp Mug", quantity: 2, unitPriceUsd: 12.125 }] }), 0);
    expect(d.verdict).toBe("block");
    expect(d.reasons.join()).toMatch(/invalid order/i);
  });

  it("computes amount from integer cents (3 x 0.10 = 0.30, 3 x 19.99 = 59.97)", () => {
    const m = { ...mandate, userRequest: "three camping mugs", approvalThresholdUsd: 100 };
    expect(evaluate(m, order({ items: [{ name: "Camp Mug", quantity: 3, unitPriceUsd: 0.1 }] }), 0).amountUsd).toBe(0.3);
    expect(evaluate(m, order({ items: [{ name: "Camp Mug", quantity: 3, unitPriceUsd: 19.99 }] }), 0).amountUsd).toBe(59.97);
  });
});

describe("CR-10: provenance needs the head noun or half the keywords", () => {
  const traced = (userRequest: string, name: string) =>
    !evaluate({ ...mandate, userRequest, perItemCapUsd: 1000, approvalThresholdUsd: 1000 }, order({ items: [{ name, quantity: 1, unitPriceUsd: 20 }] }), 0)
      .reasons.some((r) => r.startsWith(`item "${name}" not traceable`));

  it("one shared modifier is not enough: 'coffee blend' does not trace 'Coffee Gift Card'", () => {
    expect(traced("Buy a coffee blend", "Coffee Gift Card")).toBe(false);
  });

  it("keeps legit matches", () => {
    expect(traced("camping coffee mug under $40", "Basecamp Enamel Mug, 16 oz")).toBe(true);
    expect(traced("Cheap wireless earbuds under $50", "Pulse Buds Pro, refurbished")).toBe(true);
    expect(traced("Get a small gift card for my sister, under $40", "Universal e-Gift Card, $25")).toBe(true);
    expect(traced("Buy two coffee blend bags", "Morning Ritual Blend, 3 x 4 oz")).toBe(true);
  });
});

describe("R2-P1 cumulative threshold UX", () => {
  const item = (usd: number) => order({ items: [{ name: "Enamel Camp Mug", quantity: 1, unitPriceUsd: usd }] });

  it("cumulative hold says the auto-pay limit was reached and how much was already paid", () => {
    expect(evaluate(mandate, item(20), 10).reasons).toEqual(["auto-pay limit $25 reached ($10 already auto-paid)"]);
  });

  it("R3-4: cumulative rule uses auto-paid money, budget uses committed", () => {
    // $60 committed (held / user-approved) but only $0 auto-paid: a $20 order auto-pays.
    expect(evaluate(mandate, item(20), 60, 0)).toEqual({ verdict: "allow", reasons: [], amountUsd: 20 });
    expect(evaluate(mandate, item(20), 60, 10).reasons).toEqual(["auto-pay limit $25 reached ($10 already auto-paid)"]);
    expect(evaluate(mandate, item(20), 140, 0).verdict).toBe("block");
  });

  it("single-order hold says it is over the ask-me limit", () => {
    expect(evaluate(mandate, item(30), 0).reasons).toEqual(["total $30 is over the $25 ask-me limit"]);
  });

  it("describeApprovalRule gives the one-line UI description", () => {
    expect(describeApprovalRule(mandate)).toBe("Pays up to $25 in total without asking; anything beyond that waits for your approval");
    expect(describeApprovalRule({ ...mandate, approvalThresholdUsd: 12.5 })).toBe(
      "Pays up to $12.50 in total without asking; anything beyond that waits for your approval",
    );
  });
});

describe("FINDINGS #27: in-mandate poisoned add-on", () => {
  const m: Mandate = { ...mandate, userRequest: "Buy me a camping coffee mug under $40", merchantAllowlist: ["Northpine Outfitters"] };
  const mug = { name: "Basecamp Enamel Mug, 16 oz", quantity: 1, unitPriceUsd: 30 };
  const kit = { name: "Trail Coffee Kit", quantity: 1, unitPriceUsd: 19 };

  it("blocks the $19 kit alone although it is under every cap and the approval limit", () => {
    const d = evaluate(m, order({ merchant: "Northpine Outfitters", items: [kit] }), 0);
    expect(d.verdict).toBe("block");
    expect(d.reasons).toEqual(['item "Trail Coffee Kit" not traceable to user request']);
  });

  it("blocks mug + kit on the kit only", () => {
    const d = evaluate(m, order({ merchant: "Northpine Outfitters", items: [mug, kit] }), 0);
    expect(d.verdict).toBe("block");
    expect(d.reasons).toEqual(['item "Trail Coffee Kit" not traceable to user request']);
  });
});

describe("CR-7: line merge is word-order insensitive", () => {
  it("merges 'Morning Ritual Blend' and 'Ritual Morning Blend' against 'Buy one coffee blend'", () => {
    const m = { ...mandate, userRequest: "Buy one coffee blend", merchantAllowlist: ["brew-and-bean"] };
    const items = [
      { name: "Morning Ritual Blend", quantity: 1, unitPriceUsd: 5 },
      { name: "Ritual Morning Blend", quantity: 1, unitPriceUsd: 5 },
    ];
    const d = evaluate(m, order({ merchant: "brew-and-bean", items }), 0);
    expect(d.verdict).toBe("block");
    expect(d.reasons.join()).toMatch(/quantity 2 not traceable to user request \(asked for 1\)/);
  });
});
