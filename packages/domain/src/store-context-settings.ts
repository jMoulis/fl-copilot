import { z } from "zod";
/** Manager-declared commercial context; neither measured geometry nor inferred sales heat. */
export const storeMerchandisingZoneSchema = z
  .strictObject({
    id: z.uuid(),
    label: z.string().trim().min(1).max(80),
    kind: z.enum(["TG", "ISLAND_FACE", "AREA"]),
    active: z.boolean().nullable(),
    position: z.string().trim().min(1).max(300).nullable(),
    heat: z.enum(["UNKNOWN", "HOT", "INTERMEDIATE", "COLD"]),
    note: z.string().trim().min(1).max(300).nullable(),
  })
  .refine(
    (zone) => zone.kind === "TG" || zone.active === null,
    "L’activité concerne seulement les TG.",
  );
export const storeMerchandisingSchema = z
  .strictObject({
    activeTgCount: z.number().int().min(0).max(128).nullable(),
    implantation: z.string().trim().min(1).max(1200).nullable(),
    circulation: z.string().trim().min(1).max(1200).nullable(),
    zones: z.array(storeMerchandisingZoneSchema).max(32),
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.zones.map((zone) => zone.id)).size !== value.zones.length ||
      new Set(value.zones.map((zone) => zone.label.toLocaleLowerCase("fr-FR")))
        .size !== value.zones.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["zones"],
        message:
          "Chaque emplacement doit avoir une identité et un nom distincts.",
      });
    if (
      value.activeTgCount !== null &&
      value.zones.filter((zone) => zone.kind === "TG" && zone.active === true)
        .length > value.activeTgCount
    )
      ctx.addIssue({
        code: "custom",
        path: ["activeTgCount"],
        message:
          "Le nombre de TG actives ne peut pas être inférieur aux TG déclarées actives.",
      });
  });
export type StoreMerchandising = z.infer<typeof storeMerchandisingSchema>;
export type StoreMerchandisingZone = z.infer<
  typeof storeMerchandisingZoneSchema
>;
export const storeContextSettingsSchema = z
  .object({
    id: z.string().uuid(),
    storeId: z.string().uuid(),
    city: z.string().trim().min(1).max(120),
    postalCode: z
      .string()
      .regex(/^\d{5}$/, "Saisissez un code postal français à cinq chiffres."),
    country: z.literal("FR"),
    timezone: z.literal("Europe/Paris"),
    schoolZone: z.enum(["A", "B", "C"]).nullable(),
    locationMode: z.enum(["CITY", "POINT"]),
    position: z
      .object({
        latitude: z.number().finite().min(-90).max(90),
        longitude: z.number().finite().min(-180).max(180),
        capturedAt: z.string().datetime(),
        source: z.literal("DEVICE"),
      })
      .strict()
      .nullable(),
    merchandising: storeMerchandisingSchema.nullable().optional(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((s, c) => {
    if (s.id !== s.storeId)
      c.addIssue({
        code: "custom",
        path: ["id"],
        message: "La configuration doit appartenir au magasin.",
      });
    if ((s.locationMode === "POINT") !== (s.position !== null))
      c.addIssue({
        code: "custom",
        path: ["position"],
        message:
          "Capturez une position ou choisissez la localisation par commune.",
      });
  });
export type StoreContextSettings = z.infer<typeof storeContextSettingsSchema>;

/** Omission by an older writer preserves context; an explicit null clears it. */
export function preserveStoreMerchandising(
  next: StoreContextSettings,
  previous?: StoreContextSettings | null,
): StoreContextSettings {
  return next.merchandising === undefined &&
    previous?.merchandising !== undefined
    ? { ...next, merchandising: previous.merchandising }
    : next;
}
/** Older strict readers cannot parse the optional new field. Never change the stored entity. */
export function legacyStoreContext(
  settings: StoreContextSettings,
): StoreContextSettings {
  const { merchandising, ...legacy } = settings;
  void merchandising;
  return legacy;
}

export const merchandisingHeatLabels: Record<
  StoreMerchandisingZone["heat"],
  string
> = {
  UNKNOWN: "non qualifiée",
  HOT: "chaude",
  INTERMEDIATE: "intermédiaire",
  COLD: "froide",
};
export function storeMerchandisingSummary(
  value: StoreMerchandising | null | undefined,
) {
  if (!value) return "Repères merchandising non renseignés.";
  return [
    `Repères déclarés par le magasin, non mesurés : ${value.activeTgCount === null ? "nombre de TG actives F&L non renseigné" : `${value.activeTgCount} TG actives F&L`}.`,
    `Implantation : ${value.implantation ?? "non renseignée"}.`,
    `Circulation principale : ${value.circulation ?? "non renseignée"}.`,
    ...value.zones.map(
      (zone) =>
        `${zone.label} (${zone.kind === "TG" ? `TG ${zone.active === null ? "activité à préciser" : zone.active ? "active F&L" : "inactive F&L"}` : zone.kind === "ISLAND_FACE" ? "face d’îlot" : "zone"}) : ${merchandisingHeatLabels[zone.heat]}.`,
    ),
    "Ces qualifications ne prouvent ni fréquentation mesurée ni effet sur les ventes. Les repères textuels ne sont pas des cibles géométriques validées.",
  ].join("\n");
}
