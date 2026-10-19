import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db, ClientSession } from "mongodb";
import {
  copilotFactTraceSchema,
  factReadSchema,
  factReadSnapshotSchema,
  copilotMessageSchema,
  recommendationContextInputSchema,
  recommendationContextResultSchema,
  recommendationTrackingPreviewSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { readLatestDepartmentEvidence } from "./daily-evidence";
import { readDailyAnalysis } from "./daily-analysis-tool";
import { readPeriodAnalysis } from "./period-analysis-tool";
import { readProductAnalysis } from "./product-analysis-tool";
import { readProductSearch } from "./product-search-tool";
import { readFieldEvents } from "./field-events-tool";
import { readCommercialPlan } from "./commercial-plan-tool";
import {
  readRecommendationTracking,
  recommendationSourceDigest,
} from "./recommendation-tracking-tool";
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export const factDigest = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
/** Receives only validated, budget-accepted server read results, never model-authored trace metadata. */
export function factReadFromTool(key: string, result: unknown) {
  const [kind, input, metric, direction] = z
    .array(z.unknown())
    .parse(JSON.parse(key));
  const read =
    kind === "period"
      ? {
          kind: "PERIOD",
          input: {
            ...(input as object),
            metrics: (
              result as { coverage: Array<{ metric: string }> }
            ).coverage.map((c) => c.metric),
          },
        }
      : kind === "daily"
        ? { kind: "DAILY", input: { businessDate: input } }
        : kind === "products"
          ? {
              kind: "PRODUCT_CHANGES",
              input: { businessDate: input, metric, direction },
            }
          : kind === "events"
            ? { kind: "EVENTS", input }
            : kind === "commercial-plan"
              ? { kind: "PLAN", input }
              : kind === "product-search"
                ? { kind: "PRODUCT_SEARCH", input }
                : null;
  return read
    ? factReadSnapshotSchema.parse({ read, digest: factDigest(result) })
    : null;
}
const contextSchema = z.strictObject({
  _id: z.uuid(),
  storeId: z.uuid(),
  ownerId: z.uuid(),
  conversationId: z.uuid(),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
  schemaVersion: z.literal(1),
  complete: z.boolean(),
  reads: z.array(factReadSnapshotSchema).min(1).max(5),
});
type ContextDocument = z.infer<typeof contextSchema>;
/** Server-only immutable provenance alongside an owned reply; no operational sync entity. */
export async function appendFactContext(
  db: Db,
  session: ClientSession,
  raw: CopilotMessage,
  rawTrace: unknown,
  latest: unknown[],
  hasOtherContext: boolean,
) {
  if (!session.inTransaction())
    throw Error("COPILOT_FACT_CONTEXT_TRANSACTION_REQUIRED");
  const m = copilotMessageSchema.parse(raw),
    trace = copilotFactTraceSchema.parse(rawTrace);
  if (m.role !== "ASSISTANT")
    throw Error("COPILOT_FACT_CONTEXT_SOURCE_INVALID");
  const record = contextSchema.parse({
    _id: m.id,
    storeId: m.storeId,
    ownerId: m.ownerId,
    conversationId: m.conversationId,
    sourceDigest: recommendationSourceDigest(m),
    createdAt: m.createdAt,
    schemaVersion: 1,
    complete:
      trace.complete &&
      !hasOtherContext &&
      (latest.length > 0 || trace.reads.length > 0),
    reads: [
      { read: { kind: "LATEST", input: null }, digest: factDigest(latest) },
      ...trace.reads,
    ],
  });
  const collection = db.collection<ContextDocument>("copilotFactContexts");
  const old = await collection.findOne({ _id: m.id }, { session });
  if (old) {
    if (factDigest(contextSchema.parse(old)) !== factDigest(record))
      throw Error("COPILOT_FACT_CONTEXT_IDENTITY_CONFLICT");
    return;
  }
  // Parent reply is inserted by the canonical producer in this same transaction.
  const parent = await db
    .collection<CopilotMessage & { _id: string }>("copilotMessages")
    .findOne(
      { _id: m.id, storeId: m.storeId, ownerId: m.ownerId },
      { session },
    );
  if (
    !parent ||
    recommendationSourceDigest(
      (({ _id, ...p }) => {
        void _id;
        return p;
      })(parent),
    ) !== record.sourceDigest
  )
    throw Error("COPILOT_FACT_CONTEXT_SOURCE_INVALID");
  await collection.insertOne(record, { session });
}
async function replay(
  db: Db,
  storeId: string,
  read: z.infer<typeof factReadSchema>,
) {
  switch (read.kind) {
    case "LATEST":
      return readLatestDepartmentEvidence(db, storeId);
    case "DAILY":
      return readDailyAnalysis(db, storeId, read.input);
    case "PERIOD":
      return readPeriodAnalysis(db, storeId, read.input);
    case "PRODUCT_CHANGES":
      return readProductAnalysis(db, storeId, read.input);
    case "PRODUCT_SEARCH":
      return readProductSearch(db, storeId, read.input);
    case "EVENTS":
      return readFieldEvents(db, storeId, read.input);
    case "PLAN":
      return readCommercialPlan(db, storeId, read.input);
  }
}
export async function readRecommendationContext(
  db: Db,
  scope: { storeId: string; ownerId: string; conversationId: string },
  raw: unknown,
  now = new Date().toISOString(),
) {
  const input = recommendationContextInputSchema.parse(raw);
  z.string().datetime().parse(now);
  const source = await readRecommendationTracking(db, scope, input);
  const row = source.basis
    ? await db.collection<ContextDocument>("copilotFactContexts").findOne(
        {
          _id: input.sourceMessageId,
          storeId: scope.storeId,
          ownerId: scope.ownerId,
          conversationId: scope.conversationId,
        },
        { maxTimeMS: 2000 },
      )
    : null;
  const context = row ? contextSchema.parse(row) : null;
  if (
    context &&
    (context._id !== input.sourceMessageId ||
      context.storeId !== scope.storeId ||
      context.ownerId !== scope.ownerId ||
      context.conversationId !== scope.conversationId ||
      context.sourceDigest !== source.basis?.sourceDigest)
  )
    throw Error("COPILOT_FACT_CONTEXT_SCOPE_INVALID");
  const checks = context
    ? await Promise.allSettled(
        context.reads.map(async (snapshot) => ({
          kind: snapshot.read.kind,
          changed:
            factDigest(await replay(db, scope.storeId, snapshot.read)) !==
            snapshot.digest,
        })),
      )
    : [];
  const changed = [
    ...new Set(
      checks.flatMap((c) =>
        c.status === "fulfilled" && c.value.changed ? [c.value.kind] : [],
      ),
    ),
  ];
  const checkedCount = checks.filter((c) => c.status === "fulfilled").length,
    unavailableCount = checks.length - checkedCount;
  const status =
    source.status !== "READY"
      ? "SOURCE_UNAVAILABLE"
      : changed.length
        ? "STALE"
        : !context || !context.complete || unavailableCount
          ? "UNVERIFIABLE"
          : "UNCHANGED";
  // Mask/archive or source drift during replay invalidates the whole read, without leaking cached advice.
  if (
    JSON.stringify(source) !==
    JSON.stringify(await readRecommendationTracking(db, scope, input))
  )
    throw Error("COPILOT_FACT_CONTEXT_CHANGED");
  const labels = {
    UNCHANGED: "Lectures métier inchangées",
    STALE: "À recalculer",
    UNVERIFIABLE: "Vérification incomplète",
    SOURCE_UNAVAILABLE: "Conseil d’origine indisponible",
  };
  const kinds = {
    LATEST: "derniers chiffres du rayon",
    DAILY: "chiffres quotidiens",
    PERIOD: "chiffres sur la période",
    PRODUCT_CHANGES: "évolutions produit",
    PRODUCT_SEARCH: "recherche catalogue",
    EVENTS: "signalements",
    PLAN: "plan et déclarations commerciales",
  };
  return recommendationContextResultSchema.parse({
    input,
    status,
    checkedAt: now,
    reads:
      context?.reads.map((s, i) => ({
        read: s.read,
        status:
          checks[i]?.status !== "fulfilled"
            ? "UNAVAILABLE"
            : checks[i].value.changed
              ? "CHANGED"
              : "UNCHANGED",
      })) ?? [],
    changed,
    checkedCount,
    unavailableCount,
    evidence: [
      {
        id: `recommendation-context/${factDigest([scope, input, now, status, checks.map((c) => (c.status === "fulfilled" ? c.value : "unavailable"))])}`,
        sourceType: "DATA_QUALITY",
        sourceId: input.sourceMessageId,
        sourceVersion: null,
        label: labels[status],
        factKind: "QUALITY",
        value: `${labels[status]}. Vérifié au ${now}. ${checkedCount} lectures vérifiées ; ${unavailableCount} indisponibles.${changed.length ? ` Sources modifiées : ${changed.map((k) => kinds[k]).join(", ")}. Reprendre les chiffres actuels avant de réutiliser ce conseil.` : ""} ${!context || !context.complete ? "L’empreinte complète des lectures n’est pas disponible : anciennes réponses, autres outils ou documents/contexte non couverts restent non vérifiés." : ""} Cette vérification porte sur les lectures de la réponse entière, pas une preuve de pertinence actuelle de chaque phrase. Une source inchangée ne valide ni hypothèse utilisateur, ni condition terrain, ni causalité, ni éligibilité opérationnelle. Aucun choix, réalisation, historique ou chiffre n’est remplacé. Une correction ou un retrait de données ne signifie pas activité nulle.`,
      },
    ],
  });
}

/** New follow-up proposals recheck recorded facts; old saved/offline choices remain historical intent. */
export async function readTrackingWithFactContext(
  db: Db,
  scope: { storeId: string; ownerId: string; conversationId: string },
  raw: unknown,
) {
  const preview = await readRecommendationTracking(db, scope, raw);
  if (preview.status !== "READY") return preview;
  const context = await readRecommendationContext(db, scope, raw);
  if (context.status === "STALE")
    return recommendationTrackingPreviewSchema.parse({
      input: preview.input,
      status: "STALE",
      basis: null,
      evidence: context.evidence,
    });
  if (context.status === "SOURCE_UNAVAILABLE")
    return recommendationTrackingPreviewSchema.parse({
      input: preview.input,
      status: "SOURCE_UNAVAILABLE",
      basis: null,
      evidence: context.evidence,
    });
  return recommendationTrackingPreviewSchema.parse({
    ...preview,
    evidence: preview.evidence.map((e) => ({
      ...e,
      value: `${e.value} ${context.status === "UNCHANGED" ? "Lectures enregistrées inchangées ; la pertinence terrain reste à vérifier." : "Vérification des lectures incomplète ; ce suivi conserve une intention historique, pas une validation actuelle."}`,
    })),
  });
}
