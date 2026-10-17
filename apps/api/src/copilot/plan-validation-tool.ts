import { createHash, randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import {
  copilotPlanValidationPreviewSchema,
  copilotPlanReadinessInputSchema,
} from "@fl-copilot/domain";
import { buildCommercialWeekPlan } from "@fl-copilot/commercial-core";
import {
  serializeCommercialPlan,
  type WeekPlanDocument,
} from "../commercial/week-plan-sync";
import { loadCommercialPlanReadiness } from "./plan-readiness-tool";
const digest = async (s: string) =>
  createHash("sha256").update(s).digest("hex");
export async function previewCommercialPlanValidation(
  db: Db,
  storeId: string,
  raw: unknown,
  now: () => string = () => new Date().toISOString(),
) {
  const input = copilotPlanReadinessInputSchema.parse(raw),
    { result, context, preparation } = await loadCommercialPlanReadiness(
      db,
      storeId,
      input,
    );
  let status: ReturnType<
    typeof copilotPlanValidationPreviewSchema.parse
  >["status"] = result.status;
  let preview: ReturnType<
    typeof copilotPlanValidationPreviewSchema.parse
  >["preview"] = null;
  if (status === "READY" && context && preparation) {
    const row = await db
        .collection<WeekPlanDocument>("commercialWeekPlans")
        .findOne({ storeId, weekStart: input.weekStart }, { maxTimeMS: 2000 }),
      before = row ? serializeCommercialPlan(row) : null;
    if (
      before &&
      (row!._id !== before.id ||
        before.storeId !== storeId ||
        before.weekStart !== input.weekStart)
    )
      throw Error("PLAN_VALIDATION_SCOPE");
    const observedAt = now();
    const candidate = await buildCommercialWeekPlan(
      {
        preparation,
        version: (before?.version ?? 0) + 1,
        createdAt: before?.createdAt ?? observedAt,
        validatedAt: observedAt,
      },
      context,
      digest,
    );
    if (
      before &&
      JSON.stringify(
        await buildCommercialWeekPlan(
          {
            preparation,
            version: before.version,
            createdAt: before.createdAt,
            validatedAt: before.validatedAt,
          },
          context,
          digest,
        ),
      ) === JSON.stringify(before)
    )
      status = "UNCHANGED";
    else {
      preview = {
        operationId: randomUUID(),
        schemaVersion: 1,
        tool: "commercial.plan.preview",
        status: "COMPLETED",
        observedAt,
        message:
          "Aperçu du plan à confirmer sur l’appareil. Aucun enregistrement ni exécution.",
        expectedPlanVersion: before?.version ?? null,
        candidate,
        issues: [],
      };
      if (Buffer.byteLength(JSON.stringify(preview), "utf8") > 13000) {
        status = "LIMIT_EXCEEDED";
        preview = null;
      }
    }
  }
  return copilotPlanValidationPreviewSchema.parse({
    storeId,
    input,
    status,
    preview,
    issues: result.issues,
    evidence: [
      {
        id: `plan-validation/${await digest(JSON.stringify([storeId, input, status, preview, result.issues]))}`,
        sourceType: "DATA_QUALITY",
        sourceId: preparation?.id ?? storeId,
        sourceVersion: preparation?.version ?? null,
        label: "Validation du plan hebdomadaire",
        value:
          status === "READY"
            ? "Plan préparé pour revue native des offres et TG. Une confirmation explicite enregistrera une révision locale, sans déclarer de mise en rayon. Rien n’a encore été enregistré."
            : status === "UNCHANGED"
              ? "Ce plan est déjà enregistré avec cette préparation et ces références ; aucune nouvelle révision nécessaire."
              : status === "LIMIT_EXCEEDED"
                ? "La revue complète dépasse la limite du chat. Ouvrir Ma semaine pour valider le plan sans tronquer ses conditions."
                : result.evidence[0]!.value,
        factKind: "QUALITY",
      },
    ],
  });
}
