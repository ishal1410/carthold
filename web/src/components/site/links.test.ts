import { expect, test } from "vitest";
import { stores } from "@/data/stores";
import { STORE_SLUGS, isStorePage } from "./links";

test("STORE_SLUGS matches the store data", () => {
  expect([...STORE_SLUGS].sort()).toEqual(stores.map((s) => s.slug).sort());
});

test("isStorePage only matches real stores", () => {
  expect(isStorePage("/stores/northpine")).toBe(true);
  expect(isStorePage("/stores/northpine/")).toBe(true);
  expect(isStorePage("/stores/trailhead")).toBe(false);
  expect(isStorePage("/stores")).toBe(false);
  expect(isStorePage("/demo")).toBe(false);
});
