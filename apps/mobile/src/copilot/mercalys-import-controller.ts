import {
  copilotImportStatusSchema,
  readCopilotImportStatus,
} from "@fl-copilot/domain";
import { CopilotConversationRepository } from "./conversation-repository";
import { MercalysImportValidationError } from "../documents/mercalys-import-validation";
import { z } from "zod";
import { assertEmailMercalysAuthority } from "../intake/email-mercalys-authority";
import {
  copilotMessageSchema,
  copilotConversationSchema,
  copilotMessageIsDeleted,
  readCopilotImportReference,
  importAutomationResultSchema,
  validateImportClassification,
  importSourceClassification,
  copilotImportResolutionChoiceSchema,
  mercalysProductTargetBlocker,
  normalizeProductLabel,
  type CopilotMessage,
  type ProductMatchCatalog,
  type MercalysBatchItem,
  type importClassificationResultSchema,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { MercalysBatchRepository } from "../documents/mercalys-batch-repository";
import { MercalysBatchPreparation } from "../documents/mercalys-batch-preparation";
import { MercalysImportPublicationRepository } from "../documents/mercalys-import-publication";
import {
  buildMercalysProductResolutions,
  confirmMercalysProductMapping,
  type MercalysProductResolution,
} from "../documents/mercalys-product-resolution";
import {
  emptyProductDraft,
  saveProductEditor,
  productMutationExpectedRemoteVersion,
} from "../products/product-editor-service";
import { ProductMasterRepository } from "../products/product-master-repository";
import {
  joinedProductToolDatabase,
  runReviewedStoreOperation,
  queueProductToolRecomputation,
} from "./product-tool-transaction";
export type ImportDb = OutboxDatabase & AtomicMutationDatabase;
type Assistance = z.infer<typeof importClassificationResultSchema>;
const continuationCodes = [
  "MERCALYS_CONTINUATION_SOURCE_CHANGED",
  "MERCALYS_CONTINUATION_SUPERSEDED",
  "MERCALYS_CONTINUATION_CONFLICT",
  "MERCALYS_CONTINUATION_OVERLAP",
];
type Scope = {
  storeId: string;
  ownerId: string;
  deviceId: string;
  canImport: boolean;
};
type Dependencies = {
  authorize?(db: OutboxDatabase): Promise<void>;
  id(): string;
  digest(s: string): Promise<string>;
  read(uri: string): Promise<Uint8Array<ArrayBuffer>>;
  checksum(bytes: Uint8Array<ArrayBuffer>): Promise<string>;
  classify(labels: string[], signal?: AbortSignal): Promise<unknown>;
};
export async function importManifestHash(
  batch: Awaited<ReturnType<MercalysBatchRepository["header"]>>,
  digest: Dependencies["digest"],
) {
  return digest(
    JSON.stringify({
      id: batch.id,
      storeId: batch.storeId,
      ownerId: batch.ownerId,
      conversationId: batch.conversationId,
      archiveId: batch.archiveId ?? null,
      createdAt: batch.createdAt,
      files: batch.files.map(({ id, filename, checksum, sizeBytes }) => ({
        id,
        filename,
        checksum,
        sizeBytes,
      })),
    }),
  );
}
export class CopilotMercalysImportController {
  private running = new Map<string, Promise<ImportReport>>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private db: ImportDb,
    private scope: Scope,
    private deps: Dependencies,
  ) {}
  private batches(db: ImportDb, conversationId: string) {
    return new MercalysBatchRepository(db, { ...this.scope, conversationId });
  }
  private async proof(db: OutboxDatabase, raw: CopilotMessage) {
    if (!this.scope.canImport) throw Error("IMPORT_FORBIDDEN");
    await this.deps.authorize?.(db);
    const { message, reference } = readCopilotImportReference(raw);
    if (
      message.storeId !== this.scope.storeId ||
      message.ownerId !== this.scope.ownerId
    )
      throw Error("IMPORT_SCOPE");
    await assertEmailMercalysAuthority(db, message, reference);
    const [m, c] = await Promise.all([
      db.getFirstAsync<{ payload_json: string }>(
        "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
        message.id,
        this.scope.storeId,
        this.scope.ownerId,
        message.conversationId,
      ),
      db.getFirstAsync<{ payload_json: string }>(
        "SELECT payload_json FROM copilot_conversations WHERE id=? AND store_id=? AND owner_id=?",
        message.conversationId,
        this.scope.storeId,
        this.scope.ownerId,
      ),
    ]);
    if (
      !m ||
      !c ||
      JSON.stringify(copilotMessageSchema.parse(JSON.parse(m.payload_json))) !==
        JSON.stringify(message)
    )
      throw Error("IMPORT_SCOPE");
    const conversation = copilotConversationSchema.parse(
      JSON.parse(c.payload_json),
    );
    if (
      conversation.status !== "ACTIVE" ||
      copilotMessageIsDeleted(message, conversation)
    )
      throw Error("IMPORT_DELETED");
    const batch = await this.batches(
      joinedProductToolDatabase(db),
      message.conversationId,
    ).header(reference.batchId);
    if (
      (await importManifestHash(batch, this.deps.digest)) !==
      reference.manifestHash
    )
      throw Error("IMPORT_SOURCE_CHANGED");
    return { message, reference, batch };
  }
  private async catalog(db: OutboxDatabase) {
    const repo = new ProductMasterRepository(joinedProductToolDatabase(db));
    const [products, identifiers, aliases] = await Promise.all([
      repo.listProducts(this.scope.storeId),
      repo.listIdentifiersByStore(this.scope.storeId),
      repo.listAliasesByStore(this.scope.storeId),
    ]);
    return {
      records: { products, identifiers, aliases },
      catalog: {
        products: products.map((r) => r.entity),
        identifiers: identifiers.map((r) => r.entity),
        aliases: aliases.map((r) => r.entity),
      } satisfies ProductMatchCatalog,
    };
  }
  private preparation(db: OutboxDatabase, message: CopilotMessage) {
    const joined = joinedProductToolDatabase(db),
      batches = this.batches(joined, message.conversationId);
    const publication = new MercalysImportPublicationRepository(
      joined,
      this.deps.id,
    );
    const preparation = new MercalysBatchPreparation(batches, {
      read: this.deps.read,
      checksum: this.deps.checksum,
      catalog: async () => (await this.catalog(db)).catalog,
      publication,
    });
    return {
      readValidated: async (
        ...args: Parameters<MercalysBatchPreparation["readValidated"]>
      ) => {
        const current = await preparation.readValidated(...args);
        const continuation = await publication.continuation(
          this.scope.storeId,
          current.item.checksum,
          current.summary,
        );
        return {
          ...current,
          summary: continuation?.summary ?? current.summary,
          continuation,
        };
      },
    };
  }
  private async key(text: string) {
    const h = await this.deps.digest(text);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }
  private async write(
    message: CopilotMessage,
    itemId: string,
    phase: "PRODUCTS" | "CLASSIFICATION" | "PUBLICATION" | "CHOICE" | "KEEP",
    identity: unknown,
    work: (
      tx: OutboxDatabase,
    ) => Promise<Partial<z.infer<typeof importAutomationResultSchema>>>,
    signal?: AbortSignal,
  ) {
    const operationId = await this.key(
        JSON.stringify([message.id, itemId, phase, identity]),
      ),
      request = { operationId, itemId, phase, identity };
    await this.proof(this.db, message);
    return runReviewedStoreOperation(
      this.db,
      request,
      {
        storeId: this.scope.storeId,
        ownerId: this.scope.ownerId,
        deviceId: this.scope.deviceId,
        canExecute: this.scope.canImport,
        conversationId: message.conversationId,
        userMessageId: message.id,
        decisionLevel: "REVIEWED",
        authorizedRequestJson: JSON.stringify(request),
      },
      importAutomationResultSchema,
      async (tx) => {
        await this.proof(tx, message);
        const result = await work(tx);
        return {
          operationId,
          userMessageId: message.id,
          appliedAt: new Date().toISOString(),
          phase,
          sourceDocumentId: null,
          createdCount: 0,
          publishedCount: 0,
          remainingCount: 0,
          replacedCount: 0,
          classification: null,
          changes: [],
          ...result,
        };
      },
      signal,
    );
  }
  private assertCatalog(
    records: Awaited<
      ReturnType<CopilotMercalysImportController["catalog"]>
    >["records"],
    ids: readonly string[],
  ) {
    if (
      [...records.products, ...records.identifiers, ...records.aliases].some(
        (r) =>
          ids.includes(
            "productId" in r.entity ? r.entity.productId : r.entity.id,
          ) && ["ERROR", "CONFLICT"].includes(r.syncState),
      )
    )
      throw Error("IMPORT_PRODUCT_CONFLICT");
  }
  /** Complete retained lot preflight: identifiers shared by different source labels cannot be auto-created. */
  private async preflight(message: CopilotMessage, signal?: AbortSignal) {
    const { batch, reference } = await this.proof(this.db, message),
      labels = new Map<string, Set<string>>(),
      originalLabels = new Map<string, Set<string>>(),
      failed = new Map<string, string>();
    let attempted = 0;
    const candidates: Array<{
        label: string;
        identifiers: Array<{ type: string; value: string }>;
      }> = [],
      cached: Assistance[] = [];
    const initial = await this.catalog(this.db);
    for (const item of batch.files) {
      const state = await this.batches(this.db, message.conversationId).get(
        batch.id,
        item.id,
      );
      attempted += state.assistance?.attemptedCount ?? 0;
      if (state.assistance?.result) cached.push(state.assistance.result);
      if (signal?.aborted) throw Error("IMPORT_CANCELLED");
      try {
        const { summary, continuation } = await this.preparation(
          this.db,
          message,
        ).readValidated(batch.id, item.id, signal);
        const publishedIndexes = new Set(
          continuation?.publication.records
            .filter((r) => r.status === "PUBLISHED")
            .map((r) => r.sourceIndex) ?? [],
        );
        if (summary.lines.length > 2000) throw Error("IMPORT_REVIEW_LIMIT");
        for (const resolution of buildMercalysProductResolutions(summary))
          if (
            resolution.canCreate &&
            resolution.identifiers.every(
              (i) =>
                !initial.catalog.identifiers.some(
                  (e) => e.type === i.type && e.value === i.value,
                ),
            )
          )
            candidates.push({
              label: resolution.label,
              identifiers: resolution.identifiers,
            });
        for (const line of summary.lines)
          if (
            line.match.state === "AUTO_MATCH" &&
            !publishedIndexes.has(line.record.sourceIndex) &&
            initial.catalog.products.some(
              (p) =>
                p.id === line.match.matchedProductId &&
                p.category === "UNKNOWN",
            )
          )
            candidates.push({ label: line.record.rawLabel, identifiers: [] });
        for (const { record } of summary.lines)
          for (const [type, value] of [
            ["ITM8", record.itm8],
            ["EAN", record.ean],
          ])
            if (value) {
              const key = `${type}:${value}`;
              originalLabels.set(
                key,
                new Set(originalLabels.get(key)).add(record.rawLabel),
              );
              labels.set(
                key,
                new Set(labels.get(key)).add(
                  normalizeProductLabel(record.rawLabel),
                ),
              );
            }
      } catch (e) {
        if (signal?.aborted) throw e;
        failed.set(
          item.id,
          e instanceof MercalysImportValidationError
            ? e.code
            : e instanceof Error &&
                [
                  "IMPORT_REVIEW_LIMIT",
                  "MERCALYS_BATCH_FILE_CHANGED",
                  "MERCALYS_BATCH_MEMBER_COPY_REQUIRED",
                  ...continuationCodes,
                ].includes(e.message)
              ? e.message
              : "IMPORT_FILE_UNAVAILABLE",
        );
      }
    }
    const ambiguous = new Set(
      [...labels].filter(([, v]) => v.size > 1).map(([k]) => k),
    );
    const suggestions = new Map(
      cached.flatMap((c) => c.suggestions.map((s) => [s.label, s] as const)),
    );
    return {
      batch,
      allowPartialPublication: reference.policyVersion === 2,
      failed,
      originalLabels,
      classificationBudget: { remaining: Math.max(0, 200 - attempted) },
      ambiguous,
      classificationLabels: [
        ...new Set(
          candidates
            .filter((c) =>
              c.identifiers.every(
                (i) => !ambiguous.has(`${i.type}:${i.value}`),
              ),
            )
            .map((c) => c.label),
        ),
      ].sort(),
      cachedClassification: cached.length
        ? {
            model: [...new Set(cached.map((c) => c.model))]
              .join(",")
              .slice(0, 160),
            suggestions: [...suggestions.values()],
          }
        : null,
    };
  }

  private async assistance(
    message: CopilotMessage,
    item: MercalysBatchItem,
    labels: string[],
    budget: { remaining: number },
    cached: Assistance | null,
    signal?: AbortSignal,
  ) {
    labels = [...new Set(labels)]
      .filter((label) => !cached?.suggestions.some((s) => s.label === label))
      .sort();
    if (!labels.length) return cached;
    const labelsHash = await this.deps.digest(JSON.stringify(labels));
    if (item.assistance?.labelsHash === labelsHash) return cached;
    let result: Assistance | null = cached;
    const selected = labels.slice(0, budget.remaining),
      attemptedCount = (item.assistance?.attemptedCount ?? 0) + selected.length;
    // Reserve before external work: interrupted/provider-failed requests are not silently charged again on restart.
    await this.proof(this.db, message);
    await this.batches(this.db, message.conversationId).saveAssistance(
      item.batchId,
      item.id,
      item.version,
      { labelsHash, result: null, attemptedCount },
    );
    budget.remaining -= selected.length;
    try {
      const suggestions: Assistance["suggestions"] = [
          ...(cached?.suggestions ?? []),
        ],
        models = new Set<string>(cached ? [cached.model] : []);
      for (let i = 0; i < selected.length; i += 50) {
        if (signal?.aborted) throw Error("IMPORT_CANCELLED");
        await this.proof(this.db, message);
        const part = validateImportClassification(
          await this.deps.classify(selected.slice(i, i + 50), signal),
          selected.slice(i, i + 50),
        );
        suggestions.push(...part.suggestions);
        models.add(part.model);
      }
      // Cache is bounded per item; larger lists remain UNKNOWN rather than being silently sampled.
      if (models.size && suggestions.length <= 2000)
        result = { model: [...models].join(",").slice(0, 160), suggestions };
    } catch {
      if (signal?.aborted) throw Error("IMPORT_CANCELLED");
    }
    await this.proof(this.db, message);
    await this.batches(this.db, message.conversationId).saveAssistance(
      item.batchId,
      item.id,
      item.version + 1,
      { labelsHash, result, attemptedCount },
    );
    return result;
  }
  private catalogBasis(
    records: Awaited<
      ReturnType<CopilotMercalysImportController["catalog"]>
    >["records"],
  ) {
    return Object.fromEntries(
      Object.entries(records).map(([key, values]) => [
        key,
        values.map((r) => ({
          entity: r.entity,
          conflicted: ["ERROR", "CONFLICT"].includes(r.syncState),
        })),
      ]),
    );
  }
  private async enrich(
    message: CopilotMessage,
    item: MercalysBatchItem,
    classification: Assistance | null,
    signal?: AbortSignal,
  ) {
    const readChanges = async (db: OutboxDatabase) => {
      const { summary, continuation } = await this.preparation(
          db,
          message,
        ).readValidated(item.batchId, item.id, signal),
        { records } = await this.catalog(db);
      const byProduct = new Map<string, string[]>();
      const publishedIndexes = new Set(
        continuation?.publication.records
          .filter((r) => r.status === "PUBLISHED")
          .map((r) => r.sourceIndex) ?? [],
      );
      for (const line of summary.lines)
        if (
          line.match.state === "AUTO_MATCH" &&
          line.match.matchedProductId &&
          !publishedIndexes.has(line.record.sourceIndex)
        ) {
          const id = line.match.matchedProductId;
          byProduct.set(id, [
            ...(byProduct.get(id) ?? []),
            line.record.rawLabel,
          ]);
        }
      const changes = [];
      for (const [id, labels] of byProduct) {
        const record = records.products.find((p) => p.entity.id === id);
        if (!record || record.entity.status !== "ACTIVE") continue;
        const before = {
            category: record.entity.category,
            nature: record.entity.nature,
            salesUnit: record.entity.salesUnit,
          },
          after = { ...before };
        const categories = [
          ...new Set(
            labels.flatMap((label) => {
              const s = classification?.suggestions.find(
                (s) => s.label === label,
              );
              return s && s.confidence >= 0.95 && s.category !== "UNKNOWN"
                ? [s.category]
                : [];
            }),
          ),
        ];
        if (before.category === "UNKNOWN" && categories.length === 1)
          after.category = categories[0]!;
        const markers = labels.map(importSourceClassification);
        for (const key of ["nature", "salesUnit"] as const) {
          const values = [
            ...new Set(
              markers.map((m) => m[key]).filter((v) => v !== "UNKNOWN"),
            ),
          ];
          if (before[key] === "UNKNOWN" && values.length === 1) {
            if (key === "nature")
              after.nature = values[0] as typeof after.nature;
            else after.salesUnit = values[0] as typeof after.salesUnit;
          }
        }
        if (JSON.stringify(before) !== JSON.stringify(after))
          changes.push({ record, before, after });
      }
      return { changes, records };
    };
    const before = await readChanges(this.db);
    if (!before.changes.length) return;
    const identity = {
      checksum: item.checksum,
      products: before.changes.map((c) => ({
        id: c.record.entity.id,
        version: c.record.entity.version,
        before: c.before,
        after: c.after,
      })),
    };
    await this.write(
      message,
      item.id,
      "CLASSIFICATION",
      identity,
      async (tx) => {
        const current = await readChanges(tx);
        if (
          JSON.stringify(
            current.changes.map((c) => ({
              id: c.record.entity.id,
              version: c.record.entity.version,
              before: c.before,
              after: c.after,
            })),
          ) !== JSON.stringify(identity.products)
        )
          throw Error("IMPORT_CHANGED");
        this.assertCatalog(
          current.records,
          current.changes.map((c) => c.record.entity.id),
        );
        const repo = new ProductMasterRepository(joinedProductToolDatabase(tx)),
          now = new Date().toISOString();
        for (const c of current.changes) {
          await repo.upsertProduct(
            {
              ...c.record.entity,
              ...c.after,
              version: c.record.entity.version + 1,
              updatedAt: now,
            },
            {
              commandId: this.deps.id(),
              deviceId: this.scope.deviceId,
              expectedRemoteVersion: productMutationExpectedRemoteVersion(
                c.record,
              ),
            },
          );
          await queueProductToolRecomputation(
            tx,
            this.scope.storeId,
            c.record.entity.id,
            this.deps.id(),
            now,
          );
        }
        return {
          classification,
          changes: current.changes.map((c) => ({
            productId: c.record.entity.id,
            before: c.before,
            after: c.after,
          })),
        };
      },
      signal,
    );
  }
  run(
    message: CopilotMessage,
    signal?: AbortSignal,
    onProgress?: (label: string) => void,
  ) {
    const old = this.running.get(message.id);
    if (old) return old;
    const task = this.tail.then(() =>
      this.process(message, signal, onProgress),
    );
    this.tail = task.catch(() => undefined);
    this.running.set(message.id, task);
    void task
      .finally(() => {
        if (this.running.get(message.id) === task)
          this.running.delete(message.id);
      })
      .catch(() => undefined);
    return task;
  }
  private async recordStatus(
    message: CopilotMessage,
    batchId: string,
    report: ImportReport,
  ) {
    await this.proof(this.db, message);
    const items = [];
    for (const item of report.items) {
      const source =
        item.status === "PUBLISHED" ||
        (item.status === "REVIEW" && item.priorSourceDocumentId)
          ? await this.db.getFirstAsync<{
              source_type: "MERCALYS_SALES" | "MERCALYS_WASTE";
              business_period_start: string;
              business_period_end: string;
            }>(
              "SELECT source_type,business_period_start,business_period_end FROM source_documents WHERE id=? AND store_id=? AND deleted_at IS NULL",
              item.status === "PUBLISHED"
                ? item.sourceDocumentId
                : item.priorSourceDocumentId!,
              this.scope.storeId,
            )
          : null;
      items.push({
        itemId: item.itemId,
        status: item.status,
        sourceDocumentId:
          item.status === "PUBLISHED"
            ? item.sourceDocumentId
            : item.status === "REVIEW"
              ? item.priorSourceDocumentId
              : null,
        publishedCount:
          item.status === "PUBLISHED" || item.status === "REVIEW"
            ? item.publishedCount
            : undefined,
        remainingCount:
          item.status === "PUBLISHED"
            ? 0
            : item.status === "REVIEW"
              ? item.summary.lines.length -
                item.publishedCount +
                item.summary.errorCount
              : undefined,
        sourceType:
          source?.source_type ??
          (item.status === "REVIEW" ? item.summary.sourceType : null),
        start:
          source?.business_period_start ??
          (item.status === "REVIEW" ? item.summary.businessPeriodStart : null),
        end:
          source?.business_period_end ??
          (item.status === "REVIEW" ? item.summary.businessPeriodEnd : null),
      });
    }
    for (let offset = 0; offset < items.length; offset += 20) {
      const status = copilotImportStatusSchema.parse({
          kind: "MERCALYS_CHAT_IMPORT_STATUS",
          schemaVersion: 1,
          originMessageId: message.id,
          batchId,
          part: offset / 20,
          totalParts: Math.ceil(items.length / 20),
          items: items.slice(offset, offset + 20),
        }),
        id = await this.key(JSON.stringify([message.id, status]));
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        await this.proof(tx, message);
        const old = await tx.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM copilot_messages WHERE id=?",
          id,
        );
        if (old) {
          const previous = readCopilotImportStatus(
            JSON.parse(old.payload_json),
          );
          if (
            previous.message.storeId !== message.storeId ||
            previous.message.ownerId !== message.ownerId ||
            previous.message.conversationId !== message.conversationId ||
            JSON.stringify(previous.status) !== JSON.stringify(status)
          )
            throw Error("IMPORT_STATUS_SCOPE");
          return;
        }
        await new CopilotConversationRepository(
          joinedProductToolDatabase(tx),
          this.scope,
        ).append(
          {
            id,
            storeId: message.storeId,
            ownerId: message.ownerId,
            conversationId: message.conversationId,
            role: "USER",
            text: JSON.stringify(status),
            attachments: [],
            replyToMessageId: message.id,
            supersedesMessageId: null,
            version: 1,
            createdAt: new Date().toISOString(),
          },
          {
            commandId: this.deps.id(),
            deviceId: this.scope.deviceId,
            preserveDraft: true,
          },
        );
      });
    }
  }
  private async process(
    message: CopilotMessage,
    signal?: AbortSignal,
    onProgress?: (label: string) => void,
  ): Promise<ImportReport> {
    const preflight = await this.preflight(message, signal),
      results: ImportReport["items"] = [];
    onProgress?.("Classification des références nouvelles ou incomplètes…");
    const anchor = preflight.batch.files.find(
      (f) => !preflight.failed.has(f.id),
    );
    const classification = anchor
      ? await this.assistance(
          message,
          await this.batches(this.db, message.conversationId).get(
            preflight.batch.id,
            anchor.id,
          ),
          preflight.classificationLabels,
          preflight.classificationBudget,
          preflight.cachedClassification,
          signal,
        )
      : preflight.cachedClassification;
    for (const file of preflight.batch.files) {
      if (signal?.aborted) throw Error("IMPORT_CANCELLED");
      await this.proof(this.db, message);
      onProgress?.(`Traitement de ${file.filename}…`);
      if (preflight.failed.has(file.id)) {
        results.push({
          itemId: file.id,
          filename: file.filename,
          status: "ERROR",
          code: preflight.failed.get(file.id)!,
        });
        continue;
      }
      try {
        let { item, summary, continuation } = await this.preparation(
          this.db,
          message,
        ).readValidated(preflight.batch.id, file.id, signal);
        const kept = await this.db.getFirstAsync<{ result_json: string }>(
          "SELECT result_json FROM copilot_tool_results WHERE store_id=? AND owner_id=? AND conversation_id=? AND json_extract(request_json,'$.itemId')=? AND json_extract(result_json,'$.phase')='KEEP' AND json_extract(result_json,'$.userMessageId')=? LIMIT 1",
          this.scope.storeId,
          this.scope.ownerId,
          message.conversationId,
          item.id,
          message.id,
        );
        if (kept) {
          importAutomationResultSchema.parse(JSON.parse(kept.result_json));
          results.push({
            itemId: item.id,
            filename: item.filename,
            status: "KEPT",
          });
          continue;
        }
        const pub = new MercalysImportPublicationRepository(
          this.db,
          this.deps.id,
        );
        const catalogue = await this.catalog(this.db);
        const safe = (r: MercalysProductResolution) =>
          r.canCreate &&
          r.identifiers.every(
            (i) =>
              !preflight.ambiguous.has(`${i.type}:${i.value}`) &&
              !catalogue.catalog.identifiers.some(
                (e) => e.type === i.type && e.value === i.value,
              ),
          );
        const resolutions =
          buildMercalysProductResolutions(summary).filter(safe);
        await this.enrich(message, item, classification, signal);
        const duplicate = await pub.findExactDuplicate(
          this.scope.storeId,
          summary.sourceType,
          item.checksum,
        );
        if (duplicate && continuation?.remainingCount === 0) {
          results.push({
            itemId: item.id,
            filename: item.filename,
            status: "PUBLISHED",
            sourceDocumentId: duplicate.sourceDocumentId,
            alreadyPublished: true,
            publishedCount: continuation.publishedCount,
          });
          continue;
        }
        if (resolutions.length) {
          await this.write(
            message,
            item.id,
            "PRODUCTS",
            {
              checksum: item.checksum,
              resolutions: resolutions.map((r) => ({
                key: r.key,
                label: r.label,
                identifiers: r.identifiers,
              })),
            },
            async (tx) => {
              const current = await this.preparation(tx, message).readValidated(
                  item.batchId,
                  item.id,
                  signal,
                ),
                { records } = await this.catalog(tx);
              const relevant = current.summary.lines.flatMap((l) =>
                l.match.matchedProductId ? [l.match.matchedProductId] : [],
              );
              const identifiers = new Set(
                current.summary.lines.flatMap((l) => [
                  l.record.itm8 ? `ITM8:${l.record.itm8}` : "",
                  l.record.ean ? `EAN:${l.record.ean}` : "",
                ]),
              );
              relevant.push(
                ...records.identifiers
                  .filter((r) =>
                    identifiers.has(`${r.entity.type}:${r.entity.value}`),
                  )
                  .map((r) => r.entity.productId),
              );
              this.assertCatalog(records, relevant);
              const repo = new ProductMasterRepository(
                joinedProductToolDatabase(tx),
              );
              let createdCount = 0;
              for (const resolution of buildMercalysProductResolutions(
                current.summary,
              ).filter(
                (r) =>
                  safe(r) &&
                  resolutions.some((selected) => selected.key === r.key),
              )) {
                if (
                  resolution.identifiers.some((i) =>
                    records.identifiers.some(
                      (r) =>
                        r.entity.type === i.type && r.entity.value === i.value,
                    ),
                  )
                )
                  continue;
                const suggestion = classification?.suggestions.find(
                  (s) => s.label === resolution.label,
                );
                await saveProductEditor(
                  repo,
                  {
                    ...emptyProductDraft,
                    label: resolution.label,
                    identifiers: resolution.identifiers,
                    ...importSourceClassification(resolution.label),
                    category:
                      suggestion && suggestion.confidence >= 0.95
                        ? suggestion.category
                        : "UNKNOWN",
                  },
                  {
                    ...this.scope,
                    identifierSource: "MERCALYS",
                    now: () => new Date().toISOString(),
                    generateId: this.deps.id,
                  },
                );
                createdCount++;
              }
              return { createdCount, classification };
            },
            signal,
          );
        }
        ({ item, summary, continuation } = await this.preparation(
          this.db,
          message,
        ).readValidated(item.batchId, item.id, signal));
        const overlap = continuation
          ? null
          : await pub.analyzeOverlap(this.scope.storeId, summary);
        if (overlap && overlap.rows.length > 2000)
          throw Error("IMPORT_REVIEW_LIMIT");
        // The native intake decision authorizes only unambiguous rows. An overlap
        // or parser anomaly still blocks the file; unresolved identities do not.
        const readyAdditions =
          summary.readyCount - (continuation?.publishedCount ?? 0);
        if (
          !summary.errorCount &&
          !overlap &&
          readyAdditions > 0 &&
          (preflight.allowPartialPublication ||
            summary.productReviewCount === 0)
        ) {
          const result = await this.write(
            message,
            item.id,
            "PUBLICATION",
            {
              checksum: item.checksum,
              snapshot: await this.deps.digest(
                JSON.stringify([summary, continuation?.publication ?? null]),
              ),
            },
            async (tx) => {
              const current = await this.preparation(tx, message).readValidated(
                  item.batchId,
                  item.id,
                  signal,
                ),
                catalog = await this.catalog(tx);
              if (current.summary.errorCount || !current.summary.readyCount)
                throw Error("IMPORT_CHANGED");
              if (
                JSON.stringify(current.summary) !== JSON.stringify(summary) ||
                JSON.stringify(current.continuation?.publication ?? null) !==
                  JSON.stringify(continuation?.publication ?? null)
              )
                throw Error("IMPORT_CHANGED");
              const publishedIndexes = new Set(
                current.continuation?.publication.records
                  .filter((r) => r.status === "PUBLISHED")
                  .map((r) => r.sourceIndex) ?? [],
              );
              const additions = current.summary.lines.filter(
                (l) =>
                  !publishedIndexes.has(l.record.sourceIndex) &&
                  l.match.state === "AUTO_MATCH" &&
                  l.match.matchedProductId,
              );
              if (!additions.length) throw Error("IMPORT_CHANGED");
              this.assertCatalog(
                catalog.records,
                additions.map((l) => l.match.matchedProductId!),
              );
              const publication = new MercalysImportPublicationRepository(
                joinedProductToolDatabase(tx),
                this.deps.id,
              );
              const result = current.continuation
                ? await publication.resume({
                    storeId: this.scope.storeId,
                    sourceDocumentId: current.continuation.sourceDocumentId,
                    checksum: current.item.checksum,
                    summary: current.summary,
                  })
                : await publication.publish({
                    storeId: this.scope.storeId,
                    filename: current.item.filename,
                    localFileUri: current.localUri,
                    sizeBytes: current.item.sizeBytes,
                    checksum: current.item.checksum,
                    mimeType:
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    summary: current.summary,
                  });
              return {
                sourceDocumentId: result.sourceDocumentId,
                publishedCount: result.publishedCount,
                remainingCount: result.remainingCount,
                replacedCount: result.replacedCount,
              };
            },
            signal,
          );
          if (result.remainingCount === 0) {
            results.push({
              itemId: item.id,
              filename: item.filename,
              status: "PUBLISHED",
              sourceDocumentId: result.sourceDocumentId!,
              alreadyPublished: false,
              completedPartial: continuation !== null,
              publishedCount:
                (continuation?.publishedCount ?? 0) + result.publishedCount,
            });
            continue;
          }
          ({ item, summary, continuation } = await this.preparation(
            this.db,
            message,
          ).readValidated(item.batchId, item.id, signal));
        }
        {
          const catalog = await this.catalog(this.db);
          const availableResolutions = buildMercalysProductResolutions(
            summary,
          ).map((r) => ({
            ...r,
            sourceLabels: [
              ...new Set(
                r.identifiers.flatMap((i) => [
                  ...(preflight.originalLabels.get(`${i.type}:${i.value}`) ??
                    []),
                ]),
              ),
            ],
            canCreateAsDistinct:
              r.canCreateAsDistinct &&
              r.identifiers.every(
                (i) =>
                  !catalog.catalog.identifiers.some(
                    (e) => e.type === i.type && e.value === i.value,
                  ),
              ),
            candidateProductIds: r.candidateProductIds.filter(
              (id) =>
                r.identifiers.every(
                  (i) =>
                    !catalog.catalog.identifiers.some(
                      (e) =>
                        e.type === i.type &&
                        e.value === i.value &&
                        e.productId !== id,
                    ),
                ) &&
                (r.identifiers.length > 0 ||
                  !catalog.catalog.aliases.some(
                    (a) =>
                      a.normalizedAlias === normalizeProductLabel(r.label) &&
                      (a.productId !== id || a.status !== "VALIDATED"),
                  )),
            ),
          }));
          results.push({
            itemId: item.id,
            filename: item.filename,
            status: "REVIEW",
            summary,
            priorSourceDocumentId: continuation?.sourceDocumentId ?? null,
            publishedCount: continuation?.publishedCount ?? 0,
            resolutions: availableResolutions,
            overlap,
            basisHash: await this.deps.digest(
              JSON.stringify([
                item.checksum,
                summary,
                overlap,
                this.catalogBasis(catalog.records),
                continuation?.publication ?? null,
              ]),
            ),
            catalog: catalog.catalog,
            conflictedProductIds: [
              ...new Set(
                [
                  ...catalog.records.products,
                  ...catalog.records.identifiers,
                  ...catalog.records.aliases,
                ]
                  .filter((r) => ["ERROR", "CONFLICT"].includes(r.syncState))
                  .map((r) =>
                    "productId" in r.entity ? r.entity.productId : r.entity.id,
                  ),
              ),
            ],
          });
          continue;
        }
      } catch (e) {
        if (signal?.aborted) throw e;
        results.push({
          itemId: file.id,
          filename: file.filename,
          status: "ERROR",
          code:
            e instanceof Error &&
            ["IMPORT_PRODUCT_CONFLICT", ...continuationCodes].includes(
              e.message,
            )
              ? e.message
              : "IMPORT_FILE_PENDING",
        });
      }
    }
    const report = { items: results };
    if (signal?.aborted) throw Error("IMPORT_CANCELLED");
    await this.recordStatus(message, preflight.batch.id, report);
    return report;
  }
  async resolve(
    message: CopilotMessage,
    review: Extract<ImportReport["items"][number], { status: "REVIEW" }>,
    choiceInput: z.input<typeof copilotImportResolutionChoiceSchema>,
    signal?: AbortSignal,
  ) {
    const choice = copilotImportResolutionChoiceSchema.parse(choiceInput);
    const { reference } = await this.proof(this.db, message);
    const phase =
      "overlap" in choice && choice.overlap === "KEEP_EXISTING"
        ? "KEEP"
        : "CHOICE";
    return this.write(
      message,
      review.itemId,
      phase,
      { basisHash: review.basisHash, choice },
      async (tx) => {
        const current = await this.preparation(tx, message).readValidated(
            reference.batchId,
            review.itemId,
            signal,
          ),
          catalog = await this.catalog(tx),
          pub = new MercalysImportPublicationRepository(
            joinedProductToolDatabase(tx),
            this.deps.id,
          ),
          overlap = current.continuation
            ? null
            : await pub.analyzeOverlap(this.scope.storeId, current.summary);
        if (
          (await this.deps.digest(
            JSON.stringify([
              current.item.checksum,
              current.summary,
              overlap,
              this.catalogBasis(catalog.records),
              current.continuation?.publication ?? null,
            ]),
          )) !== review.basisHash
        )
          throw Error("IMPORT_CHANGED");
        if ("overlap" in choice) {
          if (!overlap) throw Error("IMPORT_CHANGED");
          if (choice.overlap === "KEEP_EXISTING") {
            await pub.keepExisting({
              storeId: this.scope.storeId,
              filename: current.item.filename,
              checksum: current.item.checksum,
              summary: current.summary,
              reconciliation: overlap,
              actorUserId: this.scope.ownerId,
            });
            return {};
          }
          if (!overlap.safeToApply || overlap.rows.length > 2000)
            throw Error("IMPORT_AMBIGUOUS");
          const table =
            current.summary.sourceType === "MERCALYS_SALES"
              ? "sales_observations"
              : "waste_observations";
          for (const row of overlap.rows)
            for (const id of row.existingObservationIds) {
              const existing = await tx.getFirstAsync<{ sync_state: string }>(
                `SELECT sync_state FROM ${table} WHERE id=? AND store_id=?`,
                id,
                this.scope.storeId,
              );
              if (
                !existing ||
                ["ERROR", "CONFLICT"].includes(existing.sync_state)
              )
                throw Error("IMPORT_CONFLICT");
            }
          for (const id of overlap.priorSourceDocumentIds) {
            const existing = await tx.getFirstAsync<{ sync_state: string }>(
              "SELECT sync_state FROM source_documents WHERE id=? AND store_id=?",
              id,
              this.scope.storeId,
            );
            if (
              !existing ||
              ["ERROR", "CONFLICT"].includes(existing.sync_state)
            )
              throw Error("IMPORT_CONFLICT");
          }
          this.assertCatalog(
            catalog.records,
            current.summary.lines.flatMap((l) =>
              l.match.matchedProductId ? [l.match.matchedProductId] : [],
            ),
          );
          const result = await pub.publish({
            storeId: this.scope.storeId,
            filename: current.item.filename,
            localFileUri: current.localUri,
            sizeBytes: current.item.sizeBytes,
            checksum: current.item.checksum,
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            summary: current.summary,
            reconciliationApproval: {
              fingerprint: overlap.fingerprint,
              actorUserId: this.scope.ownerId,
            },
          });
          return {
            sourceDocumentId: result.sourceDocumentId,
            publishedCount: result.publishedCount,
            remainingCount: result.remainingCount,
            replacedCount: result.replacedCount,
          };
        }
        const resolution = buildMercalysProductResolutions(
          current.summary,
        ).find((r) => r.key === choice.resolutionKey);
        if (!resolution) throw Error("IMPORT_CHANGED");
        // This inline choice never moves an existing identifier away from another product.
        if (
          resolution.identifiers.some((i) =>
            catalog.catalog.identifiers.some(
              (e) =>
                e.type === i.type &&
                e.value === i.value &&
                e.productId !== choice.productId,
            ),
          )
        )
          throw Error("IMPORT_IDENTITY_CONFLICT");
        if (
          !resolution.identifiers.length &&
          catalog.catalog.aliases.some(
            (a) =>
              a.normalizedAlias === normalizeProductLabel(resolution.label) &&
              (a.productId !== choice.productId || a.status !== "VALIDATED"),
          )
        )
          throw Error("IMPORT_ALIAS_REVIEW_REQUIRED");
        const repository = new ProductMasterRepository(
          joinedProductToolDatabase(tx),
        );
        if (choice.productId) {
          const product = catalog.catalog.products.find(
            (p) => p.id === choice.productId && p.status === "ACTIVE",
          );
          if (
            !product ||
            (!choice.catalogueSelection &&
              !resolution.candidateProductIds.includes(product.id))
          )
            throw Error("IMPORT_CANDIDATE_INVALID");
          const blocker = mercalysProductTargetBlocker(
            this.scope.storeId,
            resolution,
            product.id,
            catalog.catalog,
          );
          if (blocker) throw Error(`IMPORT_${blocker}`);
          this.assertCatalog(catalog.records, [product.id]);
          await confirmMercalysProductMapping(
            repository,
            resolution,
            product.id,
            {
              ...this.scope,
              now: () => new Date().toISOString(),
              generateId: this.deps.id,
            },
          );
          return {
            mapping: {
              sourceLabel: resolution.label,
              sourceIndexes: resolution.sourceIndexes,
              identifiers: resolution.identifiers,
              productId: product.id,
              productLabel: product.label,
              selection: choice.catalogueSelection ? "CATALOGUE" : "SUGGESTION",
            },
          };
        } else {
          if (!resolution.canCreateAsDistinct)
            throw Error("IMPORT_IDENTITY_CONFLICT");
          await saveProductEditor(
            repository,
            {
              ...emptyProductDraft,
              label: resolution.label,
              identifiers: resolution.identifiers,
              ...importSourceClassification(resolution.label),
            },
            {
              ...this.scope,
              identifierSource: "MERCALYS",
              now: () => new Date().toISOString(),
              generateId: this.deps.id,
            },
          );
        }
        return {};
      },
      signal,
    );
  }
}
export type ImportReport = {
  items: Array<
    | { itemId: string; filename: string; status: "KEPT" }
    | {
        itemId: string;
        filename: string;
        status: "PUBLISHED";
        sourceDocumentId: string;
        alreadyPublished: boolean;
        completedPartial?: boolean;
        publishedCount?: number;
      }
    | { itemId: string; filename: string; status: "ERROR"; code: string }
    | {
        itemId: string;
        filename: string;
        status: "REVIEW";
        priorSourceDocumentId: string | null;
        publishedCount: number;
        summary: Awaited<
          ReturnType<MercalysBatchPreparation["readValidated"]>
        >["summary"];
        resolutions: Array<
          MercalysProductResolution & { sourceLabels: string[] }
        >;
        overlap: Awaited<
          ReturnType<MercalysImportPublicationRepository["analyzeOverlap"]>
        >;
        basisHash: string;
        catalog: ProductMatchCatalog;
        conflictedProductIds: string[];
      }
  >;
};
