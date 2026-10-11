import { z } from "zod";
import { storeContextSettingsSchema } from "./store-context-settings";
import { productClassificationAuthoritySchema } from "./copilot-product-mutations";
const { city, postalCode, schoolZone } = storeContextSettingsSchema.shape;
export const settingsReadInputSchema = z.strictObject({});
export const settingsReadRequestSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("store.settings.inspect"),
  input: settingsReadInputSchema,
});
export const settingsReadResultSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("store.settings.inspect"),
  status: z.literal("COMPLETED"),
  observedAt: z.string().datetime(),
  message: z.string(),
  snapshot: z
    .strictObject({
      entity: storeContextSettingsSchema,
      syncState: z.string(),
      remoteVersion: z.number().int().positive().nullable(),
    })
    .nullable(),
});
export const settingsReadTool = {
  name: "store.settings.inspect",
  schemaVersion: 1,
  effect: "READ",
  runtime: "LOCAL",
  confirmation: "NONE",
  description:
    "Consulter la configuration locale du magasin et son état de synchronisation. Ne lit pas la position actuelle du téléphone.",
  progress: "Lecture de la configuration du magasin…",
  inputSchema: settingsReadInputSchema,
  outputSchema: settingsReadResultSchema,
} as const;
export const settingsSaveInputSchema = z.strictObject({
  expectedVersion: z.number().int().positive().nullable(),
  city,
  postalCode,
  schoolZone,
  location: z.enum(["CITY", "KEEP"]),
});
export const settingsSaveRequestSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("store.settings.save"),
  input: settingsSaveInputSchema,
});
export const settingsSaveAuthoritySchema = productClassificationAuthoritySchema
  .omit({ canManageProducts: true })
  .extend({ canManageStoreSettings: z.boolean() });
export type SettingsSaveAuthority = z.infer<typeof settingsSaveAuthoritySchema>;
export function settingsSaveIntent(raw: unknown) {
  return JSON.stringify(settingsSaveRequestSchema.parse(raw));
}
export const settingsSaveResultSchema = z.strictObject({
  operationId: z.string().uuid(),
  schemaVersion: z.literal(1),
  tool: z.literal("store.settings.save"),
  status: z.literal("COMPLETED"),
  userMessageId: z.string().uuid(),
  appliedAt: z.string().datetime(),
  before: storeContextSettingsSchema.nullable(),
  after: storeContextSettingsSchema,
  commandId: z.string().uuid().nullable(),
  syncState: z.string(),
  message: z.string(),
});
export const copilotStoreSettingsMutationRegistry = [
  {
    name: "store.settings.save",
    schemaVersion: 1,
    effect: "WRITE",
    runtime: "LOCAL",
    confirmation: "REVIEWED_USER_INTENT",
    description:
      "Enregistrer la commune, le code postal et la zone scolaire confirmés. CITY choisit explicitement la commune, KEEP conserve le mode existant ; aucune position GPS ne peut être inventée ou capturée.",
    progress: "Enregistrement de la configuration…",
    inputSchema: settingsSaveInputSchema,
    outputSchema: settingsSaveResultSchema,
  },
] as const;
