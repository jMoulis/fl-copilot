import type { Db } from "mongodb";
import { AuthError } from "../auth/service";
/** Call only after store authorization. Never advance an older client's cursor past unreadable data. */
export async function requireCommercialSourceCompatibility(
  db: Db,
  storeId: string,
  supported: boolean,
) {
  if (supported) return;
  const original = await db
    .collection("commercialOfferChoices")
    .findOne(
      { storeId, "source.kind": "PDF_ORIGINAL" },
      { projection: { _id: 1 }, maxTimeMS: 2000 },
    );
  if (original)
    throw new AuthError(
      426,
      "COMMERCIAL_SOURCE_UPGRADE_REQUIRED",
      "Mettez l’application à jour pour synchroniser les offres liées directement aux PDF. Vos données locales sont conservées.",
    );
}

export async function requireCommercialAnalysisCompatibility(
  db: Db,
  storeId: string,
  supported: boolean,
) {
  if (supported) return;
  const restarted = await db
    .collection("commercialDocumentJobs")
    .findOne(
      { storeId, analysisRevision: { $gt: 0 } },
      { projection: { _id: 1 }, maxTimeMS: 2000 },
    );
  if (restarted)
    throw new AuthError(
      426,
      "COMMERCIAL_ANALYSIS_UPGRADE_REQUIRED",
      "Mettez l’application à jour pour synchroniser les nouvelles analyses de PDF. Vos données locales sont conservées.",
    );
}

/** Qualitative plan snapshots cannot be projected into an older client's mandatory-offer model. */
export async function requireQualitativeCommercialPlanCompatibility(
  db: Db,
  storeId: string,
  supported: boolean,
) {
  if (supported) return;
  const qualitative = (prefix: string) => ({
    storeId,
    $or: [
      { [`${prefix}preparation.offerRefs`]: { $size: 0 } },
      {
        [`${prefix}preparation.placements`]: {
          $elemMatch: { offerIds: { $size: 0 } },
        },
      },
    ],
  });
  const results = await Promise.all([
    db
      .collection("commercialWeekPlans")
      .findOne(qualitative(""), { projection: { _id: 1 }, maxTimeMS: 2000 }),
    db.collection("commercialPlanRevisions").findOne(qualitative("plan."), {
      projection: { _id: 1 },
      maxTimeMS: 2000,
    }),
  ]);
  if (results.some(Boolean))
    throw new AuthError(
      426,
      "QUALITATIVE_COMMERCIAL_PLAN_UPGRADE_REQUIRED",
      "Mets l’application à jour pour synchroniser les plans de merchandising. Tes données locales sont conservées.",
    );
}
