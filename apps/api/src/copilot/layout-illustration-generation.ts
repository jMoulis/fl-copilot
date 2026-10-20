import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { ClientSession, Db } from "mongodb";
import {
  copilotMessageSchema,
  readStoreLayoutScenarioCard,
  layoutScenarioInput,
  layoutIllustrationGenerationPolicySchema,
  layoutIllustrationQuoteSchema,
  layoutIllustrationQuoteBodySchema,
  layoutIllustrationGenerationDecisionSchema,
  layoutIllustrationGenerationRecordSchema,
  sameLayoutIllustrationPreparation,
  type LayoutIllustrationGenerationRecord,
  type LayoutIllustrationGenerationPolicy,
  type LayoutIllustrationPreparation,
} from "@fl-copilot/domain";
import { assertPhysicalAllocationCurrent } from "@fl-copilot/commercial-core";
import type { SyncCommand } from "@fl-copilot/sync-contracts";
import type { DatabaseService } from "../database/types";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "../sync/processed-command-service";
import { createMongoSyncChangeService } from "../sync/sync-change-service";
import { AuthError } from "../auth/service";
import { readStoreLayoutScenarioSources } from "../commercial/physical-allocation-sources";
import {
  serializeStoreLayoutRevision,
  type StoreLayoutRevisionDocument,
} from "../store-layout-sync";
import {
  readLayoutIllustrationPreparationSource,
  serializeLayoutIllustration,
  type LayoutIllustrationDocument,
} from "./layout-illustration-store";
import type { createLayoutIllustrationProvider } from "./layout-illustration-provider";
import type { LayoutIllustrationFiles } from "./layout-illustration-files";
export const ILLUSTRATION_GENERATIONS = "copilotLayoutIllustrationGenerations";
export type IllustrationGenerationDocument =
  LayoutIllustrationGenerationRecord & { _id: string };
type Scope = { storeId: string; userId: string };
type Provider = Pick<
  ReturnType<typeof createLayoutIllustrationProvider>,
  "generate"
>;
export type IllustrationGenerationConfiguration = {
  enabled: boolean;
  policy?: LayoutIllustrationGenerationPolicy;
  signingSecret?: string;
};
const unavailable = () =>
  new AuthError(
    404,
    "LAYOUT_ILLUSTRATION_UNAVAILABLE",
    "Cette illustration n’est pas disponible dans cette conversation.",
  );
