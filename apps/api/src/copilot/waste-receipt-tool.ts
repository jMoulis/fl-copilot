import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db, Document } from "mongodb";
import {
  copilotReceiptInputSchema,
  copilotReceiptResultSchema,
  copilotEvidenceSchema,
} from "@fl-copilot/domain";
import {
  synchronizedWastePublicationSchema,
  wasteReceiptDraftSchema,
} from "@fl-copilot/sync-contracts";
import type { WasteReceiptDraftReader } from "../uploads/waste-receipt-draft.js";
const sourceSchema = z.object({
  _id: z.string().uuid(),
  storeId: z.string().uuid(),
  originalFilename: z.string().min(1).max(240),
  checksum: z.string().min(1),
  createdAt: z.date(),
});
export async function readWasteReceipt(
  db: Db,
  storeId: string,
  raw: unknown,
  reader: WasteReceiptDraftReader,
) {
  z.string().uuid().parse(storeId);
  const input = copilotReceiptInputSchema.parse(raw);
  const row = await db
    .collection<Document & { _id: string }>("sourceDocuments")
    .findOne(
      {
        _id: input.sourceDocumentId,
        storeId,
        sourceType: "WASTE_RECEIPT",
        remoteUploadStatus: "CONFIRMED",
        deletedAt: null,
      } as never,
      { maxTimeMS: 2000 },
    );
  if (!row) throw Error("COPILOT_RECEIPT_UNAVAILABLE");
  const source = sourceSchema.parse(row);
  if (source._id !== input.sourceDocumentId || source.storeId !== storeId)
    throw Error("COPILOT_RECEIPT_SCOPE_INVALID");
  const record = await db
    .collection<Document & { _id: string }>("wasteReceiptPublications")
    .findOne(
      { storeId, "publication.source.id": source._id },
      { maxTimeMS: 2000 },
    );
  let published: z.infer<typeof copilotReceiptResultSchema>["published"] = null,
    extracted: z.infer<typeof copilotReceiptResultSchema>["extracted"] = null,
    lineCount: number | null = null,
    status: z.infer<typeof copilotReceiptResultSchema>["status"] = "NOT_READY";
  if (record) {
    const r = synchronizedWastePublicationSchema.parse(record),
      p = r.publication;
    if (
      record._id !== r.id ||
      r.id !== p.receipt.id ||
      r.storeId !== storeId ||
      p.receipt.storeId !== storeId ||
      p.source.id !== source._id ||
      p.source.checksum !== source.checksum
    )
      throw Error("COPILOT_RECEIPT_SCOPE_INVALID");
    const all = [...p.lines].sort(
        (a, b) => a.sourceLineIndex - b.sourceLineIndex,
      ),
      page = all.slice(input.offset, input.offset + input.limit),
      ids = page
        .map((l) => l.matchedProductId)
        .filter((id): id is string => !!id);
    const products = await db
      .collection<{ _id: string; storeId: string; label: string }>("products")
      .find({ storeId, _id: { $in: ids } })
      .maxTimeMS(2000)
      .limit(10)
      .toArray();
    published = {
      receipt: p.receipt,
      lines: page.map((l) => ({
        ...l,
        productLabel:
          products.find((v) => v._id === l.matchedProductId)?.label ??
          "Produit à identifier",
      })),
      observations: p.observations.filter((o) =>
        page.some((l) => l.id === o.sourceRecordId),
      ),
    };
    lineCount = all.length;
    status = "PUBLISHED";
  } else {
    try {
      const draft = wasteReceiptDraftSchema.parse(
        await reader.read({ storeId, sourceDocumentId: source._id }),
      );
      if (draft.lines.length > 1000) status = "LIMIT_EXCEEDED";
      else {
        const { lines, ...header } = draft;
        if (
          new Set(lines.map((l) => l.sourceLineIndex)).size !== lines.length ||
          new Set(lines.map((l) => l.lineId)).size !== lines.length
        )
          throw Error("COPILOT_RECEIPT_LINE_INVALID");
        extracted = {
          header,
          lines: [...lines]
            .sort((a, b) => a.sourceLineIndex - b.sourceLineIndex)
            .slice(input.offset, input.offset + input.limit),
        };
        lineCount = lines.length;
        status = "EXTRACTED";
      }
    } catch (e) {
      if (!(
        e instanceof Error &&
        [
          "WASTE_RECEIPT_DRAFT_NOT_READY",
          "WASTE_RECEIPT_DRAFT_EVIDENCE_NOT_FOUND",
          "WASTE_RECEIPT_DRAFT_LINE_EVIDENCE_INCOMPLETE",
        ].includes(e.message)
      ))
        throw e;
    }
  }
  const nextOffset =
    lineCount !== null && input.offset + input.limit < lineCount
      ? input.offset + input.limit
      : null;
  const visible = copilotReceiptResultSchema
    .safeExtend({ evidence: z.array(copilotEvidenceSchema).max(12) })
    .parse({
      source: {
        sourceDocumentId: source._id,
        filename: source.originalFilename,
        createdAt: source.createdAt.toISOString(),
      },
      status,
      published,
      extracted,
      lineCount,
      nextOffset,
      evidence: [],
    });
  const revision = createHash("sha256")
    .update(
      JSON.stringify([
        storeId,
        source.checksum,
        input,
        { ...visible, evidence: [] },
      ]),
    )
    .digest("hex");
  const evidence: z.infer<typeof copilotEvidenceSchema>[] = [];
  const fact = (
    key: string,
    label: string,
    value: string,
    kind: "OBSERVED" | "QUALITY",
  ) =>
    copilotEvidenceSchema.parse({
      id: `waste-receipt/${revision}/${key}`,
      sourceType: kind === "OBSERVED" ? "EVENT" : "DATA_QUALITY",
      sourceId: source._id,
      sourceVersion: published?.receipt.version ?? null,
      label,
      value,
      factKind: kind,
    });
  const units = {
    KG: "kg",
    PIECE: "pièce",
    PACK: "unité conditionnée",
    UNKNOWN: "non précisée",
  };
  const natures = {
    BULK: "Vrac",
    PACKAGED: "Conditionné",
    UNKNOWN: "non précisée",
  };
  const arithmetic = {
    NOT_CHECKED: "non vérifié",
    CONSISTENT: "cohérent",
    MISMATCH: "montant à vérifier",
  };
  const matches = {
    AUTO_MATCH: "association automatique",
    REVIEW: "produit à examiner",
    AMBIGUOUS: "association ambiguë",
    NO_MATCH: "aucune association trouvée",
  };
  const states = {
    NOT_READY: "Traitement non prêt",
    EXTRACTED: "Extrait, non publié",
    PUBLISHED: "Publié",
    LIMIT_EXCEEDED: "Limite de lecture dépassée",
  };
  const date = (s: string | null | undefined) =>
    s ? s.split("-").reverse().join("/") : "inconnue";
  for (const l of visible.published?.lines ?? []) {
    const o = visible.published!.observations.find(
      (o) => o.sourceRecordId === l.id,
    );
    evidence.push(
      fact(
        l.id,
        `Casse publiée — ${l.rawLabel}`,
        l.validationStatus === "EXCLUDED"
          ? "Ligne explicitement exclue ; aucune observation de casse publiée pour cette ligne."
          : `Produit confirmé : ${l.productLabel}. Montant du ticket ${o!.salesValue ?? "inconnu"} € en valeur de vente ; quantité comparable ${o!.quantity ?? "inconnue"}, nature ${natures[o!.productNature]}. Mesures source : poids ${l.weight ?? "inconnu"} kg ; quantité ${l.quantity ?? "inconnue"} ; unité ${units[l.quantityUnit ?? "UNKNOWN"]}. Coût d'achat indisponible. Ce montant ne modifie pas le chiffre d'affaires Mercalys.`,
        "OBSERVED",
      ),
    );
  }
  for (const l of visible.extracted?.lines ?? [])
    evidence.push(
      fact(
        l.lineId,
        `Ligne extraite — ${l.rawLabel}`,
        `Brouillon distant non publié. Montant extrait ${l.totalPrice ?? "inconnu"} € ; poids ${l.weight ?? "inconnu"} kg ; quantité ${l.quantity ?? "inconnue"}, unité ${units[l.quantityUnit]}. Contrôle arithmétique ${arithmetic[l.arithmeticStatus]} ; montant attendu ${l.arithmeticExpectedTotal ?? "inconnu"}, écart ${l.arithmeticDifference ?? "inconnu"}. Association ${matches[l.matchState]}, validation ${l.validationStatus === "TO_REVIEW" ? "à examiner" : "en attente"}. L'extraction et l'association automatique ne sont pas une validation humaine. Les corrections locales non publiées ne sont pas connues ici.`,
        "QUALITY",
      ),
    );
  evidence.push(
    fact(
      "state",
      "État du ticket de casse",
      `${states[status]}. Date confirmée ${date(visible.published?.receipt.confirmedWasteDate)} ; date détectée ${date(visible.published?.receipt.detectedReceiptDate ?? visible.extracted?.header.detectedReceiptDate)}. Caissier confirmé ${visible.published?.receipt.confirmedCashierNumber ?? "inconnu"} ; caissier détecté ${visible.published?.receipt.detectedCashierNumber ?? visible.extracted?.header.detectedCashierNumber ?? "inconnu"}. Les codes sont des chaînes conservant leurs zéros. Métadonnées détectées et confirmées restent distinctes ; aucun jugement sur une personne n'est établi.`,
      status === "PUBLISHED" ? "OBSERVED" : "QUALITY",
    ),
  );
  evidence.push(
    fact(
      "coverage",
      "Couverture du ticket",
      `${lineCount === null ? "Nombre de lignes indisponible" : lineCount + " lignes connues"} ; ${visible.published?.lines.length ?? visible.extracted?.lines.length ?? 0} dans cette page${nextOffset !== null ? ", autres pages non consultées" : ""}. Un ticket non prêt n'est pas un ticket vide. Ne pas totaliser une page comme le ticket complet, additionner des unités incompatibles, déduire le coût d'achat ni modifier la publication depuis cette lecture.`,
      "QUALITY",
    ),
  );
  return copilotReceiptResultSchema.parse({ ...visible, evidence });
}
