import { expect, it } from "vitest";
import {
  buildProcurementCrosswalk,
  proposedMercalysItm,
} from "./procurement-crosswalk";

const offer = (
  genericId: string,
  offerId = "offer-1",
  genericLabel = "CAROTTE VRAC",
) => ({ genericId, offerId, genericLabel });
const reference = (
  itm8 = "87005002",
  plu: string | null = "5002",
  sourceIndex = 10,
  label = "CAROTTE VRAC",
) => ({ sourceIndex, itm8, plu, label });

it("attaches four offers to one explicit PLU without matching unrelated ITM suffixes", () => {
  const row = buildProcurementCrosswalk(
    ["75998-01", "77762-01", "74934-59", "75632-59"].map((id) =>
      offer("5002", id),
    ),
    [
      reference(),
      reference("87405002", null, 11, "CITRON FILET"),
      reference("87605002", null, 12, "NECTARINE"),
    ],
  )[0]!;
  expect(row).toMatchObject({
    state: "PLU_MATCH",
    reasons: [],
    candidates: [reference()],
  });
  expect(row.offerIds).toHaveLength(4);
});
it("uses the explicit Nina PLU despite a different ITM ending", () => {
  expect(
    buildProcurementCrosswalk(
      [offer("3435", "x", "POMME NINA VRAC")],
      [reference("0000086007466", "3435", 23, "POMME NINA VRAC")],
    )[0],
  ).toMatchObject({ state: "PLU_MATCH", reasons: [] });
});
it("proposes the full 87-prefix convention for packaged generics, never the last four digits", () => {
  expect(proposedMercalysItm("430008")).toBe("87430008");
  expect(proposedMercalysItm("10738")).toBe("87010738");
  expect(
    buildProcurementCrosswalk(
      [offer("430008")],
      [reference("0000087430008", null)],
    )[0],
  ).toMatchObject({
    state: "ITM_CANDIDATE",
    candidates: [reference("0000087430008", null)],
  });
  for (const value of ["", "0", "1234567", "5002x"])
    expect(proposedMercalysItm(value)).toBeNull();
});
it("leaves a matching label without a matching code unresolved", () => {
  expect(
    buildProcurementCrosswalk([offer("9999")], [reference()])[0],
  ).toMatchObject({ state: "UNMATCHED", candidates: [], labelAgreement: null });
});
it("does not discard leading zeroes on a PLU to invent equivalence", () => {
  expect(
    buildProcurementCrosswalk(
      [offer("5002")],
      [reference("86000000", "05002")],
    )[0]!.state,
  ).toBe("UNMATCHED");
});
it("holds contradictory explicit PLU and constructed ITM owners for review in either row order", () => {
  const refs = [
    reference("86005000", "5002", 1),
    reference("87005002", null, 2),
  ];
  const a = buildProcurementCrosswalk([offer("5002")], refs);
  expect(a[0]).toMatchObject({
    state: "REVIEW",
    reasons: ["PLU_ITM_DISAGREE"],
  });
  expect(
    buildProcurementCrosswalk([offer("5002")], [...refs].reverse()),
  ).toEqual(a);
});
it("holds non-unique PLUs and ITMs, including 8/13-digit ITM aliases", () => {
  expect(
    buildProcurementCrosswalk(
      [offer("5002")],
      [reference("86000001", "5002", 1), reference("86000002", "5002", 2)],
    )[0],
  ).toMatchObject({ state: "REVIEW", reasons: ["NON_UNIQUE_PLU"] });
  expect(
    buildProcurementCrosswalk(
      [offer("5002")],
      [reference("87005002", null, 1), reference("0000087005002", null, 2)],
    )[0],
  ).toMatchObject({ state: "REVIEW", reasons: ["NON_UNIQUE_ITM"] });
});
it("does not override an explicitly different reference PLU with the derived code", () => {
  expect(
    buildProcurementCrosswalk(
      [offer("5002")],
      [reference("87005002", "9999")],
    )[0],
  ).toMatchObject({ state: "REVIEW", reasons: ["REFERENCE_PLU_DIFFERS"] });
});
it("holds duplicated offer identities and conflicting generic labels", () => {
  const result = buildProcurementCrosswalk(
    [
      offer("5002"),
      offer("5002", "offer-2", "CAROTTE BIO"),
      offer("3131", "offer-1"),
    ],
    [reference()],
  );
  expect(result.find((r) => r.genericId === "5002")).toMatchObject({
    state: "REVIEW",
    reasons: ["DUPLICATE_OFFER_ID", "CONFLICTING_GENERIC_LABELS"],
  });
  expect(result.find((r) => r.genericId === "3131")!.state).toBe("REVIEW");
});
it("requires review when different raw generic codes would resolve to the same reference", () => {
  const rows = buildProcurementCrosswalk(
    [offer("5002", "a"), offer("05002", "b")],
    [reference("87005002", null)],
  );
  expect(rows).toHaveLength(2);
  for (const row of rows)
    expect(row).toMatchObject({
      state: "REVIEW",
      reasons: ["MULTIPLE_GENERICS_ONE_REFERENCE"],
    });
});
it("keeps differing or shortened labels visible without changing the identity decision", () => {
  expect(
    buildProcurementCrosswalk(
      [offer("5002", "a", "CAROTTE VRAC")],
      [reference("87005002", "5002", 1, "CAROTTE")],
    )[0]!.labelAgreement,
  ).toBe("PREFIX_COMPATIBLE");
  expect(
    buildProcurementCrosswalk(
      [offer("5002", "a", "CAROTTE VRAC")],
      [reference("87005002", "5002", 1, "CAROTTE AUTRE")],
    )[0]!.labelAgreement,
  ).toBe("DIFFERENT");
});
it("does not mutate source arrays and rejects duplicated source indexes and numeric identifiers", () => {
  const offers = [offer("5002", "z"), offer("5002", "a")],
    refs = [reference()];
  const before = JSON.stringify([offers, refs]);
  buildProcurementCrosswalk(offers, refs);
  expect(JSON.stringify([offers, refs])).toBe(before);
  expect(() =>
    buildProcurementCrosswalk(offers, [reference(), reference()]),
  ).toThrow("PROCUREMENT_REFERENCE_INDEX_DUPLICATE");
  expect(() =>
    buildProcurementCrosswalk(
      [{ ...offer("5002"), genericId: 5002 } as never],
      refs,
    ),
  ).toThrow();
});
