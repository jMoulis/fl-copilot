import { z } from "zod";
import {
  salesObservationSchema,
  wasteObservationSchema,
  sourceRecordSchema,
} from "@fl-copilot/domain";
const transportFields = {
  syncState: true,
  remoteVersion: true,
  dirty: true,
} as const;
export const mercalysSalesSchema = salesObservationSchema.omit(transportFields);
export const mercalysWasteSchema = wasteObservationSchema.omit(transportFields);
const normalizedRecordSchema = z.object({
  itm8: z.string().nullable(),
  ean: z.string().nullable(),
  rawLabel: z.string(),
  businessDate: z.string().date(),
  quantity: z.number().finite(),
  purchaseValue: z.number().finite().nullable(),
  rceValue: z.number().finite().nullable(),
  salesValue: z.number().finite().nullable(),
  vatValue: z.number().finite().nullable(),
  marginValue: z.number().finite().nullable(),
  marginRate: z.number().finite().nullable(),
});
export const mercalysPublicationSchema = z
  .object({
    source: z.object({
      id: z.string().uuid(),
      storeId: z.string().uuid(),
      sourceType: z.enum(["MERCALYS_SALES", "MERCALYS_WASTE"]),
      checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      originalFilename: z.string().nullable(),
      businessPeriodStart: z.string().date(),
      businessPeriodEnd: z.string().date(),
      parserVersion: z.string().nullable(),
      createdAt: z.string().datetime({ offset: true }),
    }),
    records: z.array(sourceRecordSchema).min(1).max(5000),
    sales: z.array(mercalysSalesSchema).max(5000),
    waste: z.array(mercalysWasteSchema).max(5000),
  })
  .superRefine((p, c) => {
    const fail = () =>
      c.addIssue({
        code: "custom",
        message: "Invalid Mercalys publication lineage.",
      });
    if (
      p.source.businessPeriodStart > p.source.businessPeriodEnd ||
      (p.source.sourceType === "MERCALYS_SALES"
        ? p.waste.length
        : p.sales.length)
    )
      fail();
    if (JSON.stringify(p).length > 1_000_000)
      c.addIssue({
        code: "custom",
        message:
          "Import trop volumineux pour une publication atomique. Le fichier original est conservé.",
      });
    const records = new Map(p.records.map((r) => [r.id, r]));
    const observations = [...p.sales, ...p.waste];
    if (
      records.size !== p.records.length ||
      new Set(p.records.map((r) => r.sourceIndex)).size !== p.records.length ||
      new Set(observations.map((o) => o.id)).size !== observations.length ||
      new Set(observations.map((o) => o.sourceRecordId)).size !==
        observations.length
    )
      fail();
    for (const r of p.records)
      if (
        r.storeId !== p.source.storeId ||
        r.sourceDocumentId !== p.source.id ||
        r.deletedAt ||
        r.sourceIndex == null ||
        !normalizedRecordSchema.safeParse(r.normalizedPayload).success
      )
        fail();
    for (const o of observations) {
      const r = records.get(o.sourceRecordId);
      if (
        o.storeId !== p.source.storeId ||
        o.sourceDocumentId !== p.source.id ||
        !r ||
        r.status !== "PUBLISHED" ||
        o.businessDate < p.source.businessPeriodStart ||
        o.businessDate > p.source.businessPeriodEnd
      )
        fail();
    }
    for (const r of p.records)
      if (
        r.status === "PUBLISHED" &&
        !observations.some((o) => o.sourceRecordId === r.id)
      )
        fail();
    for (const o of p.waste)
      if (o.sourceType !== "MERCALYS" || o.purchaseValueEstimated !== null)
        fail();
  });
export type MercalysPublication = z.infer<typeof mercalysPublicationSchema>;
export const synchronizedMercalysPublicationSchema = z.object({
  id: z.string().uuid(),
  storeId: z.string().uuid(),
  remoteVersion: z.number().int().positive(),
  publication: mercalysPublicationSchema,
});
export type SynchronizedMercalysPublication = z.infer<
  typeof synchronizedMercalysPublicationSchema
>;
