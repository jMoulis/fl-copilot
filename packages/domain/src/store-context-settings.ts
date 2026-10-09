import { z } from "zod";
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
