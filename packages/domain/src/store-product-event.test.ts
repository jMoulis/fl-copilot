import { it, expect } from "vitest";
import {
  prepareStoreProductEvent,
  storeProductEventSchema,
  closeStoreProductEvent,
  createStoreEventPayloadSchema,
} from "./store-product-event";
import {
  storeEventTimeCandidates,
  selectStoreEventTime,
  storeEventTimeParts,
} from "./store-event-time";
const store = "11111111-1111-4111-8111-111111111111",
  product = "22222222-2222-4222-8222-222222222222",
  id = "33333333-3333-4333-8333-333333333333";
function capture() {
  return {
    event: {
      id,
      productId: product,
      type: "OUT_OF_STOCK",
      startedAt: "2026-10-09T11:00:00+02:00",
      clientCapturedAt: "2026-10-09T10:00:00Z",
    },
  };
}
it("creates the six explicit store observations with unknown severity and no PDF/stock/KPI inference", () => {
  for (const type of [
    "TENSION",
    "LOW_STOCK",
    "OUT_OF_STOCK",
    "QUALITY_ISSUE",
    "PRICE_INCREASE",
    "SUPPLIER_SHORTAGE",
  ]) {
    const e = prepareStoreProductEvent(store, {
      event: { ...capture().event, type },
    });
    expect(e).toMatchObject({
      source: "USER",
      sourceDocumentId: null,
      severity: null,
      comment: null,
      status: "ACTIVE",
      endedAt: null,
      version: 1,
      startedAt: "2026-10-09T09:00:00.000Z",
    });
    expect("stock" in e).toBe(false);
  }
  expect(
    createStoreEventPayloadSchema.safeParse({
      event: { ...capture().event, source: "COMMERCIAL_PDF" },
    }).success,
  ).toBe(false);
});
it("refuses future or reverse intervals and long notes; closure retains immutable capture fields", () => {
  const e = prepareStoreProductEvent(store, capture());
  const closed = closeStoreProductEvent(
    e,
    "2026-10-09T11:00:00Z",
    "2026-10-09T12:00:00Z",
  );
  expect(closed).toMatchObject({
    productId: e.productId,
    startedAt: e.startedAt,
    source: e.source,
    createdAt: e.createdAt,
    endedAt: "2026-10-09T11:00:00.000Z",
    version: 2,
    status: "CLOSED",
  });
  expect(() =>
    closeStoreProductEvent(e, "2026-10-09T08:00:00Z", "2026-10-09T12:00:00Z"),
  ).toThrow();
  expect(() =>
    prepareStoreProductEvent(store, {
      event: { ...capture().event, startedAt: "2026-10-10T12:00:00Z" },
    }),
  ).toThrow();
  expect(() =>
    prepareStoreProductEvent(store, {
      event: { ...capture().event, comment: "a".repeat(1201) },
    }),
  ).toThrow();
  expect(
    storeProductEventSchema.safeParse({ ...e, status: "CLOSED" }).success,
  ).toBe(false);
});
it("uses Paris calendar times on another timezone and rejects missing/ambiguous DST hours", () => {
  expect(selectStoreEventTime("2026-10-09", "12:00")).toBe(
    "2026-10-09T10:00:00.000Z",
  );
  expect(storeEventTimeParts("2026-10-09T22:30:00Z")).toEqual({
    date: "2026-10-10",
    time: "00:30",
  });
  expect(storeEventTimeCandidates("2026-03-29", "02:30")).toEqual([]);
  expect(() => selectStoreEventTime("2026-03-29", "02:30")).toThrow();
  const choices = storeEventTimeCandidates("2026-10-25", "02:30");
  expect(choices).toEqual([
    "2026-10-25T00:30:00.000Z",
    "2026-10-25T01:30:00.000Z",
  ]);
  expect(() => selectStoreEventTime("2026-10-25", "02:30")).toThrow();
  expect(selectStoreEventTime("2026-10-25", "02:30", choices[1])).toBe(
    choices[1],
  );
  expect(() => selectStoreEventTime("2026-02-30", "12:00")).toThrow();
});
