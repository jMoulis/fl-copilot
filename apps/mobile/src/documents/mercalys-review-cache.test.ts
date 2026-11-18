import { expect, it } from "vitest";
import {
  MercalysReviewCache,
  getMercalysReviewCache,
} from "./mercalys-review-cache";
import type { MercalysImportValidationSummary } from "./mercalys-import-validation";
it("bounds memory to one snapshot, isolates returned values and invalidates source/store/catalogue changes", () => {
  const cache = new MercalysReviewCache();
  const catalog = { products: [], identifiers: [], aliases: [] };
  const key = cache.key("store", "hash", catalog);
  const summary = {
    lines: [],
    readyCount: 1,
  } as unknown as MercalysImportValidationSummary;
  cache.put(key, summary);
  cache.get(key)!.readyCount = 9;
  expect(cache.get(key)!.readyCount).toBe(1);
  expect(cache.get(cache.key("other", "hash", catalog))).toBeUndefined();
  expect(cache.get(cache.key("store", "changed", catalog))).toBeUndefined();
  const next = cache.key("store", "next", catalog);
  cache.put(next, summary);
  expect(cache.get(key)).toBeUndefined();
});

it("retains one snapshot across screen lifetimes but isolates database and owner", () => {
  const db = {};
  const first = getMercalysReviewCache(db, "store", "owner");
  expect(getMercalysReviewCache(db, "store", "owner")).toBe(first);
  expect(getMercalysReviewCache({}, "store", "owner")).not.toBe(first);
  expect(getMercalysReviewCache(db, "store", "other")).not.toBe(first);
  expect(getMercalysReviewCache(db, "store", "owner")).not.toBe(first);
});
