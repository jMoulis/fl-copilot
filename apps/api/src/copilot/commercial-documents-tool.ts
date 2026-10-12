import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "mongodb";
import {
  copilotDocumentsInputSchema,
  copilotDocumentsResultSchema,
  copilotPdfInputSchema,
  copilotPdfResultSchema,
  copilotEvidenceSchema,
  COMMERCIAL_VISUAL_SCHEMA_VERSION,
} from "@fl-copilot/domain";
import { synchronizedCommercialVisualReadingSchema } from "@fl-copilot/sync-contracts";
import {
  currentCommercialWeek,
  commercialDocumentWeekContext,
  scopeCommercialVisualReading,
  commercialEntryWeekStatus,
} from "@fl-copilot/commercial-core";
const sourceSchema = z.object({
  _id: z.string().uuid(),
  storeId: z.string().uuid(),
  originalFilename: z.string().min(1).max(240),
  checksum: z.string().min(1),
  createdAt: z.date(),
});
type Source = z.infer<typeof sourceSchema>;
const sourceFilter = {
  sourceType: "WEEKLY_COMMERCIAL_PDF",
  remoteUploadStatus: "CONFIRMED",
};
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
function sourceEvidence(s: Source) {
  return copilotEvidenceSchema.parse({
    id: `commercial-pdf-source/${hash([s.storeId, s._id, s.checksum])}`,
    sourceType: "SOURCE_DOCUMENT",
    sourceId: s._id,
    sourceVersion: null,
    label: "PDF original",
    value: s.originalFilename,
    factKind: "QUALITY",
  });
}
export async function readCommercialDocuments(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  z.string().uuid().parse(storeId);
  const input = copilotDocumentsInputSchema.parse(raw);
  const rows = await db
    .collection<Source>("sourceDocuments")
    .find({
      ...sourceFilter,
      storeId,
      ...(input.cursor
        ? {
            $or: [
              { createdAt: { $lt: new Date(input.cursor.createdAt) } },
              {
                createdAt: new Date(input.cursor.createdAt),
                _id: { $lt: input.cursor.id },
              },
            ],
          }
        : {}),
    })
    .sort({ createdAt: -1, _id: -1 })
    .maxTimeMS(2000)
    .limit(input.limit + 1)
    .toArray();
  const parsed = rows.map((r) => sourceSchema.parse(r));
  if (parsed.some((s) => s.storeId !== storeId))
    throw Error("COPILOT_DOCUMENT_SCOPE_INVALID");
  const page = parsed.slice(0, input.limit),
    last = page.at(-1),
    hasMore = parsed.length > input.limit;
  return copilotDocumentsResultSchema.parse({
    documents: page.map((s) => ({
      sourceDocumentId: s._id,
      filename: s.originalFilename,
      createdAt: s.createdAt.toISOString(),
    })),
    nextCursor:
      hasMore && last
        ? { id: last._id, createdAt: last.createdAt.toISOString() }
        : null,
    evidence: [
      ...page.map(sourceEvidence),
      copilotEvidenceSchema.parse({
        id: `commercial-documents-coverage/${hash([storeId, input, page.map((s) => s._id), hasMore])}`,
        sourceType: "DATA_QUALITY",
        sourceId: storeId,
        sourceVersion: null,
        label: "Documents commerciaux disponibles",
        value: `${page.length} PDF dans cette page, triés par dépôt récent${hasMore ? " ; d’autres documents restent à consulter" : " ; fin de la liste"}. La date de dépôt ne détermine pas la semaine commerciale.`,
        factKind: "QUALITY",
      }),
    ],
  });
}
export async function readCommercialPdf(db: Db, storeId: string, raw: unknown) {
  z.string().uuid().parse(storeId);
  const input = copilotPdfInputSchema.parse(raw);
  const row = await db
    .collection<Source>("sourceDocuments")
    .findOne({ ...sourceFilter, _id: input.sourceDocumentId, storeId });
  if (!row) throw Error("COPILOT_DOCUMENT_UNAVAILABLE");
  const source = sourceSchema.parse(row);
  if (source.storeId !== storeId) throw Error("COPILOT_DOCUMENT_SCOPE_INVALID");
  const week = currentCommercialWeek(
    new Date(`${input.businessDate}T12:00:00Z`),
  );
  const readings = db.collection<{
    _id: string;
    storeId: string;
    sourceDocumentId: string;
    pageNumber: number;
    updatedAt: Date;
  }>("commercialVisualReadings");
  const filter = {
    storeId,
    sourceDocumentId: source._id,
    checksum: source.checksum,
    schemaVersion: COMMERCIAL_VISUAL_SCHEMA_VERSION,
    status: "READY",
  };
  const rawPage = await readings
    .find({ ...filter, pageNumber: input.pageNumber })
    .sort({ updatedAt: -1, _id: -1 })
    .maxTimeMS(2000)
    .limit(1)
    .next();
  const page = rawPage
    ? synchronizedCommercialVisualReadingSchema.parse(rawPage)
    : null;
  if (
    page &&
    (page.id !== rawPage!._id ||
      page.storeId !== storeId ||
      page.sourceDocumentId !== source._id ||
      page.checksum !== source.checksum ||
      page.pageNumber !== input.pageNumber)
  )
    throw Error("COPILOT_PDF_SCOPE_INVALID");
  const headerRow =
    page && input.pageNumber !== 1
      ? await readings
          .find({ ...filter, pageNumber: 1, model: page.model })
          .sort({ updatedAt: -1, _id: -1 })
          .maxTimeMS(2000)
          .limit(1)
          .next()
      : rawPage;
  const header = headerRow
    ? synchronizedCommercialVisualReadingSchema.parse(headerRow)
    : null;
  if (
    header &&
    (header.storeId !== storeId ||
      header.sourceDocumentId !== source._id ||
      header.checksum !== source.checksum ||
      (header.pageNumber !== 1 && input.pageNumber !== 1))
  )
    throw Error("COPILOT_PDF_SCOPE_INVALID");
  const context = commercialDocumentWeekContext(
    header?.reading ? [header.reading] : [],
  );
  const reading = page?.reading;
  const scoped = reading
    ? scopeCommercialVisualReading(reading, week, context)
    : null;
  type Entry = z.infer<typeof copilotPdfResultSchema>["entries"][number];
  const entries: Entry[] = [];
  const add = (
    label: string,
    value: string | null,
    refs: NonNullable<typeof reading>["operations"][number]["evidence"],
    confidence: number | null,
  ) => {
    const id = `commercial-pdf-entry/${hash([storeId, source._id, source.checksum, page?.id, week.start, entries.length, label, value, refs, confidence])}`;
    entries.push({
      id,
      label,
      value,
      confidence,
      citations: refs.map(({ pageNumber, quote, region }) => ({
        pageNumber,
        quote,
        region,
      })),
      verification: refs.map((r) => r.verification),
    });
  };
  const fields = (
    label: string,
    fs: NonNullable<typeof reading>["operations"][number]["fields"],
  ) =>
    fs.forEach((f) =>
      add(`${label} — ${f.name}`, f.rawValue, f.evidence, f.confidence),
    );
  if (scoped) {
    for (const op of scoped.operations) {
      const label = `${op.kind} — ${op.label}`;
      add(label, op.summaryFr, op.evidence, null);
      fields(label, op.fields);
      for (const item of op.items) {
        add(`${label} — ${item.label}`, item.kind, item.evidence, null);
        fields(`${label} — ${item.label}`, item.fields);
      }
    }
    for (const [kind, items] of [
      ["Idée TG", scoped.tgIdeas],
      ["Instruction ou anticipation", scoped.otherInformation],
    ] as const) {
      for (const item of items) {
        add(`${kind} — ${item.label}`, item.kind, item.evidence, null);
        fields(`${kind} — ${item.label}`, item.fields);
      }
    }
  }
  if (reading)
    for (const warning of reading.warnings)
      add("Réserve de lecture documentaire", warning, [], null);
  const selected = entries.slice(input.offset, input.offset + input.limit),
    nextOffset =
      input.offset + selected.length < entries.length
        ? input.offset + selected.length
        : null;
  const excludedOperations =
    reading?.operations.filter(
      (o) => commercialEntryWeekStatus(o, week) === "OUTSIDE",
    ).length ?? 0;
  const unknownOperations =
    reading?.operations.filter(
      (o) => commercialEntryWeekStatus(o, week) === "UNKNOWN",
    ).length ?? 0;
  const quality = `Lecture IA extraite du PDF, non validée commercialement ; chiffres annoncés par l’enseigne, pas ventes/marges observées. Semaine ${week.number}/${week.year}, ${week.start} au ${week.end}. Page ${input.pageNumber}${page ? ` sur ${page.pageCount}` : " non prête"}. ${selected.length} éléments dans ce segment ; ${nextOffset !== null ? "suite de page à consulter" : "fin du segment de page"}. ${excludedOperations} opérations hors semaine exclues ; ${unknownOperations} périodes indéterminées exclues. ${page && page.pageCount === 1 ? "Le document comporte une seule page." : "Les autres pages n’ont pas été consultées par ce résultat."} Le contexte documentaire des TG utilise seulement l’en-tête de la première page disponible.${reading?.warnings.length ? " Nombre de réserves documentaires : " + reading.warnings.length : ""}`;
  return copilotPdfResultSchema.parse({
    sourceDocumentId: source._id,
    businessDate: input.businessDate,
    pageNumber: input.pageNumber,
    pageCount: page?.pageCount ?? null,
    status: reading ? "READY" : "NOT_READY",
    week,
    entries: selected,
    nextOffset,
    excludedOperations,
    unknownOperations,
    evidence: [
      sourceEvidence(source),
      ...selected.map((e) =>
        copilotEvidenceSchema.parse({
          id: e.id,
          sourceType: "SOURCE_DOCUMENT",
          sourceId: source._id,
          sourceVersion: page!.remoteVersion,
          label: `Lecture PDF à confirmer — page ${input.pageNumber} — ${e.label}`,
          value: e.value,
          factKind: "SOURCE_INSTRUCTION",
        }),
      ),
      copilotEvidenceSchema.parse({
        id: `commercial-pdf-coverage/${hash([storeId, input, page?.id, selected.map((e) => e.id), quality])}`,
        sourceType: "DATA_QUALITY",
        sourceId: source._id,
        sourceVersion: null,
        label: "Périmètre et réserves de lecture du PDF",
        value: quality,
        factKind: "QUALITY",
      }),
    ],
  });
}
