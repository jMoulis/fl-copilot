import { it, expect } from "vitest";
import type { Db } from "mongodb";
import { readPeriodWasteDrivers } from "./period-waste-drivers";
it("refuses to present a sampled top when the complete product-period read exceeds its bound", async () => {
  const rows = Array.from({ length: 20001 }, () => ({}));
  const cursor = {
    maxTimeMS() {
      return this;
    },
    limit() {
      return this;
    },
    async toArray() {
      return rows;
    },
  };
  const db = { collection: () => ({ find: () => cursor }) } as unknown as Db;
  const result = await readPeriodWasteDrivers(db, "store", {
    start: "2026-10-01",
    end: "2026-10-15",
  });
  expect(result).toEqual({
    drivers: { aggregation: "SUM", status: "LIMIT_EXCEEDED", products: [] },
    evidence: [],
  });
});
