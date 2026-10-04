import { describe, expect, it } from "vitest";
import { visibleStoreSnapshot } from "./today-snapshot";

describe("Today store snapshot", () => {
  it("keeps the current store content visible while a refresh is in progress", () => {
    const summary = { businessDate: "2026-10-03" };
    const snapshot = { storeId: "store-1", value: summary };

    expect(visibleStoreSnapshot(snapshot, "store-1")).toBe(summary);
  });

  it("never exposes cached content from another store", () => {
    const snapshot = {
      storeId: "store-1",
      value: { businessDate: "2026-10-03" },
    };

    expect(visibleStoreSnapshot(snapshot, "store-2")).toBeUndefined();
    expect(visibleStoreSnapshot(snapshot, undefined)).toBeUndefined();
  });
});
