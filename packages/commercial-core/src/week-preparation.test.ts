import { describe, it, expect } from "vitest";
import {
  commercialWeekPreparationSchema,
  type CommercialWeekPreparation,
} from "@fl-copilot/domain";
import {
  commercialPreparationOfferIssues,
  commercialWeekPreparationId,
} from "./week-preparation";
import { makeCommercialChoiceFixture } from "../../../scripts/commercial-choice-fixture-data";
let ordinal = 0;
const uuid = () =>
  `00000000-0000-4000-8000-${String(++ordinal).padStart(12, "0")}`;
async function sample() {
  const f = await makeCommercialChoiceFixture(
    {},
    async () => "a".repeat(64),
    uuid,
  );
  const plan: CommercialWeekPreparation = {
    id: uuid(),
    storeId: f.storeId,
    weekStart: "2026-10-05",
    weekEnd: "2026-10-11",
    status: "DRAFT",
    tgCapacity: null,
    offerRefs: [{ choiceId: f.choice.id, choiceVersion: 1 }],
    placements: [],
    note: "",
    version: 1,
    createdAt: f.choice.createdAt,
    updatedAt: f.choice.updatedAt,
  };
  return { f, plan };
}
describe("weekly store preparation", () => {
  it("does not assume four TGs from the source and enforces declared capacity", async () => {
    const { plan } = await sample();
    expect(commercialWeekPreparationSchema.parse(plan).tgCapacity).toBeNull();
    const placements = [
      {
        id: uuid(),
        label: "TG entrée",
        theme: "Raisin",
        offerIds: [plan.offerRefs[0]!.choiceId],
        sourceIdea: null,
      },
    ];
    expect(
      commercialWeekPreparationSchema.safeParse({ ...plan, placements })
        .success,
    ).toBe(false);
    expect(
      commercialWeekPreparationSchema.safeParse({
        ...plan,
        tgCapacity: 1,
        placements,
      }).success,
    ).toBe(true);
    expect(
      commercialWeekPreparationSchema.safeParse({
        ...plan,
        tgCapacity: 0,
        placements,
      }).success,
    ).toBe(false);
  });
  it("rejects duplicate locations, unknown assignments and false completed/validated states", async () => {
    const { plan } = await sample();
    const p = {
      id: uuid(),
      label: "TG 1",
      theme: "",
      offerIds: [uuid()],
      sourceIdea: null,
    };
    expect(
      commercialWeekPreparationSchema.safeParse({
        ...plan,
        tgCapacity: 2,
        placements: [p],
      }).success,
    ).toBe(false);
    expect(
      commercialWeekPreparationSchema.safeParse({
        ...plan,
        status: "VALIDATED",
      }).success,
    ).toBe(false);
    expect(
      commercialWeekPreparationSchema.safeParse({
        ...plan,
        tgCapacity: 2,
        placements: [
          { ...p, offerIds: [] },
          { ...p, id: uuid(), label: "tg 1" },
        ],
      }).success,
    ).toBe(false);
    expect(
      commercialWeekPreparationSchema.safeParse({
        ...plan,
        weekStart: "2026-02-31",
      }).success,
    ).toBe(false);
  });
  it("reports changed/withdrawn/outside offers without silently updating saved references", async () => {
    const { plan, f } = await sample(),
      before = JSON.stringify(plan);
    expect(commercialPreparationOfferIssues(plan, [f.choice])).toEqual([]);
    expect(
      commercialPreparationOfferIssues(plan, [{ ...f.choice, version: 2 }])[0]
        ?.code,
    ).toBe("CHANGED");
    expect(
      commercialPreparationOfferIssues(plan, [
        { ...f.choice, status: "WITHDRAWN" },
      ])[0]?.code,
    ).toBe("WITHDRAWN");
    expect(
      commercialPreparationOfferIssues(plan, [
        { ...f.choice, saleStart: "2026-10-15", saleEnd: "2026-10-17" },
      ])[0]?.code,
    ).toBe("OUTSIDE_WEEK");
    expect(JSON.stringify(plan)).toBe(before);
  });
  it("uses a separate stable identity namespace for the same store/week", async () => {
    let text = "";
    const id = await commercialWeekPreparationId(
      uuid(),
      "2026-10-05",
      async (value) => {
        text = value;
        return "a".repeat(64);
      },
    );
    expect(text).toContain("week-preparation.v1");
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
  });
});
