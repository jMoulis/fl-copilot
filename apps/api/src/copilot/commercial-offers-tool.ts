import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "mongodb";
import {
  copilotOffersReadInputSchema,
  copilotOffersReadResultSchema,
  commercialValidatedOfferSchema,
  copilotEvidenceSchema,
} from "@fl-copilot/domain";
import {
  commercialOfferValidationCurrent,
  commercialMechanismDescription,
} from "@fl-copilot/commercial-core";
import {
  serializeCommercialChoice,
  type OfferChoiceDocument,
} from "../commercial/offer-choice-sync.js";

export type CommercialOffersResult = z.infer<
  typeof copilotOffersReadResultSchema
>;
/** Read retained store choices, not every PDF instruction and never execution. */
export async function readCommercialOffers(
  db: Db,
  storeId: string,
  raw: unknown,
): Promise<CommercialOffersResult> {
  z.string().uuid().parse(storeId);
  const input = copilotOffersReadInputSchema.parse(raw);
  const rows = await db
    .collection<OfferChoiceDocument>("commercialOfferChoices")
    .find({
      storeId,
      status: "RETAINED",
      saleStart: { $lte: input.end },
      saleEnd: { $gte: input.start },
      ...(input.afterId ? { _id: { $gt: input.afterId } } : {}),
    })
    .sort({ _id: 1 })
    .maxTimeMS(2000)
    .limit(input.limit + 1)
    .toArray();
  const choices = rows.map((row) => {
    const c = serializeCommercialChoice(row);
    if (
      row._id !== c.id ||
      c.storeId !== storeId ||
      c.status !== "RETAINED" ||
      c.saleStart > input.end ||
      c.saleEnd < input.start ||
      (input.afterId && c.id <= input.afterId)
    )
      throw Error("COPILOT_OFFERS_SCOPE_INVALID");
    return c;
  });
  const hasMore = choices.length > input.limit;
  const page = choices.slice(0, input.limit);
  const validations = page.length
    ? await db
        .collection<{ _id: string; storeId: string; choice: { id: string } }>(
          "commercialValidatedOffers",
        )
        .find({
          storeId,
          $or: page.map((c) => ({
            "choice.id": c.id,
            "choice.version": c.version,
          })),
        })
        .maxTimeMS(2000)
        .limit(page.length + 1)
        .toArray()
    : [];
  if (validations.length > page.length)
    throw Error("COPILOT_OFFERS_VALIDATION_INVALID");
  const byChoice = new Map<
    string,
    z.infer<typeof commercialValidatedOfferSchema>
  >();
  for (const row of validations) {
    const { _id, ...data } = row;
    const v = commercialValidatedOfferSchema.parse(data);
    if (
      _id !== v.id ||
      v.storeId !== storeId ||
      !page.some(
        (c) => c.id === v.choice.id && c.version === v.choice.version,
      ) ||
      byChoice.has(v.choice.id)
    )
      throw Error("COPILOT_OFFERS_VALIDATION_INVALID");
    byChoice.set(v.choice.id, v);
  }
  const offers = page.map((choice) => ({
    choice,
    validationId: (() => {
      const v = byChoice.get(choice.id);
      return v && commercialOfferValidationCurrent(v, choice) ? v.id : null;
    })(),
  }));
  const evidence: CommercialOffersResult["evidence"] = [];
  for (const { choice: c, validationId } of offers) {
    const revision = createHash("sha256")
      .update(JSON.stringify([c, validationId]))
      .digest("hex");
    const add = (kind: "offer" | "validation", label: string, value: string) =>
      evidence.push(
        copilotEvidenceSchema.parse({
          id: JSON.stringify([
            "commercial-choice",
            storeId,
            c.id,
            revision,
            kind,
          ]),
          sourceType:
            kind === "offer" ? "COMMERCIAL_OPERATION" : "DATA_QUALITY",
          sourceId: c.source.sourceDocumentId,
          sourceVersion: c.version,
          label: `${label} — ${c.rawProductLabel} — ${c.operationLabel}`,
          value,
          factKind: kind === "offer" ? "PLANNED" : "QUALITY",
        }),
      );
    const scope =
      c.mechanism.type === "CARD_BENEFIT" && c.mechanism.scope
        ? ` ; portée carte : ${c.mechanism.scope}`
        : "";
    add(
      "offer",
      "Offre retenue",
      `${c.operationKind} ; du ${c.saleStart} au ${c.saleEnd} ; ${commercialMechanismDescription(c.mechanism)}${scope}. Offre retenue par le magasin, mise en place non établie.`,
    );
    add(
      "validation",
      "Validation commerciale",
      validationId
        ? "Cette version de l’offre est validée ; l’exécution reste distincte."
        : "Cette version retenue n’a pas de validation commerciale actuelle ; ne pas la présenter comme validée.",
    );
  }
  const nextAfterId = hasMore ? page.at(-1)!.id : null;
  const identity = createHash("sha256")
    .update(
      JSON.stringify([
        storeId,
        input,
        offers.map((o) => [o.choice.id, o.choice.version, o.validationId]),
        hasMore,
      ]),
    )
    .digest("hex");
  evidence.push(
    copilotEvidenceSchema.parse({
      id: `commercial-coverage/${identity}`,
      sourceType: "DATA_QUALITY",
      sourceId: storeId,
      sourceVersion: null,
      label: `Couverture des offres retenues — ${input.start} au ${input.end}`,
      value: `${offers.length} offres dans cette page${hasMore ? " ; d’autres offres restent à consulter" : " ; fin des offres retenues pour cette période"}. Les instructions PDF non retenues ne sont pas incluses. Aucun statut d’exécution n’est déduit.`,
      factKind: "QUALITY",
    }),
  );
  return copilotOffersReadResultSchema.parse({
    start: input.start,
    end: input.end,
    offers,
    hasMore,
    nextAfterId,
    evidence,
  });
}
