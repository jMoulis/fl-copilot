import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "mongodb";
import {
  copilotPreparationReadInputSchema,
  copilotPreparationReadResultSchema,
} from "@fl-copilot/domain";
import {
  commercialPreparationOfferIssues,
  commercialMechanismDescription,
} from "@fl-copilot/commercial-core";
import {
  serializeCommercialPreparation,
  type PreparationDocument,
} from "../commercial/week-preparation-sync.js";
import {
  serializeCommercialChoice,
  type OfferChoiceDocument,
} from "../commercial/offer-choice-sync.js";
/** Current synchronized draft and current selected choices, never a plan validation. */
export async function loadCommercialPreparationContext(
  db: Db,
  storeId: string,
  raw: unknown,
  initialChoiceIds?: readonly string[],
  supplementalChoiceIds?: readonly string[],
) {
  z.uuid().parse(storeId);
  const input = copilotPreparationReadInputSchema.parse(raw);
  const initial = initialChoiceIds
    ? z
        .array(z.uuid())
        .max(100)
        .refine((ids) => new Set(ids).size === ids.length)
        .parse(initialChoiceIds)
    : [];
  const row = await db
    .collection<PreparationDocument>("commercialWeekPreparations")
    .findOne({ storeId, weekStart: input.weekStart }, { maxTimeMS: 2000 });
  const preparation = row ? serializeCommercialPreparation(row) : null;
  if (
    preparation &&
    (row!._id !== preparation.id ||
      preparation.storeId !== storeId ||
      preparation.weekStart !== input.weekStart)
  )
    throw Error("COPILOT_PREPARATION_SCOPE_INVALID");
  const refs =
    preparation?.offerRefs ??
    initial.map((choiceId) => ({
      choiceId,
      choiceVersion: 1,
    }));
  const supplemental = supplementalChoiceIds
    ? z
        .array(z.uuid())
        .max(100)
        .refine((ids) => new Set(ids).size === ids.length)
        .parse(supplementalChoiceIds)
    : [];
  const lookupIds = [
    ...new Set([...refs.map((r) => r.choiceId), ...supplemental]),
  ];
  const rows = lookupIds.length
    ? await db
        .collection<OfferChoiceDocument>("commercialOfferChoices")
        .find({ storeId, _id: { $in: lookupIds } })
        .sort({ _id: 1 })
        .maxTimeMS(2000)
        .limit(201)
        .toArray()
    : [];
  const all = rows.map((r) => {
    const c = serializeCommercialChoice(r);
    if (r._id !== c.id || c.storeId !== storeId || !lookupIds.includes(c.id))
      throw Error("COPILOT_PREPARATION_SCOPE_INVALID");
    return c;
  });
  if (all.length > 200 || new Set(all.map((c) => c.id)).size !== all.length)
    throw Error("COPILOT_PREPARATION_LIMIT");
  const issues = preparation
    ? commercialPreparationOfferIssues(preparation, all)
    : [];
  return { input, preparation, refs, all, issues };
}
export async function readCommercialPreparation(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  const { input, preparation, refs, all, issues } =
    await loadCommercialPreparationContext(db, storeId, raw);
  const pageRefs = refs.slice(input.offset, input.offset + input.limit);
  const choices = pageRefs.flatMap((ref) =>
    all.filter((c) => c.id === ref.choiceId),
  );
  const missingChoiceIds = pageRefs
    .filter((ref) => !all.some((c) => c.id === ref.choiceId))
    .map((ref) => ref.choiceId);
  const nextOffset =
    input.offset + pageRefs.length < refs.length
      ? input.offset + pageRefs.length
      : null;
  const hash = createHash("sha256")
    .update(JSON.stringify([storeId, input, preparation, all]))
    .digest("hex");
  type Evidence = z.infer<
    typeof copilotPreparationReadResultSchema
  >["evidence"][number];
  const evidence: Evidence[] = [];
  const add = (
    key: string,
    label: string,
    value: string,
    quality = false,
    sourceId = preparation?.id ?? storeId,
    version = preparation?.version ?? null,
  ) => {
    evidence.push({
      id: `commercial-preparation/${hash}/${key}`,
      sourceType: quality ? "DATA_QUALITY" : "COMMERCIAL_OPERATION",
      sourceId,
      sourceVersion: version,
      label,
      value,
      factKind: quality ? "QUALITY" : "PLANNED",
    });
  };
  add(
    "draft",
    "Préparation commerciale de la semaine",
    preparation
      ? `Brouillon synchronisé du ${preparation.weekStart} au ${preparation.weekEnd}, version ${preparation.version}. Capacité TG déclarée : ${preparation.tgCapacity ?? "inconnue"} ; ${preparation.placements.length} TG préparées et ${refs.length} offres sélectionnées. Note utilisateur : ${preparation.note || "aucune"}. Ce brouillon n'est ni un plan validé, ni une preuve de réalisation en rayon.`
      : "Aucun brouillon synchronisé pour cette semaine. Une préparation locale non synchronisée peut exister. Ce résultat ne signifie pas qu'il n'y a pas d'offres ou de plan validé.",
  );
  for (const [index, p] of (preparation?.placements ?? []).entries()) {
    const labels = p.offerIds.map(
      (id) =>
        all.find((c) => c.id === id)?.rawProductLabel ?? "Offre indisponible",
    );
    add(
      `tg-${index}`,
      p.label,
      `Thème préparé : ${p.theme || "non précisé"}. Offres affectées : ${labels.join(" ; ") || "aucune"}.${p.sourceIdea ? " Idée liée à une extraction PDF ; source non revalidée par cette lecture." : " Aucune idée source PDF liée."} Affectation préparée, installation non établie.`,
    );
  }
  for (const c of choices) {
    const issue = issues.find((i) => i.choiceId === c.id);
    add(
      `choice-${c.id}`,
      `${c.rawProductLabel} — ${c.operationLabel}`,
      `${c.operationKind}, du ${c.saleStart} au ${c.saleEnd} ; ${commercialMechanismDescription(c.mechanism)}${c.mechanism.type === "CARD_BENEFIT" && c.mechanism.scope ? " ; portée carte : " + c.mechanism.scope : ""}. État actuel ${c.status}, version ${c.version}${issue ? "; référence du brouillon à revoir : " + issue.code : "; référence du brouillon actuelle"}. La validation commerciale et les sources ne sont pas contrôlées ici.`,
      false,
      c.source.sourceDocumentId,
      c.version,
    );
  }
  add(
    "quality",
    "Références et couverture de la préparation",
    `${issues.length} références à revoir sur l'ensemble des ${refs.length} offres sélectionnées.${issues.length ? " Détails : " + issues.map((i) => i.choiceId + " : " + i.code).join(" ; ") + "." : ""} ${pageRefs.length} références détaillées dans cette page${nextOffset !== null ? "; autres offres à consulter" : "; fin des références sélectionnées"}. Les offres non sélectionnées se consultent séparément. Les produits, validations, sources PDF et sources de l’implantation ne sont pas revalidés par cette lecture. Consultez la préparation à la validation pour vérifier ces dépendances. Aucun enregistrement ni validation n'a été effectué.`,
    true,
  );
  return copilotPreparationReadResultSchema.parse({
    weekStart: input.weekStart,
    status: preparation ? "DRAFT" : "NO_DRAFT",
    preparation,
    choices,
    issues,
    missingChoiceIds,
    nextOffset,
    evidence,
  });
}
