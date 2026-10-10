import { commercialExecutionPlanChecksum } from "@fl-copilot/commercial-core";
import type { StoreProductEventDocument } from "../store-product-event-sync";
import { createHash, randomUUID } from "node:crypto";
import { Decimal128 } from "mongodb";
import {
  storeProductEventSchema,
  productSubstitutionSchema,
  commercialWeekPlanSchema,
  commercialExecutionTaskSchema,
  substitutionEvidenceSchema,
} from "@fl-copilot/domain";
import {
  buildDailySubstitutionEvidence,
  evidenceWindow,
  referenceDateCandidates,
  type EvidenceSales,
  type EvidenceParent,
  type EvidenceContext,
} from "@fl-copilot/substitution-core";
import type { DatabaseService } from "../database/types";
import type { MongoCommandMutationContext } from "../sync/processed-command-service";
import { createMongoSyncChangeService } from "../sync/sync-change-service";
import {
  writeEvidenceState,
  type EvidenceWork,
} from "../substitution-evidence-work";
import { evidenceCachedContext, type EvidenceCache } from "./context";
import { type SubstitutionEvidenceDocument } from "../substitution-evidence-sync";
const digest = async (s: string) =>
  createHash("sha256").update(s).digest("hex");
type SalesDoc = {
  _id: string;
  storeId: string;
  productId: string;
  date: string;
  salesValue: Decimal128 | null;
  sourceRecordId: string;
  version: number;
  updatedAt: Date;
};
type ParentDoc = {
  _id: string;
  storeId: string;
  status: string;
  deletedAt?: Date | null;
};
const parent = (p: ParentDoc | undefined): EvidenceParent | undefined =>
  p
    ? {
        id: p._id,
        storeId: p.storeId,
        status: p.status,
        deletedAt: p.deletedAt?.toISOString() ?? null,
      }
    : undefined;
