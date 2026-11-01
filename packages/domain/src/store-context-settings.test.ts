import { z } from "zod";
import { expect, it } from "vitest";
import {
  legacyStoreContext,
  preserveStoreMerchandising,
  storeContextSettingsSchema,
  storeMerchandisingSchema,
  storeMerchandisingSummary,
} from "./store-context-settings";
let sequence = 0;
const randomUUID = () =>
  `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
const storeContextFixture = () => {
  const storeId = randomUUID();
  return {
    id: storeId,
    storeId,
    city: "Asnières-sur-Seine",
    postalCode: "92600",
    country: "FR" as const,
    timezone: "Europe/Paris" as const,
    schoolZone: "C" as const,
    locationMode: "CITY" as const,
    position: null,
    version: 1,
    createdAt: "2026-11-01T10:00:00Z",
    updatedAt: "2026-11-01T10:00:00Z",
  };
};
const context = () => ({
  activeTgCount: 2,
  implantation: "Deux îlots",
  circulation: "Allée centrale entre les îlots ; TG1 en premier",
  zones: [
    {
      id: randomUUID(),
      label: "TG1",
      kind: "TG" as const,
      active: true,
      position: "Première du parcours",
      heat: "UNKNOWN" as const,
      note: null,
    },
  ],
});
it("keeps unknown heat distinct from cold and declared commercial capacity distinct from physical furniture", () => {
  const value = storeMerchandisingSchema.parse(context());
  expect(value.zones[0]!.heat).toBe("UNKNOWN");
  expect(storeMerchandisingSummary(value)).toContain("2 TG actives F&L");
  expect(storeMerchandisingSummary(value)).toContain("non qualifiée");
  expect(storeMerchandisingSummary(value)).not.toContain("froide");
  expect(
    storeMerchandisingSchema.safeParse({ ...value, activeTgCount: 0 }).success,
  ).toBe(false);
  expect(
    storeMerchandisingSchema.safeParse({
      ...value,
      activeTgCount: 0,
      zones: [],
    }).success,
  ).toBe(true);
  expect(
    storeMerchandisingSchema.safeParse({
      ...value,
      zones: [
        value.zones[0],
        { ...value.zones[0], id: randomUUID(), label: "tg1" },
      ],
    }).success,
  ).toBe(false);
  expect(
    storeMerchandisingSchema.safeParse({
      ...value,
      zones: [{ ...value.zones[0], kind: "AREA" }],
    }).success,
  ).toBe(false);
});
it("preserves context omitted by older writers, supports explicit clear and projects a valid legacy record without mutation", () => {
  const current = storeContextSettingsSchema.parse({
    ...storeContextFixture(),
    merchandising: context(),
  });
  const legacy = legacyStoreContext(current);
  expect(legacy).not.toHaveProperty("merchandising");
  const { merchandising: newField, ...legacyShape } =
    storeContextSettingsSchema.shape;
  void newField;
  const oldSchema = z.strictObject(legacyShape);
  expect(oldSchema.safeParse(legacy).success).toBe(true);
  expect(oldSchema.safeParse(current).success).toBe(false);
  expect(
    preserveStoreMerchandising({ ...legacy, city: "Paris" }, current)
      .merchandising,
  ).toEqual(current.merchandising);
  expect(
    preserveStoreMerchandising({ ...legacy, merchandising: null }, current)
      .merchandising,
  ).toBeNull();
  expect(current.merchandising?.zones[0]?.label).toBe("TG1");
});
