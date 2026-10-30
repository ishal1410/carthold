import { describe, expect, it } from "vitest";
import { getPageText, getStore } from "../../data/stores";
import { markParts } from "./highlight";

describe("markParts", () => {
  it("marks every hidden GiftHub segment in the real page text", () => {
    const store = getStore("gifthub")!;
    const marked = markParts(getPageText("gifthub"), store.hidden.map((h) => h.text)).filter((p) => p.marked).map((p) => p.text);
    expect(store.hidden.length).toBe(3);
    for (const h of store.hidden) expect(marked).toContain(h.text);
  });
  it("merges overlapping needles and keeps the text intact", () => {
    const parts = markParts("abcdef", ["bcd", "cde", undefined, ""]);
    expect(parts).toEqual([
      { text: "a", marked: false },
      { text: "bcde", marked: true },
      { text: "f", marked: false },
    ]);
    expect(parts.map((p) => p.text).join("")).toBe("abcdef");
  });
});
