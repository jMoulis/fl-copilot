import type { StoreContextSettings } from "./store-context-settings";
import { z } from "zod";
export const transportPointSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();
export const transportLineSchema = z
  .object({
    id: z.string().regex(/^IDFM:C\d{5}$/),
    name: z.string().trim().min(1).max(100),
    mode: z.string().max(50),
    stopId: z.string().min(1).max(100),
    stopName: z.string().min(1).max(140),
    distanceMetres: z.number().int().min(0).max(2200),
    enabled: z.boolean(),
  })
  .strict();
export const storeTransportsSchema = z
  .object({
    city: z.string().min(1).max(120),
    postalCode: z.string().regex(/^\d{5}$/),
    address: z.string().trim().min(3).max(240).nullable(),
    location: transportPointSchema
      .extend({
        label: z.string().min(1).max(240),
        source: z.enum(["STORE_GPS", "ADDRESS"]),
      })
      .strict(),
    radiusMetres: z.number().int().min(200).max(2000),
    lines: z.array(transportLineSchema).max(32),
    detectedAt: z.iso.datetime(),
    partial: z.boolean(),
  })
  .strict()
  .superRefine((s, c) => {
    if (
      new Set(s.lines.map((l) => l.id)).size !== s.lines.length ||
      s.lines.filter((l) => l.enabled).length > 16
    )
      c.addIssue({
        code: "custom",
        message: "Choisis au maximum 16 lignes distinctes.",
      });
    if (s.lines.some((l) => l.distanceMetres > s.radiusMetres))
      c.addIssue({
        code: "custom",
        message: "Un arrêt est en dehors du rayon recherché.",
      });
    if ((s.location.source === "ADDRESS") !== (s.address !== null))
      c.addIssue({
        code: "custom",
        message: "L’adresse et la localisation ne correspondent pas.",
      });
  });
export const nearbyTransportInputSchema = z
  .object({
    address: z.string().trim().min(3).max(240).nullable(),
    postalCode: z.string().regex(/^\d{5}$/),
    point: transportPointSchema.nullable(),
    radiusMetres: z.number().int().min(200).max(2000),
    candidateId: z.string().max(150).optional(),
  })
  .strict()
  .refine(
    (s) => (s.address !== null) !== (s.point !== null),
    "Choisis une adresse ou une position enregistrée.",
  );
export const nearbyTransportResultSchema = z
  .object({
    storeId: z.uuid(),
    retrievedAt: z.iso.datetime(),
    partial: z.boolean(),
    location: storeTransportsSchema.shape.location.nullable(),
    candidates: z
      .array(
        transportPointSchema
          .extend({ id: z.string().max(150), label: z.string().max(240) })
          .strict(),
      )
      .max(5),
    lines: z.array(transportLineSchema).max(32),
  })
  .strict();
export type StoreTransports = z.infer<typeof storeTransportsSchema>;
export type NearbyTransportInput = z.infer<typeof nearbyTransportInputSchema>;
export type NearbyTransportResult = z.infer<typeof nearbyTransportResultSchema>;
const compactDateTime = z.string().regex(/^\d{8}T\d{6}$/);
export const transportDisruptionSchema = z
  .object({
    id: z.string().min(1).max(200),
    message: z.string().max(700),
    effect: z.string().max(80).nullable(),
    applicationPeriods: z
      .array(
        z.object({ begin: compactDateTime, end: compactDateTime }).strict(),
      )
      .max(32),
    schedule: z.string().max(600).nullable(),
    updatedAt: compactDateTime.nullable(),
  })
  .strict();
export const transportLineContextSchema = z
  .object({
    id: z.string().regex(/^IDFM:C\d{5}$/),
    name: z.string().max(100),
    stopName: z.string().max(140),
    distanceMetres: z.number().int().nonnegative(),
    status: z.enum(["AVAILABLE", "STALE", "UNAVAILABLE"]),
    retrievedAt: z.iso.datetime().nullable(),
    validUntil: z.iso.datetime().nullable(),
    capturedAt: z.iso.datetime().nullable(),
    disruptions: z.array(transportDisruptionSchema).max(8),
    partial: z.boolean(),
    history: z
      .array(
        z
          .object({
            capturedAt: z.iso.datetime(),
            disruptions: z.array(transportDisruptionSchema).max(3),
            partial: z.boolean(),
          })
          .strict(),
      )
      .max(7)
      .optional(),
  })
  .strict();
export const transportContextSchema = z
  .object({
    status: z.enum(["AVAILABLE", "STALE", "UNAVAILABLE", "NOT_CONFIGURED"]),
    issue: z
      .enum([
        "MISSING_API_KEY",
        "LOCATION_CHANGED",
        "NO_SELECTED_LINES",
        "PROVIDER_UNAVAILABLE",
        "HISTORY_UNAVAILABLE",
      ])
      .nullable(),
    radiusMetres: z.number().int().min(200).max(2000),
    lines: z.array(transportLineContextSchema).max(16),
  })
  .strict();
