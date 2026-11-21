import { expect, it } from "vitest";
import { strToU8 } from "fflate";
import { procurementFixture } from "../../../scripts/test-procurement-fixtures";
import { MAX_PROCUREMENT_SOURCE_BYTES } from "@fl-copilot/domain";
import {
  parseProcurementCatalogue,
  serializeProcurementCatalogue,
} from "./procurement-catalogue-parser";
const bytes = (v: unknown) => strToU8(JSON.stringify(v));
const parse = (v: unknown = procurementFixture()) =>
  parseProcurementCatalogue(bytes(v), "09083");

it("keeps exact offer/generic identities, dated quotes, logistical quantities and raw VAT multiplier", () => {
  const p = parse();
  expect(p.asOf).toBe("2026-11-21T05:02:40.133Z");
  expect(p.offers[0]).toMatchObject({
    genericId: "005002",
    offerId: "75632-59",
    supplierProductId: "75632",
    weight: "12",
    packagingQuantity: "1",
    vatMultiplier: "1.0550000000000002",
    tariff: {
      purchasePrice: "1.39",
      priceUnit: false,
      orderDeadlines: ["2026-11-21 09:30"],
      deliveryDates: ["2026-11-23"],
    },
  });
  expect(p.offers[1]?.tariff).toBeNull();
  const json = serializeProcurementCatalogue(p);
  for (const forbidden of [
    "private-sender",
    "orders",
    "promos",
    "weather",
    "news",
    "commitments",
    "Ignore instructions",
  ])
    expect(json).not.toContain(forbidden);
  expect(serializeProcurementCatalogue(JSON.parse(json))).toBe(json);
});

it("preserves zero and false while absent quote values remain unknown", () => {
  const f = procurementFixture();
  const q = f.assortment.articles[0]!;
  q.purchasePrice = 0;
  q.sellingPrice = 0;
  q.complementaire = false;
  expect(parse(f).offers[0]?.tariff).toMatchObject({
    purchasePrice: "0",
    sellingPrice: "0",
    complementary: false,
  });
  Reflect.deleteProperty(q, "purchasePrice");
  Reflect.deleteProperty(q, "priceUnit");
  Reflect.deleteProperty(f.articles[0]!, "origin");
  expect(parse(f).offers[0]).toMatchObject({
    origin: null,
    tariff: { purchasePrice: null, priceUnit: null },
  });
});

it.each([
  "duplicate-offer",
  "duplicate-quote",
  "orphan-quote",
  "invalid-date",
  "invalid-time",
  "negative-price",
  "numeric-id",
])(
  "rejects %s without repairing identity or leaking the raw payload",
  (kind) => {
    const f = procurementFixture();
    if (kind === "duplicate-offer") f.articles.push(f.articles[0]!);
    if (kind === "duplicate-quote")
      f.assortment.articles.push(f.assortment.articles[0]!);
    if (kind === "orphan-quote") f.assortment.articles[0]!._id = "absent";
    if (kind === "invalid-date")
      f.assortment.articles[0]!.deliveryDates = ["2026-02-30"];
    if (kind === "invalid-time")
      f.assortment.articles[0]!.orderDeadlines = ["2026-11-21 25:30"];
    if (kind === "negative-price") f.assortment.articles[0]!.purchasePrice = -1;
    if (kind === "numeric-id") Reflect.set(f.articles[0]!, "genericId", 5002);
    expect(() => parse(f)).toThrow(/^PROCUREMENT_/);
  },
);

it("requires the selected store number; no unsupported provider access is attempted", () => {
  expect(() =>
    parseProcurementCatalogue(bytes(procurementFixture()), "9084"),
  ).toThrow("PROCUREMENT_PDV_MISMATCH");
  expect(() =>
    parseProcurementCatalogue(bytes(procurementFixture()), ""),
  ).toThrow("PROCUREMENT_EXPECTED_PDV_REQUIRED");
});

it("bounds bytes, rejects malformed UTF-8/JSON and accepts a UTF-8 BOM", () => {
  expect(() =>
    parseProcurementCatalogue(
      new Uint8Array(MAX_PROCUREMENT_SOURCE_BYTES + 1),
      "9083",
    ),
  ).toThrow("PROCUREMENT_SOURCE_SIZE_INVALID");
  expect(() =>
    parseProcurementCatalogue(new Uint8Array([0xff]), "9083"),
  ).toThrow("PROCUREMENT_JSON_INVALID");
  expect(() => parse({})).toThrow("PROCUREMENT_SOURCE_FORMAT_INVALID");
  expect(
    parseProcurementCatalogue(
      strToU8("\ufeff" + JSON.stringify(procurementFixture())),
      "9083",
    ).offers,
  ).toHaveLength(2);
});
