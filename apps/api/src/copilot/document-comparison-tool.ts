import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db, Document } from "mongodb";
import {
  copilotDocumentComparisonInputSchema,
  copilotDocumentComparisonResultSchema,
  validateDocumentComparisonResult,
  COMMERCIAL_VISUAL_SCHEMA_VERSION,
} from "@fl-copilot/domain";
import { synchronizedCommercialVisualReadingSchema } from "@fl-copilot/sync-contracts";
import {
  compareCommercialDocumentVersions,
  commercialComparisonPeriodCoverage,
  currentCommercialWeek,
} from "@fl-copilot/commercial-core";
const hash = (s: unknown) =>
  createHash("sha256").update(JSON.stringify(s)).digest("hex");
const sourceSchema = z.object({
  _id: z.uuid(),
  storeId: z.uuid(),
  checksum: z.string().min(1),
  originalFilename: z.string().min(1).max(240),
});
export async function readCommercialDocumentComparison(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  z.uuid().parse(storeId);
  const input = copilotDocumentComparisonInputSchema.parse(raw),
    week = currentCommercialWeek(new Date(`${input.businessDate}T12:00:00Z`));
  const load = async (documentId: string) => {
    const row = await db
      .collection<Document & { _id: string }>("sourceDocuments")
      .findOne(
        {
          _id: documentId,
          storeId,
          sourceType: "WEEKLY_COMMERCIAL_PDF",
          remoteUploadStatus: "CONFIRMED",
          deletedAt: null,
        },
        { maxTimeMS: 2000 },
      );
    if (!row) return null;
    const source = sourceSchema.parse(row);
    if (source._id !== documentId || source.storeId !== storeId)
      throw Error("DOCUMENT_COMPARISON_SCOPE");
    const rows = await db
      .collection<Document & { _id: string }>("commercialVisualReadings")
      .aggregate<Document & { _id: string }>(
        [
          {
            $match: {
              storeId,
              sourceDocumentId: documentId,
              checksum: source.checksum,
              schemaVersion: COMMERCIAL_VISUAL_SCHEMA_VERSION,
              status: { $in: ["READY", "FAILED"] },
            },
          },
          { $sort: { updatedAt: -1, _id: -1 } },
          { $group: { _id: "$pageNumber", reading: { $first: "$$ROOT" } } },
          { $replaceRoot: { newRoot: "$reading" } },
          { $sort: { pageNumber: 1 } },
          { $limit: 17 },
        ],
        { maxTimeMS: 2000 },
      )
      .toArray();
    if (rows.length > 16) return { source, pages: [], limited: true };
    const pages = rows.map((r) => {
      const p = synchronizedCommercialVisualReadingSchema.parse(r);
      if (
        p.id !== r._id ||
        p.storeId !== storeId ||
        p.sourceDocumentId !== documentId ||
        p.checksum !== source.checksum
      )
        throw Error("DOCUMENT_COMPARISON_SCOPE");
      return p;
    });
    const count = pages.reduce(
      (n, p) =>
        n +
        (p.reading?.operations.reduce(
          (n, op) => n + op.items.filter((i) => i.kind === "OFFER").length,
          0,
        ) ?? 0),
      0,
    );
    return { source, pages, limited: count > 1000 };
  };
  const [before, after] = await Promise.all([
    load(input.beforeDocumentId),
    load(input.afterDocumentId),
  ]);
  type Result = ReturnType<typeof copilotDocumentComparisonResultSchema.parse>;
  let state: Result["status"] =
    !before || !after
      ? "UNAVAILABLE"
      : before.source.checksum === after.source.checksum
        ? "SAME_BINARY"
        : before.limited || after.limited
          ? "LIMIT_EXCEEDED"
          : !before.pages.length || !after.pages.length
            ? "NOT_READY"
            : "COMPARED";
  const metadata = (s: typeof before): Result["before"] =>
    s
      ? {
          documentId: s.source._id,
          filename: s.source.originalFilename,
          checksum: s.source.checksum,
          coverage: null,
          period: null,
          warningCount: s.limited
            ? null
            : s.pages.reduce(
                (n, p) => n + (p.reading?.warnings.length ?? 0),
                0,
              ),
        }
      : null;
  const left = metadata(before),
    right = metadata(after);
  let counts: Result["counts"] = null,
    differenceCount: number | null = null,
    differences: Result["differences"] = [],
    nextOffset: number | null = null;
  if (state === "COMPARED") {
    const result = compareCommercialDocumentVersions({
      storeId,
      beforeDocumentId: input.beforeDocumentId,
      afterDocumentId: input.afterDocumentId,
      before: before!.pages,
      after: after!.pages,
      week,
    });
    left!.coverage = result.beforeCoverage;
    right!.coverage = result.afterCoverage;
    left!.period = commercialComparisonPeriodCoverage(before!.pages, week);
    right!.period = commercialComparisonPeriodCoverage(after!.pages, week);
    state =
      result.beforeCoverage.complete && result.afterCoverage.complete
        ? "COMPARED"
        : "INCOMPLETE";
    counts = result.counts as NonNullable<Result["counts"]>;
    differenceCount = result.differences.length;
    differences = result.differences.slice(
      input.offset,
      input.offset + input.limit,
    );
    nextOffset =
      input.offset + differences.length < differenceCount
        ? input.offset + differences.length
        : null;
  }
  const build = (): Result => {
    const id = hash([storeId, input, left, right, state, counts, differences]);
    const summary =
      state === "COMPARED" || state === "INCOMPLETE"
        ? `${state === "INCOMPLETE" ? "Lecture partielle : les absences et nouveautés ne sont pas établies sur les pages manquantes. " : ""}Semaine du ${week.start} au ${week.end} : ${counts!.CHANGED} groupes modifiés, ${counts!.UNCHANGED} inchangés, ${counts!.NOT_FOUND_IN_NEW} non retrouvés dans la nouvelle lecture, ${counts!.NEW_IN_READING} nouveaux dans la lecture, ${counts!.AMBIGUOUS} ambigus. ${differences.length} détails dans cette page sur ${differenceCount} ; ${nextOffset === null ? "fin de la comparaison" : "autres détails à consulter"}. Hors semaine : ${left!.period!.excluded} avant, ${right!.period!.excluded} après ; période indéterminée : ${left!.period!.unknown} avant, ${right!.period!.unknown} après. Avertissements d’extraction : ${left!.warningCount} avant, ${right!.warningCount} après. La comparaison porte sur les offres extraites de cette semaine ; les TG et consignes hors offres restent à lire dans les originaux. Les champs restent extraits et à vérifier, pas validés. Aucun produit, choix de référence, offre retenue ni plan n’a été modifié.`
        : state === "SAME_BINARY"
          ? "Les deux documents ont le même contenu binaire. Ce n’est pas une nouvelle version commerciale."
          : state === "LIMIT_EXCEEDED"
            ? "La comparaison complète ou un détail dépasse les limites de lecture du chat. Ouvrir les PDF originaux ; aucun détail bloquant n’est ignoré."
            : state === "NOT_READY"
              ? "La lecture visuelle d’un PDF n’est pas disponible. Ce n’est pas la preuve d’une absence d’offres."
              : "Au moins un PDF confirmé est indisponible dans ce magasin. Demander son identité ou sa synchronisation, sans inventer son contenu.";
    return {
      storeId,
      input,
      week,
      status: state,
      before: left,
      after: right,
      counts,
      differenceCount,
      differences,
      nextOffset,
      evidence: [
        ...[left, right]
          .filter((s) => s !== null)
          .map((s) => ({
            id: `commercial-pdf-source/${hash([storeId, s.documentId, s.checksum])}`,
            sourceType: "SOURCE_DOCUMENT" as const,
            sourceId: s.documentId,
            sourceVersion: null,
            label: "PDF original",
            value: s.filename,
            factKind: "QUALITY" as const,
          })),
        {
          id: `document-comparison/${id}/quality`,
          sourceType: "DATA_QUALITY",
          sourceId: input.afterDocumentId,
          sourceVersion: null,
          label: "Comparaison des PDF commerciaux",
          value: summary,
          factKind: "QUALITY",
        },
        ...differences.map((d, i) => ({
          id: `document-comparison/${id}/${input.offset + i}`,
          sourceType: "SOURCE_DOCUMENT" as const,
          sourceId: input.afterDocumentId,
          sourceVersion: null,
          label: d.after[0]?.label ?? d.before[0]?.label ?? "Offre à vérifier",
          value: JSON.stringify(d),
          factKind: "SOURCE_INSTRUCTION" as const,
        })),
      ],
    };
  };
  let result = build();
  if (
    Buffer.byteLength(JSON.stringify(result), "utf8") > 14000 ||
    result.evidence.some(
      (e) => typeof e.value === "string" && e.value.length > 10000,
    )
  ) {
    state = "LIMIT_EXCEEDED";
    counts = null;
    differenceCount = null;
    differences = [];
    nextOffset = null;
    result = build();
  }
  return validateDocumentComparisonResult(storeId, input, result);
}