export type TransportContext = z.infer<typeof transportContextSchema>;
export type TransportDisruption = z.infer<typeof transportDisruptionSchema>;

/** A stale selection must not attach transport data to a changed shop location. */
export function storeTransportLocationChanged(settings: StoreContextSettings) {
  const profile = settings.transports;
  return (
    !!profile &&
    (profile.city !== settings.city ||
      profile.postalCode !== settings.postalCode ||
      (profile.location.source === "STORE_GPS" &&
        (!settings.position ||
          settings.locationMode !== "POINT" ||
          settings.position.latitude !== profile.location.latitude ||
          settings.position.longitude !== profile.location.longitude)))
  );
}

/** Provider effect codes, not inferred incident causes. Unknown codes remain information. */
export const transportAlertTypeSchema = z.enum([
  "INTERRUPTION",
  "REDUCED_SERVICE",
  "DELAYS",
  "DETOUR",
  "SERVICE_CHANGE",
  "INFORMATION",
]);
export type TransportAlertType = z.infer<typeof transportAlertTypeSchema>;
export const transportAlertTypes = transportAlertTypeSchema.options;
export const transportAlertTypeLabels: Record<TransportAlertType, string> = {
  INTERRUPTION: "Interruptions",
  REDUCED_SERVICE: "Service réduit",
  DELAYS: "Retards",
  DETOUR: "Déviations",
  SERVICE_CHANGE: "Modifications de service",
  INFORMATION: "Informations et autres",
};
export const transportAlertSelectionSchema = z
  .array(transportAlertTypeSchema)
  .max(6)
  .refine((v) => new Set(v).size === v.length, "Choisis des types distincts.");
export function transportAlertType(effect: string | null): TransportAlertType {
  switch (effect) {
    case "NO_SERVICE":
      return "INTERRUPTION";
    case "REDUCED_SERVICE":
      return "REDUCED_SERVICE";
    case "SIGNIFICANT_DELAYS":
      return "DELAYS";
    case "DETOUR":
      return "DETOUR";
    case "MODIFIED_SERVICE":
    case "ADDITIONAL_SERVICE":
      return "SERVICE_CHANGE";
    default:
      return "INFORMATION";
  }
}
/** PRIM sometimes marks an equipment outage as a traffic delay. Keep mixed
 * circulation notices under their original effect; never rewrite source data. */
export function isStationEquipmentNotice(message: string): boolean {
  const text = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const equipment = /\b(?:ascenseurs?|escalators?|escaliers? mecaniques?)\b/;
  if (!equipment.test(text)) return false;
  // A location (quai/ligne/direction) alone is not a circulation disruption.
  const circulation =
    /\b(?:retards?|deviations?|(?:interruption|suspension|ralentissement|perturbation|suppression|annulation)[^.;·]{0,60}(?:trafic|circulation|bus|train|service|ligne)|trafic[^.;·]{0,80}(?:interromp|suspend|ralenti|perturb)|circulation[^.;·]{0,80}(?:interromp|suspend|ralenti|perturb)|(?:bus|trains?|rames?|services?|lignes?)[^.;·]{0,80}(?:supprim|annul|interromp|suspend|devie|ralenti|perturb)|(?:stations?|gares?)[^.;·]{0,80}(?:ferme|fermeture)|arrets?[^.;·]{0,60}non desserv|fermeture[^.;·]{0,60}(?:station|gare|ligne))/;
  if (circulation.test(text)) return false;
  const outage = /\b(?:pannes?|indisponibles?|hors[ -]service|maintenance)\b/;
  return text
    .split(/[.;·\n]/)
    .some((clause) => equipment.test(clause) && outage.test(clause));
}
/** Filter only projections. Retained source messages and capture dates never change. */
export function filterTransportAlerts(
  context: TransportContext | "NOT_CONFIGURED",
  types?: TransportAlertType[] | null,
): TransportContext | "NOT_CONFIGURED" {
  if (typeof context === "string" || types == null) return context;
  const selected = new Set(types);
  const filter = <
    T extends { disruptions: TransportDisruption[]; partial: boolean },
  >(
    row: T,
  ): T => {
    const disruptions = row.disruptions.filter((d) =>
      selected.has(
        isStationEquipmentNotice(d.message)
          ? "INFORMATION"
          : transportAlertType(d.effect),
      ),
    );
    return {
      ...row,
      disruptions,
      partial: row.partial || disruptions.length < row.disruptions.length,
    };
  };
  return {
    ...context,
    lines: context.lines.map((l) => ({
      ...filter(l),
      ...(l.history ? { history: l.history.map(filter) } : {}),
    })),
  };
}