export function createSubstitutionEvidenceProcessor(
  database: DatabaseService,
  now: () => Date = () => new Date(),
) {
  return {
    async due(limit = 10) {
      const db = await database.getDb();
      return db
        .collection<EvidenceWork>("substitutionEvidenceWork")
        .find({
          nextAttemptAt: { $lte: now() },
          $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now() } }],
        })
        .sort({ nextAttemptAt: 1, _id: 1 })
        .limit(limit)
        .project<{ eventId: string; storeId: string }>({
          eventId: 1,
          storeId: 1,
          _id: 0,
        })
        .toArray();
    },
    async process(storeId: string, eventId: string) {
      const db = await database.getDb(),
        leaseId = randomUUID(),
        at = now();
      const work = await db
        .collection<EvidenceWork>("substitutionEvidenceWork")
        .findOneAndUpdate(
          {
            _id: eventId,
            storeId,
            nextAttemptAt: { $lte: at },
            $or: [{ leaseUntil: null }, { leaseUntil: { $lte: at } }],
          },
          { $set: { leaseId, leaseUntil: new Date(at.getTime() + 240000) } },
          { returnDocument: "after" },
        );
      if (!work) return { status: "NOT_DUE" };
      const session = db.client.startSession();
      let result: { status: string; count?: number } = { status: "SUPERSEDED" };
      try {
        await session.withTransaction(
          async () => {
            result = { status: "SUPERSEDED" };
            const ctx: MongoCommandMutationContext = { database: db, session },
              current = await db
                .collection<EvidenceWork>("substitutionEvidenceWork")
                .findOne({ _id: eventId, storeId, leaseId }, { session });
            if (!current || current.generation !== work.generation) return;
            const rawEvent = await db
              .collection<StoreProductEventDocument>("storeProductEvents")
              .findOne({ _id: eventId, storeId }, { session });
            if (!rawEvent) throw Error("SUBSTITUTION_EVENT_MISSING");
            const { _id, ...eventData } = rawEvent;
            void _id;
            const event = storeProductEventSchema.parse(eventData);
            const rawRelations = await db
              .collection("productSubstitutions")
              .find({ storeId, sourceProductId: event.productId }, { session })
              .sort({ _id: 1 })
              .toArray();
            if (rawRelations.length > 500)
              throw Error("SUBSTITUTION_INPUT_LIMIT");
            const relations = rawRelations.map((raw) => {
              const { _id, ...value } = raw;
              void _id;
              return productSubstitutionSchema.parse(value);
            });
            const relatedIds = [
                ...new Set([
                  event.productId,
                  ...relations.map((r) => r.substituteProductId),
                ]),
              ],
              needIds = relations.map((r) => r.needUnitId),
              window = evidenceWindow(event),
              dates = window.dates.slice(0, 93),
              references = referenceDateCandidates(dates),
              allDates = [...new Set([...dates, ...references])].sort();
            const sourceEventsFilter = {
              storeId,
              productId: { $in: relatedIds },
              ...(window.end ? { startedAt: { $lt: window.end } } : {}),
            };
            const [
              parents,
              needs,
              sales,
              eventsRaw,
              plansRaw,
              tasksRaw,
              caches,
              settings,
            ] = await Promise.all([
              db
                .collection<ParentDoc>("products")
                .find({ storeId, _id: { $in: relatedIds } }, { session })
                .toArray(),
              db
                .collection<ParentDoc>("needUnits")
                .find({ storeId, _id: { $in: needIds } }, { session })
                .toArray(),
              allDates.length
                ? db
                    .collection<SalesDoc>("salesObservations")
                    .find(
                      {
                        storeId,
                        productId: { $in: relatedIds },
                        date: { $in: allDates },
                        validationStatus: "VALIDATED",
                        deletedAt: null,
                      },
                      { session },
                    )
                    .sort({ _id: 1 })
                    .limit(20001)
                    .toArray()
                : Promise.resolve([] as SalesDoc[]),
              db
                .collection<StoreProductEventDocument>("storeProductEvents")
                .find(sourceEventsFilter, { session })
                .sort({ _id: 1 })
                .limit(1001)
                .toArray(),
              db
                .collection("commercialWeekPlans")
                .find({ storeId }, { session })
                .sort({ _id: 1 })
                .limit(501)
                .toArray(),
              db
                .collection("commercialExecutionTasks")
                .find(
                  { storeId, status: "DONE", kind: "INSTALL_TG" },
                  { session },
                )
                .limit(1001)
                .toArray(),
              db
                .collection<EvidenceCache>("contextProviderCache")
                .find(
                  {
                    validUntil: { $gte: at.toISOString() },
                    url: /^https:\/\/(?:calendrier\.api\.gouv\.fr\/jours-feries\/metropole\/|data\.education\.gouv\.fr\/api\/explore\/v2\.1\/catalog\/datasets\/fr-en-calendrier-scolaire\/records)/,
                  },
                  { session },
                )
                .limit(1001)
                .toArray(),
              db
                .collection("storeContextSettings")
                .findOne({ storeId }, { session }),
            ]);
            if (
              sales.length > 20000 ||
              eventsRaw.length > 1000 ||
              plansRaw.length > 500 ||
              tasksRaw.length > 1000 ||
              caches.length > 1000
            )
              throw Error("SUBSTITUTION_INPUT_LIMIT");
            const rows: EvidenceSales[] = sales.map((s) => ({
              id: s._id,
              storeId: s.storeId,
              productId: s.productId,
              date: s.date,
              salesValue: s.salesValue?.toString() ?? null,
              sourceRecordId: s.sourceRecordId,
              version: s.version,
              updatedAt: s.updatedAt.toISOString(),
            }));
            const events = eventsRaw.map((raw) => {
              const { _id, ...value } = raw;
              void _id;
              return storeProductEventSchema.parse(value);
            });
            const operations: EvidenceContext["operations"] = [];
            for (const raw of plansRaw) {
              const { _id, ...value } = raw;
              void _id;
              const plan = commercialWeekPlanSchema.parse(value);
              const checksum = await commercialExecutionPlanChecksum(
                plan,
                digest,
              );
              const tasks = tasksRaw
                .map((raw) => {
                  const { _id, ...value } = raw;
                  void _id;
                  return commercialExecutionTaskSchema.parse(value);
                })
                .filter(
                  (t) =>
                    t.planId === plan.id &&
                    t.planRevisionId === plan.revisionId &&
                    t.planVersion === plan.version &&
                    t.planChecksum === checksum,
                );
              for (const operation of plan.operations) {
                const productIds = plan.offers
                  .filter((o) => o.operationId === operation.id)
                  .map((o) => o.productId);
                operations.push({
                  id: operation.id,
                  productIds,
                  start: operation.plannedStart,
                  end: operation.plannedEnd,
                  state: tasks.some((t) =>
                    plan.preparation.placements.some(
                      (p) =>
                        p.id === t.targetId &&
                        p.offerIds.some((choiceId) =>
                          plan.offers.some(
                            (o) =>
                              o.choiceId === choiceId &&
                              o.operationId === operation.id,
                          ),
                        ),
                    ),
                  )
                    ? "DECLARED_TASK_DONE"
                    : "PLANNED",
                });
              }
            }
            const configuration = settings
              ? (({ _id, ...v }) => {
                  void _id;
                  return v;
                })(settings)
              : undefined;
            const context: EvidenceContext = {
                operations,
                ...evidenceCachedContext(
                  caches,
                  configuration,
                  allDates,
                  at.toISOString(),
                ),
              },
              ids: string[] = [],
              statuses: string[] = [];
            for (const relation of relations) {
              const built = await buildDailySubstitutionEvidence({
                event,
                relation,
                source: parent(parents.find((p) => p._id === event.productId)),
                candidate: parent(
                  parents.find((p) => p._id === relation.substituteProductId),
                ),
                need: parent(needs.find((p) => p._id === relation.needUnitId)),
                events,
                sales: rows,
                context,
                now: at.toISOString(),
                digest,
              });
              const old = await db
                .collection<SubstitutionEvidenceDocument>(
                  "substitutionEvidence",
                )
                .findOne({ _id: built.id, storeId }, { session });
              ids.push(built.id);
              statuses.push(built.status);
              if (old?.inputRevision === built.inputRevision) continue;
              const evidence = substitutionEvidenceSchema.parse({
                ...built,
                version: (old?.version ?? 0) + 1,
                createdAt: old?.createdAt ?? built.createdAt,
              });
              await db
                .collection<SubstitutionEvidenceDocument>(
                  "substitutionEvidence",
                )
                .replaceOne({ _id: evidence.id, storeId }, evidence, {
                  upsert: true,
                  session,
                });
              await db.collection("substitutionEvidenceHistory").insertOne(
                {
                  storeId,
                  evidenceId: evidence.id,
                  version: evidence.version,
                  inputRevision: evidence.inputRevision,
                  evidence,
                },
                { session },
              );
              await createMongoSyncChangeService().append(ctx, {
                storeId,
                entityType: "substitution_evidence",
                entityId: evidence.id,
                entityVersion: evidence.version,
                operation: "UPSERT",
              });
            }
            await writeEvidenceState(ctx, {
              id: eventId,
              eventId,
              storeId,
              status: !relations.length
                ? "NO_RELATIONS"
                : statuses.includes("READY")
                  ? "READY"
                  : "WAITING",
              reasons: [...new Set(statuses)].sort(),
              evidenceIds: ids.sort(),
              updatedAt: at.toISOString(),
            });
            await db
              .collection<EvidenceWork>("substitutionEvidenceWork")
              .updateOne(
                { _id: eventId, storeId, leaseId, generation: work.generation },
                {
                  $set: {
                    processedGeneration: work.generation,
                    nextAttemptAt: new Date(at.getTime() + 900000),
                    leaseId: null,
                    leaseUntil: null,
                    lastError: null,
                  },
                },
                { session },
              );
            result = { status: "COMPUTED", count: ids.length };
          },
          {
            readConcern: { level: "snapshot" },
            writeConcern: { w: "majority" },
          },
        );
        return result;
      } catch (error) {
        await session.withTransaction(async () => {
          const ctx = { database: db, session };
          const owns = await db
            .collection<EvidenceWork>("substitutionEvidenceWork")
            .findOne({ _id: eventId, storeId, leaseId }, { session });
          if (!owns) return;
          await writeEvidenceState(ctx, {
            id: eventId,
            eventId,
            storeId,
            status: "ERROR",
            reasons: [
              error instanceof Error &&
              error.message === "SUBSTITUTION_INPUT_LIMIT"
                ? "INPUT_LIMIT"
                : "PROCESSING_UNAVAILABLE",
            ],
            evidenceIds: [],
            updatedAt: at.toISOString(),
          });
          await db
            .collection<EvidenceWork>("substitutionEvidenceWork")
            .updateOne(
              { _id: eventId, storeId, leaseId },
              {
                $set: {
                  leaseId: null,
                  leaseUntil: null,
                  nextAttemptAt: new Date(at.getTime() + 900000),
                  lastError: "PROCESSING_UNAVAILABLE",
                },
              },
              { session },
            );
        });
        throw error;
      } finally {
        await session.endSession();
        await db
          .collection<EvidenceWork>("substitutionEvidenceWork")
          .updateOne(
            { _id: eventId, storeId, leaseId },
            { $set: { leaseId: null, leaseUntil: null } },
          );
      }
    },
  };
}
