import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import {
  copilotReferenceInputSchema,
  copilotReferencePreviewSchema,
  referenceDesiredValue,
} from "@fl-copilot/domain";
import {
  compareCommercialDocumentVersions,
  commercialVersionDecisionId,
  commercialVersionDecisionSnapshotsValid,
} from "@fl-copilot/commercial-core";
import { loadCommercialComparisonOriginal } from "./document-comparison-tool";
import {
  serializeCommercialVersionDecision,
  type VersionDecisionDocument,
} from "../commercial/version-decision-sync";
const digest = async (s: string) =>
  createHash("sha256").update(s).digest("hex");
export async function previewCommercialReference(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  const input = copilotReferenceInputSchema.parse(raw),
    [before, after] = await Promise.all([
      loadCommercialComparisonOriginal(db, storeId, input.beforeDocumentId),
      loadCommercialComparisonOriginal(db, storeId, input.afterDocumentId),
    ]);
  type Result = ReturnType<typeof copilotReferencePreviewSchema.parse>;
  let status: Result["status"] = "READY",
    basis: Result["basis"] = null,
    issue: Result["issue"] = null;
  if (!before || !after) status = "UNAVAILABLE";
  else if (before.source.checksum === after.source.checksum) {
    status = "BLOCKED";
    issue = "SAME_BINARY";
  } else if (before.limited || after.limited) status = "LIMIT_EXCEEDED";
  else {
    const comparison = compareCommercialDocumentVersions({
      storeId,
      beforeDocumentId: input.beforeDocumentId,
      afterDocumentId: input.afterDocumentId,
      before: before.pages,
      after: after.pages,
    });
    if (
      !comparison.beforeCoverage.complete ||
      !comparison.afterCoverage.complete
    ) {
      status = "BLOCKED";
      issue = "INCOMPLETE";
    } else {
      const id = await commercialVersionDecisionId(
          storeId,
          input.beforeDocumentId,
          input.afterDocumentId,
          digest,
        ),
        row = await db
          .collection<VersionDecisionDocument>("commercialVersionDecisions")
          .findOne({ _id: id, storeId }, { maxTimeMS: 2000 }),
        previous = row ? serializeCommercialVersionDecision(row) : null;
      if (
        previous &&
        (row!._id !== previous.id || previous.storeId !== storeId)
      )
        throw Error("COMMERCIAL_REFERENCE_SCOPE");
      const source = (s: NonNullable<typeof before>) => ({
        documentId: s.source._id,
        checksum: s.source.checksum,
        readingIds: s.pages.map((p) => p.id).sort(),
      });
      basis = {
        storeId,
        sources: { before: source(before), after: source(after) },
        beforeFilename: before.source.originalFilename,
        afterFilename: after.source.originalFilename,
        counts: comparison.counts as NonNullable<Result["basis"]>["counts"],
        warningCount: [...before.pages, ...after.pages].reduce(
          (n, p) => n + (p.reading?.warnings.length ?? 0),
          0,
        ),
        previous,
      };
      if (
        previous &&
        (previous.before.documentId !== input.beforeDocumentId ||
          previous.after.documentId !== input.afterDocumentId)
      ) {
        status = "BLOCKED";
        issue = "ORIENTATION";
      } else if (
        previous &&
        (JSON.stringify(previous.before) !==
          JSON.stringify(basis.sources.before) ||
          JSON.stringify(previous.after) !==
            JSON.stringify(basis.sources.after))
      ) {
        status = "BLOCKED";
        issue = "SOURCE_CHANGED";
      } else {
        const desired = referenceDesiredValue(input, basis);
        if (
          !commercialVersionDecisionSnapshotsValid(
            { storeId, ...basis.sources },
            [...before.pages, ...after.pages],
          )
        )
          throw Error("COMMERCIAL_REFERENCE_SOURCE");
        if (
          previous &&
          previous.preference === desired.preference &&
          previous.note === desired.note
        )
          status = "UNCHANGED";
        else if (Buffer.byteLength(JSON.stringify(basis), "utf8") > 13000)
          status = "LIMIT_EXCEEDED";
      }
    }
  }
  if (status !== "READY") basis = null;
  const reasons = {
    SAME_BINARY: "Ces deux fichiers ont le même contenu.",
    INCOMPLETE:
      "Les deux lectures doivent être complètes avant de choisir la référence.",
    ORIENTATION:
      "Une décision existe dans l’autre sens ancien/nouveau. Reprendre cette orientation sans l’inverser silencieusement.",
    SOURCE_CHANGED:
      "Les lectures comparées ont changé depuis le choix enregistré. Examiner ce choix dans la comparaison des PDF.",
  };
  return copilotReferencePreviewSchema.parse({
    storeId,
    input,
    status,
    basis,
    issue,
    evidence: [
      {
        id: `commercial-reference/${await digest(JSON.stringify([storeId, input, status, basis, issue]))}`,
        sourceType: "DATA_QUALITY",
        sourceId: before?.source._id ?? storeId,
        sourceVersion: basis?.previous?.version ?? null,
        label: "Choix de référence entre deux PDF",
        value:
          status === "READY"
            ? `Choix préparé : ${input.preference === "KEEP_PREVIOUS" ? "conserver l’ancien PDF" : "préférer le PDF corrigé"}. Les deux lectures sont complètes ; ${basis!.counts.CHANGED} groupes d’offres modifiés et ${basis!.counts.AMBIGUOUS} ambigus, ${basis!.warningCount} avertissements d’extraction. Une revue native de la comparaison et des originaux est requise. Aucun choix n’est encore enregistré ; les offres retenues, TG et plans ne seront pas modifiés automatiquement.`
            : status === "UNCHANGED"
              ? "Ce choix et cette note sont déjà enregistrés. Aucune nouvelle révision."
              : status === "BLOCKED"
                ? reasons[issue!]
                : status === "LIMIT_EXCEEDED"
                  ? "La comparaison complète dépasse les limites du chat. Utiliser l’écran de comparaison des PDF."
                  : "Un PDF confirmé n’est pas disponible dans ce magasin. Vérifier les sources synchronisées.",
        factKind: "QUALITY",
      },
    ],
  });
}
