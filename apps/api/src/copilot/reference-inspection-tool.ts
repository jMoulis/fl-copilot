import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import {
  copilotReferenceInspectionInputSchema,
  validateReferenceInspectionResult,
  type copilotReferenceInspectionResultSchema,
} from "@fl-copilot/domain";
import {
  commercialVersionDecisionId,
  commercialVersionDecisionSnapshotsValid,
} from "@fl-copilot/commercial-core";
import type { z } from "zod";
import { loadCommercialComparisonOriginal } from "./document-comparison-tool";
import {
  serializeCommercialVersionDecision,
  type VersionDecisionDocument,
} from "../commercial/version-decision-sync";
const digest = async (s: string) =>
  createHash("sha256").update(s).digest("hex");
export async function inspectCommercialReference(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  const input = copilotReferenceInspectionInputSchema.parse(raw);
  const [first, second] = await Promise.all([
    loadCommercialComparisonOriginal(db, storeId, input.firstDocumentId),
    loadCommercialComparisonOriginal(db, storeId, input.secondDocumentId),
  ]);
  type Result = z.infer<typeof copilotReferenceInspectionResultSchema>;
  const side = (s: NonNullable<typeof first>) => ({
    documentId: s.source._id,
    filename: s.source.originalFilename,
    checksum: s.source.checksum,
  });
  let status: Result["status"] = "UNAVAILABLE",
    decision: Result["decision"] = null,
    reviewStatus: Result["reviewStatus"] = null;
  if (first && second) {
    const id = await commercialVersionDecisionId(
      storeId,
      input.firstDocumentId,
      input.secondDocumentId,
      digest,
    );
    const row = await db
      .collection<VersionDecisionDocument>("commercialVersionDecisions")
      .findOne({ _id: id, storeId }, { maxTimeMS: 2000 });
    if (row) {
      decision = serializeCommercialVersionDecision(row);
      if (
        decision.id !== id ||
        decision.storeId !== storeId ||
        ![input.firstDocumentId, input.secondDocumentId].includes(
          decision.before.documentId,
        ) ||
        ![input.firstDocumentId, input.secondDocumentId].includes(
          decision.after.documentId,
        )
      )
        throw Error("REFERENCE_INSPECTION_IDENTITY");
      status = "RECORDED";
      const originals = new Map([first, second].map((s) => [s.source._id, s]));
      const exactReadingSets = [decision.before, decision.after].every(
        (s) =>
          JSON.stringify([...s.readingIds].sort()) ===
          JSON.stringify(
            originals
              .get(s.documentId)
              ?.pages.map((p) => p.id)
              .sort(),
          ),
      );
      const checksumsMatch = [decision.before, decision.after].every(
        (s) => originals.get(s.documentId)?.source.checksum === s.checksum,
      );
      reviewStatus = !checksumsMatch
        ? "REVIEW_REQUIRED"
        : first.limited || second.limited
          ? "LIMIT_EXCEEDED"
          : exactReadingSets &&
              commercialVersionDecisionSnapshotsValid(
                { storeId, before: decision.before, after: decision.after },
                [...first.pages, ...second.pages],
              )
            ? "MATCHING_SNAPSHOTS"
            : "REVIEW_REQUIRED";
    } else status = "NO_DECISION";
  }
  const build = (): Result => {
    const sources = [first, second]
      .filter((s) => s !== null)
      .map((s) => side(s));
    const chosenId = decision
      ? decision.preference === "KEEP_PREVIOUS"
        ? decision.before.documentId
        : decision.after.documentId
      : null;
    const chosen = sources.find((s) => s.documentId === chosenId);
    const summary =
      status === "RECORDED"
        ? `Choix synchronisé enregistré : ${chosen!.filename}, révision ${decision!.version}, enregistré le ${decision!.updatedAt}. ${decision!.note ? `Note : ${decision!.note}. ` : ""}${reviewStatus === "MATCHING_SNAPSHOTS" ? "Les lectures synchronisées correspondent aux instantanés du choix enregistré. Cela ne constitue pas une nouvelle revue humaine." : reviewStatus === "LIMIT_EXCEEDED" ? "La vérification actuelle des lectures dépasse les limites du chat ; revoir la comparaison dans l’application." : "Les sources ou leurs lectures ont changé ou ne permettent plus de vérifier ce choix : nouvelle revue nécessaire."} Ce choix concerne uniquement cette paire de PDF. Il ne prouve ni la mise à jour des offres retenues, ni la validation du plan, ni son exécution. Des modifications locales non synchronisées peuvent ne pas être visibles.`
        : status === "NO_DECISION"
          ? "Aucun choix de référence synchronisé n’est enregistré pour cette paire de PDF. L’ordre de la requête ne désigne pas l’ancien ou le nouveau fichier. Cela ne prouve pas l’absence d’un choix local en attente de synchronisation."
          : status === "LIMIT_EXCEEDED"
            ? "Le choix complet dépasse les limites de lecture du chat. Consulter la comparaison dans l’application."
            : "Au moins un original confirmé est indisponible dans ce magasin. Vérifier l’identité et la synchronisation des PDF.";
    return {
      storeId,
      input,
      status,
      first: first ? side(first) : null,
      second: second ? side(second) : null,
      decision,
      reviewStatus,
      evidence: [
        ...sources.map((s) => ({
          id: `commercial-pdf-source/${createHash("sha256")
            .update(JSON.stringify([storeId, s.documentId, s.checksum]))
            .digest("hex")}`,
          sourceType: "SOURCE_DOCUMENT" as const,
          sourceId: s.documentId,
          sourceVersion: null,
          label: "PDF original",
          value: s.filename,
          factKind: "QUALITY" as const,
        })),
        {
          id: `reference-inspection/${createHash("sha256")
            .update(
              JSON.stringify([
                storeId,
                input,
                status,
                decision,
                reviewStatus,
                sources,
              ]),
            )
            .digest("hex")}`,
          sourceType: "DATA_QUALITY",
          sourceId: chosenId ?? first?.source._id ?? input.firstDocumentId,
          sourceVersion: decision?.version ?? null,
          label: "Choix de référence synchronisé",
          value: summary,
          factKind: "QUALITY",
        },
      ],
    };
  };
  let result = build();
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 14000) {
    status = "LIMIT_EXCEEDED";
    decision = null;
    reviewStatus = null;
    result = build();
    // Oversized stored source metadata cannot be emitted as a supposedly complete result.
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > 14000)
      throw Error("REFERENCE_INSPECTION_LIMIT");
  }
  return validateReferenceInspectionResult(storeId, input, result);
}
