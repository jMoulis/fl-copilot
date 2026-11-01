import { z } from "zod";
import { storeContextSettingsSchema } from "./store-context-settings";
import { settingsReadInputSchema } from "./copilot-store-settings";
import { copilotEvidenceSchema } from "./copilot-candidate";
const fields = storeContextSettingsSchema.shape;
/** Deliberately excludes the device point, capture time and GPS fingerprint. */
export const copilotVisibleStoreSettingsSchema = z.strictObject({
  id: fields.id,
  storeId: fields.storeId,
  city: fields.city,
  postalCode: fields.postalCode,
  country: fields.country,
  timezone: fields.timezone,
  schoolZone: fields.schoolZone,
  locationMode: fields.locationMode,
  merchandising: fields.merchandising,
  version: fields.version,
  createdAt: fields.createdAt,
  updatedAt: fields.updatedAt,
});
export const copilotStoreSettingsInputSchema = settingsReadInputSchema;
export const copilotStoreSettingsResultSchema = z.strictObject({
  settings: copilotVisibleStoreSettingsSchema.nullable(),
  evidence: z.array(copilotEvidenceSchema).length(1),
});
