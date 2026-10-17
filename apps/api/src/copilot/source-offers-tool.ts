import { createHash } from "node:crypto";
import type { Db, Document } from "mongodb";
import {
  copilotSourceOffersInputSchema,
  copilotSourceOffersResultSchema,
  validateSourceOffersResult,
  COMMERCIAL_VISUAL_SCHEMA_VERSION,
} from "@fl-copilot/domain";
import { synchronizedCommercialVisualReadingSchema } from "@fl-copilot/sync-contracts";
import {
  currentCommercialWeek,
  commercialEntryWeekStatus,
  commercialItemWeekStatus,
  commercialOfferProposal,
} from "@fl-copilot/commercial-core";
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
/** Inspect exact immutable source coordinates; extraction is neither retention nor validation. */
export async function readSourceOffers(db: Db, storeId: string, raw: unknown) {
  const input = copilotSourceOffersInputSchema.parse(raw),
    week = currentCommercialWeek(new Date(`${input.businessDate}T12:00:00Z`));
  const source = await db
    .collection<{ _id: string; storeId: string; checksum: string }>(
      "sourceDocuments",
    )
    .findOne(
      {
        _id: input.sourceDocumentId,
        storeId,
        sourceType: "WEEKLY_COMMERCIAL_PDF",
        remoteUploadStatus: "CONFIRMED",
        deletedAt: null,
      },
      { maxTimeMS: 2000 },
    );
  const row = source
    ? await db
        .collection<Document & { _id: string }>("commercialVisualReadings")
        .find({
          storeId,
          sourceDocumentId: source._id,
          checksum: source.checksum,
          pageNumber: input.pageNumber,
          schemaVersion: COMMERCIAL_VISUAL_SCHEMA_VERSION,
          status: "READY",
        })
        .sort({ updatedAt: -1, _id: -1 })
        .maxTimeMS(2000)
        .limit(1)
        .next()
    : null;
  const page = row
    ? synchronizedCommercialVisualReadingSchema.parse(row)
    : null;
  if (
    page &&
    (page.id !== row!._id ||
      page.storeId !== storeId ||
      page.sourceDocumentId !== input.sourceDocumentId ||
      page.checksum !== source!.checksum ||
      page.pageNumber !== input.pageNumber)
  )
    throw Error("SOURCE_OFFERS_SCOPE_INVALID");
  const offers: ReturnType<
    typeof copilotSourceOffersResultSchema.parse
  >["offers"] = [];
  let excludedOffers = 0,
    unknownOffers = 0;
  page?.reading?.operations.forEach((operation, operationIndex) => {
    const operationStatus = commercialEntryWeekStatus(operation, week);
    operation.items.forEach((item, itemIndex) => {
      if (item.kind !== "OFFER") return;
      const itemStatus = commercialItemWeekStatus(item, operation, week);
      if (operationStatus === "UNKNOWN" || itemStatus === "UNKNOWN") {
        unknownOffers++;
        return;
      }
      if (operationStatus !== "CURRENT" || itemStatus !== "CURRENT") {
        excludedOffers++;
        return;
      }
      const proposal = commercialOfferProposal(operation, item);
      offers.push({
        source: {
          sourceDocumentId: input.sourceDocumentId,
          readingId: page.id,
          checksum: page.checksum,
          operationIndex,
          itemIndex,
        },
        pageNumber: page.pageNumber,
        operationKind: operation.kind,
        operationLabel: operation.label,
        rawProductLabel: item.label,
        operationFields: operation.fields,
        itemFields: item.fields,
        operationEvidence: operation.evidence,
        itemEvidence: item.evidence,
        proposal: {
          saleStart: proposal.saleStart || null,
          saleEnd: proposal.saleEnd || null,
          mechanism: proposal.mechanism,
        },
        validationStatus: "TO_VALIDATE",
      });
    });
  });
  const available = !!page?.reading;
  const base = {
    storeId,
    input,
    week,
    status: !source
      ? ("UNAVAILABLE" as const)
      : !available
        ? ("NOT_READY" as const)
        : ("READY" as const),
    readingId: available ? page!.id : null,
    checksum: available ? page!.checksum : null,
    pageCount: page?.pageCount ?? null,
    totalOffers: offers.length,
    excludedOffers,
    unknownOffers,
    warnings: page?.reading?.warnings ?? [],
    warningCount: page?.reading?.warnings.length ?? 0,
    warningsComplete: true,
  };
  let selected = offers.slice(input.offset, input.offset + input.limit),
    limited = false;
  const build = () => {
    const nextOffset =
      input.offset + selected.length < offers.length
        ? input.offset + selected.length
        : null;
    const quality = {
      id: `source-offers-quality/${hash([storeId, input, page?.id, selected.map((o) => o.source), limited])}`,
      sourceType: "DATA_QUALITY" as const,
      sourceId: input.sourceDocumentId,
      sourceVersion: page?.remoteVersion ?? null,
      label: "Offres sources à confirmer",
      value: !source
        ? "Document confirmé indisponible dans ce magasin."
        : !available
          ? "Lecture visuelle indisponible ; ce n’est pas la preuve d’une page sans offres."
          : `Page ${input.pageNumber} : ${selected.length} offre(s) sur ${offers.length} pour la semaine du ${week.start} au ${week.end}. ${excludedOffers} hors période, ${unknownOffers} de période indéterminée. Extraction non validée ; aucune offre retenue ni produit associé. ${limited ? "Lecture trop volumineuse : ouvrir la source, sans ignorer l’offre bloquante ou les avertissements non retournés." : ""}`,
      factKind: "QUALITY" as const,
    };
    const evidence = [
      quality,
      ...selected.map((o) => ({
        id: `source-offer/${hash([storeId, o])}`,
        sourceType: "SOURCE_DOCUMENT" as const,
        sourceId: input.sourceDocumentId,
        sourceVersion: page!.remoteVersion,
        label: `Offre extraite à confirmer — page ${input.pageNumber} — ${o.rawProductLabel}`,
        value: JSON.stringify({
          operation: o.operationLabel,
          fields: [...o.operationFields, ...o.itemFields],
          proposal: o.proposal,
        }),
        factKind: "SOURCE_INSTRUCTION" as const,
      })),
    ];
    return {
      ...base,
      status: limited ? ("LIMIT_EXCEEDED" as const) : base.status,
      offers: selected,
      nextOffset,
      evidence,
    };
  };
  while (
    selected.length &&
    (Buffer.byteLength(JSON.stringify(build()), "utf8") > 14000 ||
      build().evidence.some((e) => e.value.length > 10000))
  ) {
    selected = selected.slice(0, -1);
    limited = true;
  }
  if (Buffer.byteLength(JSON.stringify(build()), "utf8") > 14000) {
    base.warnings = [];
    base.warningsComplete = false;
    limited = true;
  }
  return validateSourceOffersResult(storeId, input, build());
}