export function serializeIllustrationGeneration(
  row: IllustrationGenerationDocument,
) {
  const { _id, ...payload } = row,
    value = layoutIllustrationGenerationRecordSchema.parse(payload);
  if (_id !== value.id)
    throw Error("LAYOUT_ILLUSTRATION_GENERATION_ID_INVALID");
  return value;
}
async function preparation(
  db: Db,
  scope: Scope,
  id: string,
  session?: ClientSession,
  manager = true,
) {
  const row = await db
    .collection<LayoutIllustrationDocument>("copilotLayoutIllustrations")
    .findOne(
      { _id: id, storeId: scope.storeId, ownerId: scope.userId },
      { session },
    );
  if (!row) throw unavailable();
  const p = serializeLayoutIllustration(row);
  if (!(await readLayoutIllustrationPreparationSource(db, p, session, manager)))
    throw unavailable();
  return p;
}
async function currentSource(
  db: Db,
  p: LayoutIllustrationPreparation,
  session?: ClientSession,
) {
  if (!(await readLayoutIllustrationPreparationSource(db, p, session)))
    throw unavailable();
  const row = await db
    .collection<{ _id: string } & Record<string, unknown>>("copilotMessages")
    .findOne(
      {
        _id: p.scenarioMessageId,
        storeId: p.storeId,
        ownerId: p.ownerId,
        conversationId: p.conversationId,
      },
      { session },
    );
  const revision = await db
    .collection<StoreLayoutRevisionDocument>("storeLayoutRevisions")
    .findOne({ _id: p.physicalRevisionId, storeId: p.storeId }, { session });
  if (!row || !revision) throw unavailable();
  const { _id, ...payload } = row;
  void _id;
  const card = copilotMessageSchema.parse(payload),
    { content } = readStoreLayoutScenarioCard(card);
  const sources = await readStoreLayoutScenarioSources(
    db,
    p.storeId,
    layoutScenarioInput(content.scenario),
    { session },
  );
  assertPhysicalAllocationCurrent(p.storeId, content.scenario, sources);
  return { card, layout: serializeStoreLayoutRevision(revision).plan };
}
export async function canAccessIllustrationGeneration(
  db: Db,
  storeId: string,
  ownerId: string | undefined,
  c: SyncCommand,
  session?: ClientSession,
) {
  const parsed = layoutIllustrationGenerationDecisionSchema.safeParse(
    c.payload,
  );
  if (
    !ownerId ||
    !parsed.success ||
    c.entityType !== "copilot_layout_illustration_generation" ||
    c.type !== "COPILOT_LAYOUT_ILLUSTRATION_GENERATE" ||
    c.commandId !== c.entityId ||
    parsed.data.id !== c.entityId ||
    c.expectedRemoteVersion != null
  )
    return false;
  const p = parsed.data.quote.body.preparation;
  if (p.storeId !== storeId || p.ownerId !== ownerId) return false;
  const stored = await db
    .collection<LayoutIllustrationDocument>("copilotLayoutIllustrations")
    .findOne({ _id: p.id, storeId, ownerId }, { session });
  if (
    !stored ||
    !sameLayoutIllustrationPreparation(serializeLayoutIllustration(stored), p)
  )
    return false;
  const old = await db
    .collection<IllustrationGenerationDocument>(ILLUSTRATION_GENERATIONS)
    .findOne({ _id: c.entityId }, { session });
  if (
    old &&
    JSON.stringify(serializeIllustrationGeneration(old).decision) !==
      JSON.stringify(parsed.data)
  )
    return false;
  // A still-active owner may acknowledge an already accepted immutable decision
  // after losing manager rights. This is a private read; first admission remains manager-only.
  return !!(await readLayoutIllustrationPreparationSource(
    db,
    p,
    session,
    !old,
  ));
}
export function createLayoutIllustrationGeneration(
  database: DatabaseService,
  configuration: IllustrationGenerationConfiguration,
  files: Pick<LayoutIllustrationFiles, "persist" | "recover">,
  provider?: Provider,
  now: () => Date = () => new Date(),
) {
  const policy = configuration.policy
    ? layoutIllustrationGenerationPolicySchema.parse(configuration.policy)
    : undefined;
  if (
    configuration.enabled &&
    (!policy ||
      !provider ||
      !configuration.signingSecret ||
      configuration.signingSecret.length < 32)
  )
    throw Error("LAYOUT_ILLUSTRATION_GENERATION_NOT_CONFIGURED");
  const enabled = configuration.enabled && !!policy && !!provider;
  const changes = createMongoSyncChangeService(now);
  const sign = (body: unknown) =>
    createHmac("sha256", configuration.signingSecret ?? "disabled")
      .update("fl-layout-illustration-quote-v1\0")
      .update(JSON.stringify(layoutIllustrationQuoteBodySchema.parse(body)))
      .digest("hex");
  async function update(
    id: string,
    transform: (
      r: LayoutIllustrationGenerationRecord,
      ctx: MongoCommandMutationContext,
    ) => Promise<LayoutIllustrationGenerationRecord | null>,
  ) {
    const db = await database.getDb(),
      session = db.client.startSession();
    let result: LayoutIllustrationGenerationRecord | undefined;
    try {
      await session.withTransaction(async () => {
        const col = db.collection<IllustrationGenerationDocument>(
            ILLUSTRATION_GENERATIONS,
          ),
          row = await col.findOne({ _id: id }, { session });
        if (!row) throw unavailable();
        const old = serializeIllustrationGeneration(row),
          next = await transform(old, { database: db, session });
        if (!next) {
          result = old;
          return;
        }
        const value = layoutIllustrationGenerationRecordSchema.parse({
          ...next,
          version: old.version + 1,
          updatedAt: now().toISOString(),
        });
        const changed = await col.replaceOne(
          { _id: id, version: old.version },
          value,
          { session },
        );
        if (changed.matchedCount !== 1)
          throw Error("LAYOUT_ILLUSTRATION_GENERATION_STALE");
        await changes.append(
          { database: db, session },
          {
            storeId: value.storeId,
            entityType: "copilot_layout_illustration_generation",
            entityId: id,
            entityVersion: value.version,
            operation: "UPSERT",
          },
        );
        result = value;
      });
    } finally {
      await session.endSession();
    }
    if (!result)
      throw Error("LAYOUT_ILLUSTRATION_GENERATION_TRANSACTION_FAILED");
    return result;
  }
  async function recover(r: LayoutIllustrationGenerationRecord) {
    let success = false,
      reason: "RESULT_UNCERTAIN" | "ARCHIVE_PENDING" = "ARCHIVE_PENDING";
    try {
      const m = await files.recover(
        { storeId: r.storeId, userId: r.ownerId },
        r.preparationId,
        r.id,
      );
      success = m.id === r.id;
    } catch (e) {
      if (
        e instanceof Error &&
        /^LAYOUT_ILLUSTRATION_(?:RESULT_UNCERTAIN|FILE_INVALID|UNAVAILABLE|SOURCE_INVALID)$/.test(
          e.message,
        )
      )
        reason = "RESULT_UNCERTAIN";
    }
    return update(r.id, async (old) =>
      old.status === "SUCCEEDED"
        ? null
        : {
            ...old,
            status: success ? "SUCCEEDED" : "OUTCOME_UNKNOWN",
            reason: success ? null : reason,
          },
    );
  }
  return {
    async quote(scope: Scope, preparationId: string) {
      if (!enabled) return { state: "DISABLED" as const };
      const db = await database.getDb(),
        p = await preparation(db, scope, preparationId);
      await currentSource(db, p);
      const issued = now(),
        body = layoutIllustrationQuoteBodySchema.parse({
          id: randomUUID(),
          preparation: p,
          policy,
          format: "PNG_1536x1024_LOW_ONE",
          issuedAt: issued.toISOString(),
          expiresAt: new Date(+issued + 300_000).toISOString(),
        });
      return {
        state: "READY" as const,
        quote: layoutIllustrationQuoteSchema.parse({
          body,
          signature: sign(body),
        }),
      };
    },
    async read(scope: Scope, id: string) {
      const db = await database.getDb(),
        row = await db
          .collection<IllustrationGenerationDocument>(ILLUSTRATION_GENERATIONS)
          .findOne({ _id: id, storeId: scope.storeId, ownerId: scope.userId });
      if (!row) throw unavailable();
      const r = serializeIllustrationGeneration(row);
      await preparation(db, scope, r.preparationId, undefined, false);
      return r;
    },
    async apply(
      ctx: MongoCommandMutationContext,
      storeId: string,
      ownerId: string,
      c: SyncCommand,
      requestId: string,
    ): Promise<CommandMutationResult> {
      const reject = (code: string): CommandMutationResult => ({
        resultStatus: "REJECTED",
        resultingVersion: null,
        responseJson: {
          error: {
            code,
            messageFr:
              code === "LAYOUT_ILLUSTRATION_LIMIT_REACHED"
                ? "La limite de confirmations de la journée est atteinte. Les données et images restent conservées."
                : "Cette génération nécessite une nouvelle confirmation. Aucune nouvelle image n’a été demandée au fournisseur.",
            retryable: false,
            requestId,
          },
        },
      });
      if (
        !(await canAccessIllustrationGeneration(
          ctx.database,
          storeId,
          ownerId,
          c,
          ctx.session,
        ))
      )
        return reject("LAYOUT_ILLUSTRATION_GENERATION_INVALID");
      const decision = layoutIllustrationGenerationDecisionSchema.parse(
          c.payload,
        ),
        col = ctx.database.collection<IllustrationGenerationDocument>(
          ILLUSTRATION_GENERATIONS,
        ),
        old = await col.findOne({ _id: decision.id }, { session: ctx.session });
      if (old)
        return {
          resultStatus: "APPLIED",
          resultingVersion: old.version,
          responseJson: { remoteEntity: serializeIllustrationGeneration(old) },
        };
      if (!enabled) return reject("LAYOUT_ILLUSTRATION_DISABLED");
      const q = decision.quote,
        clock = now();
      if (
        JSON.stringify(q.body.policy) !== JSON.stringify(policy) ||
        !timingSafeEqual(
          Buffer.from(q.signature, "hex"),
          Buffer.from(sign(q.body), "hex"),
        )
      )
        return reject("LAYOUT_ILLUSTRATION_QUOTE_INVALID");
      if (
        +clock < Date.parse(q.body.issuedAt) ||
        +clock >= Date.parse(q.body.expiresAt)
      )
        return reject("LAYOUT_ILLUSTRATION_QUOTE_EXPIRED");
      if (
        await col.findOne(
          { "decision.quote.body.id": q.body.id },
          { session: ctx.session },
        )
      )
        return reject("LAYOUT_ILLUSTRATION_QUOTE_USED");
      if (
        await col.findOne(
          {
            storeId,
            ownerId,
            preparationId: q.body.preparation.id,
            status: { $in: ["QUEUED", "SUBMITTED"] },
          },
          { session: ctx.session },
        )
      )
        return reject("LAYOUT_ILLUSTRATION_ALREADY_RUNNING");
      // Only known source/validation errors become a definitive refusal. Database outages propagate.
      try {
        await currentSource(ctx.database, q.body.preparation, ctx.session);
      } catch (e) {
        if (
          e instanceof AuthError ||
          (e instanceof Error &&
            /^(?:PHYSICAL_ALLOCATION_|LAYOUT_SCENARIO_|LAYOUT_ILLUSTRATION_)/.test(
              e.message,
            ))
        )
          return reject("LAYOUT_ILLUSTRATION_SOURCE_CHANGED");
        throw e;
      }
      // Always-existing, tiny governor: concurrent admissions conflict here before
      // creating their first daily counter, avoiding duplicate-upsert races in a transaction.
      const gate = await ctx.database
        .collection<{ _id: string; revision: number }>(
          "layoutIllustrationAdmissionGate",
        )
        .updateOne(
          { _id: "global" },
          { $inc: { revision: 1 } },
          { session: ctx.session },
        );
      if (gate.matchedCount !== 1)
        throw Error("LAYOUT_ILLUSTRATION_ADMISSION_UNAVAILABLE");
      const p = policy!,
        day = clock.toISOString().slice(0, 10),
        budgets = ctx.database.collection<{
          _id: string;
          attempts: number;
          reservedUsdMicros: number;
        }>("layoutIllustrationBudgets"),
        limits = [
          {
            id: `global:${day}`,
            attempts: p.globalDailyAttempts,
            amount: p.globalDailyReservedUsdMicros,
          },
          {
            id: `store:${storeId}:${day}`,
            attempts: p.storeDailyAttempts,
            amount: p.storeDailyReservedUsdMicros,
          },
          {
            id: `owner:${ownerId}:${day}`,
            attempts: p.ownerDailyAttempts,
            amount: Number.MAX_SAFE_INTEGER,
          },
        ];
      const counters = [];
      for (const limit of limits) {
        const row = await budgets.findOne(
          { _id: limit.id },
          { session: ctx.session },
        );
        if (
          (row?.attempts ?? 0) >= limit.attempts ||
          (row?.reservedUsdMicros ?? 0) + p.estimatedCostUsdMicros >
            limit.amount
        )
          return reject("LAYOUT_ILLUSTRATION_LIMIT_REACHED");
        counters.push({ limit, row });
      }
      for (const { limit, row } of counters)
        await budgets.updateOne(
          { _id: limit.id },
          {
            $inc: { attempts: 1, reservedUsdMicros: p.estimatedCostUsdMicros },
          },
          { upsert: !row, session: ctx.session },
        );
      const prep = q.body.preparation,
        r = layoutIllustrationGenerationRecordSchema.parse({
          id: decision.id,
          storeId,
          ownerId,
          conversationId: prep.conversationId,
          preparationId: prep.id,
          decision,
          version: 1,
          status: "QUEUED",
          createdAt: clock.toISOString(),
          updatedAt: clock.toISOString(),
          submittedAt: null,
          recoverAt: null,
          reason: null,
        });
      await col.insertOne({ _id: r.id, ...r }, { session: ctx.session });
      await changes.append(ctx, {
        storeId,
        entityType: "copilot_layout_illustration_generation",
        entityId: r.id,
        entityVersion: 1,
        operation: "UPSERT",
      });
      return {
        resultStatus: "APPLIED",
        resultingVersion: 1,
        responseJson: { remoteEntity: r },
      };
    },
    async pending(storeId?: string) {
      const rows = await (
        await database.getDb()
      )
        .collection<IllustrationGenerationDocument>(ILLUSTRATION_GENERATIONS)
        .find({
          ...(storeId ? { storeId } : {}),
          $or: [
            { status: "QUEUED" },
            { status: "SUBMITTED", recoverAt: { $lte: now().toISOString() } },
            { status: "OUTCOME_UNKNOWN", reason: "ARCHIVE_PENDING" },
          ],
        })
        .sort({ createdAt: 1, _id: 1 })
        .limit(25)
        .toArray();
      return rows.map((r) => ({ id: r.id, version: r.version }));
    },
    async process(id: string): Promise<LayoutIllustrationGenerationRecord> {
      const db = await database.getDb(),
        raw = await db
          .collection<IllustrationGenerationDocument>(ILLUSTRATION_GENERATIONS)
          .findOne({ _id: id });
      if (!raw) throw unavailable();
      const r = serializeIllustrationGeneration(raw);
      if (r.status === "SUCCEEDED" || r.status === "NOT_SUBMITTED") return r;
      if (r.status !== "QUEUED") {
        if (r.status === "SUBMITTED" && Date.parse(r.recoverAt!) > +now())
          return r;
        return recover(r);
      }
      let source: Awaited<ReturnType<typeof currentSource>> | undefined,
        claimed = false;
      const claim = await update(id, async (old, ctx) => {
        claimed = false;
        source = undefined;
        if (old.status !== "QUEUED") return null;
        let reason: "DISABLED" | "EXPIRED" | "SOURCE_CHANGED" | null = null;
        if (
          !enabled ||
          JSON.stringify(old.decision.quote.body.policy) !==
            JSON.stringify(policy)
        )
          reason = "DISABLED";
        else if (+now() >= Date.parse(old.decision.quote.body.expiresAt))
          reason = "EXPIRED";
        else {
          try {
            source = await currentSource(
              ctx.database,
              old.decision.quote.body.preparation,
              ctx.session,
            );
          } catch (e) {
            if (
              e instanceof AuthError ||
              (e instanceof Error &&
                /^(?:PHYSICAL_ALLOCATION_|LAYOUT_SCENARIO_|LAYOUT_ILLUSTRATION_)/.test(
                  e.message,
                ))
            )
              reason = "SOURCE_CHANGED";
            else throw e;
          }
        }
        if (!reason && +now() >= Date.parse(old.decision.quote.body.expiresAt))
          reason = "EXPIRED";
        if (reason) return { ...old, status: "NOT_SUBMITTED", reason };
        claimed = true;
        const time = now();
        return {
          ...old,
          status: "SUBMITTED",
          submittedAt: time.toISOString(),
          recoverAt: new Date(+time + 360_000).toISOString(),
          reason: null,
        };
      });
      if (!claimed || !source) return claim;
      // SUBMITTED is durable before any call. A crash, lost response or duplicate event
      // can only recover the same archived result; it can never call the provider again.
      try {
        const p = claim.decision.quote.body.preparation;
        const output = await provider!.generate(
          {
            storeId: p.storeId,
            ownerId: p.ownerId,
            conversationId: p.conversationId,
          },
          source.card,
          source.layout,
        );
        await files.persist(
          { storeId: p.storeId, userId: p.ownerId },
          p.id,
          claim.id,
          output,
          claim.submittedAt!,
        );
        return await update(id, async (old) =>
          old.status === "SUCCEEDED"
            ? null
            : { ...old, status: "SUCCEEDED", reason: null },
        );
      } catch {
        return recover(claim);
      }
    },
  };
}
export type LayoutIllustrationGenerationService = ReturnType<
  typeof createLayoutIllustrationGeneration
>;
