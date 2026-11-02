import { expect, it } from "vitest";
import { makeCommercialPlanFixture } from "../../../scripts/commercial-plan-fixture-data";
let sequence = 0;
const uuid = () =>
  `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
const testChoiceDigest = async (s: string) => {
  let hash = 2166136261;
  for (const c of s) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  return hash.toString(16).padStart(8, "0").repeat(8);
};
const commercialPlanFixture = () =>
  makeCommercialPlanFixture(testChoiceDigest, uuid);
import { prepareCommercialPlanReview } from "./plan-review";
import { commercialPlanIssues } from "./week-plan";
const time = "2026-10-11T12:00:00.000Z";
it("does not mutate approvals or skip real issues when preparing a grouped review", async () => {
  const f = await commercialPlanFixture(),
    current = { ...f.context, validated: [] };
  const before = JSON.stringify(current);
  const r = await prepareCommercialPlanReview(
    f.preparation,
    current,
    null,
    testChoiceDigest,
    time,
  );
  expect(r.issues).toEqual([]);
  expect(r.basis.offerRefs).toHaveLength(1);
  expect(JSON.stringify(current)).toBe(before);
  expect(
    commercialPlanIssues(f.preparation, current).map((i) => i.code),
  ).toContain("NOT_VALIDATED");
  const blocked = await prepareCommercialPlanReview(
    f.preparation,
    { ...current, products: [] },
    null,
    testChoiceDigest,
    time,
  );
  expect(blocked.issues.map((i) => i.code)).toContain("PRODUCT_INVALID");
});
it.each([null, 0, 1])(
  "respects declared TG capacity %s without inferring zero or changing the draft",
  async (activeTgCount) => {
    const f = await commercialPlanFixture();
    const r = await prepareCommercialPlanReview(
      f.preparation,
      f.context,
      {
        version: 1,
        merchandising: {
          activeTgCount,
          implantation: null,
          circulation: null,
          zones: [],
        },
      },
      testChoiceDigest,
      time,
    );
    expect(r.issues.some((i) => i.code === "STORE_TG_CAPACITY_CHANGED")).toBe(
      activeTgCount === 0 ||
        (activeTgCount !== null &&
          (f.preparation.tgCapacity ?? 0) > activeTgCount),
    );
    expect(r.basis.storeSettingsVersion).toBe(1);
  },
);
it("binds source review data but not the preview clock, and reuses existing approvals", async () => {
  const f = await commercialPlanFixture();
  const current = { ...f.context, validated: [] };
  const first = await prepareCommercialPlanReview(
    f.preparation,
    current,
    null,
    testChoiceDigest,
    time,
  );
  const later = await prepareCommercialPlanReview(
    f.preparation,
    current,
    null,
    testChoiceDigest,
    "2026-10-11T13:00:00.000Z",
  );
  expect(later.basis).toEqual(first.basis);
  const approved = await prepareCommercialPlanReview(
    f.preparation,
    f.context,
    null,
    testChoiceDigest,
    time,
  );
  expect(approved.basis.offerRefs).toEqual([]);
});

it("does not block a fitting allocation just because an old draft declared excess unused capacity", async () => {
  const f = await commercialPlanFixture();
  const preparation = { ...f.preparation, tgCapacity: 8 };
  const r = await prepareCommercialPlanReview(
    preparation,
    { ...f.context, preparation },
    {
      version: 1,
      merchandising: {
        activeTgCount: 1,
        implantation: null,
        circulation: null,
        zones: [],
      },
    },
    testChoiceDigest,
    time,
  );
  expect(r.issues).toEqual([]);
});
