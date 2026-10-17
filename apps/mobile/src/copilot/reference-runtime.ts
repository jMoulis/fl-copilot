import {
  commercialVersionDecisionSchema,
  referenceSaveRequestSchema,
  referenceSaveAuthoritySchema,
  referenceSaveResultSchema,
  referenceDesiredValue,
  readCopilotReferenceProposal,
  type ReferenceSaveAuthority,
  type copilotReferenceBasisSchema,
  ProductClassificationError,
} from "@fl-copilot/domain";
import type { z } from "zod";
import { synchronizedCommercialVisualReadingSchema } from "@fl-copilot/sync-contracts";
import {
  commercialVersionDecisionId,
  commercialVersionDecisionSnapshotsValid,
  compareCommercialDocumentVersions,
} from "@fl-copilot/commercial-core";
import { CommercialVersionDecisionRepository } from "../commercial/version-decision-repository";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  runReviewedStoreOperation,
  joinedProductToolDatabase,
} from "./product-tool-transaction";
import { verifyPrivateToolRecord } from "./private-tool-record";
export async function referenceReviewIsCurrent(
  db: OutboxDatabase,
  basis: z.infer<typeof copilotReferenceBasisSchema>,
) {
  const ids = [
      ...basis.sources.before.readingIds,
      ...basis.sources.after.readingIds,
    ],
    rows = await db.getAllAsync<{ payload_json: string }>(
      `SELECT payload_json FROM commercial_visual_readings WHERE store_id=? AND id IN (${ids.map(() => "?").join(",")})`,
      basis.storeId,
      ...ids,
    ),
    pages = rows.map((r) =>
      synchronizedCommercialVisualReadingSchema.parse(
        JSON.parse(r.payload_json),
      ),
    );
  if (
    !commercialVersionDecisionSnapshotsValid(
      { storeId: basis.storeId, ...basis.sources },
      pages,
    )
  )
    return false;
  const comparison = compareCommercialDocumentVersions({
    storeId: basis.storeId,
    beforeDocumentId: basis.sources.before.documentId,
    afterDocumentId: basis.sources.after.documentId,
    before: pages.filter((p) => basis.sources.before.readingIds.includes(p.id)),
    after: pages.filter((p) => basis.sources.after.readingIds.includes(p.id)),
  });
  return (
    JSON.stringify(comparison.counts) === JSON.stringify(basis.counts) &&
    pages.reduce((n, p) => n + (p.reading?.warnings.length ?? 0), 0) ===
      basis.warningCount
  );
}
export class CopilotReferenceRuntime {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private digest: (s: string) => Promise<string>,
    private id: () => string,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async execute(
    raw: unknown,
    rawAuthority: ReferenceSaveAuthority,
    signal?: AbortSignal,
  ) {
    const parsed = referenceSaveRequestSchema.safeParse(raw),
      authority = referenceSaveAuthoritySchema.safeParse(rawAuthority);
    if (!parsed.success) throw new ProductClassificationError("INVALID_INPUT");
    if (!authority.success || !authority.data.comparisonReviewed)
      throw new ProductClassificationError("FORBIDDEN");
    const request = parsed.data,
      { canManageCommercialReferences, comparisonReviewed, ...scope } =
        authority.data;
    void comparisonReviewed;
    return runReviewedStoreOperation(
      this.db,
      request,
      { ...scope, canExecute: canManageCommercialReferences },
      referenceSaveResultSchema,
      async (tx, ctx) => {
        const record = await tx.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
          request.operationId,
          ctx.storeId,
          ctx.ownerId,
          ctx.conversationId,
        );
        if (!record)
          throw new ProductClassificationError(
            "COMMERCIAL_REFERENCE_REVIEW_REQUIRED",
          );
        const artifact = readCopilotReferenceProposal(
          JSON.parse(record.payload_json),
        );
        await verifyPrivateToolRecord(
          tx,
          ctx,
          artifact.message,
          artifact.content.assistantMessageId,
        );
        if (
          artifact.message.replyToMessageId !== ctx.userMessageId ||
          JSON.stringify(artifact.request) !== JSON.stringify(request)
        )
          throw new ProductClassificationError("FORBIDDEN");
        const { intent, basis } = request.input;
        if (basis.storeId !== ctx.storeId)
          throw new ProductClassificationError("FORBIDDEN");
        const repo = new CommercialVersionDecisionRepository(
            joinedProductToolDatabase(tx),
            this.digest,
          ),
          before = await repo.get(
            ctx.storeId,
            intent.beforeDocumentId,
            intent.afterDocumentId,
          );
        if (before && ["ERROR", "CONFLICT"].includes(before.syncState))
          throw new ProductClassificationError("SYNC_CONFLICT");
        if (
          JSON.stringify(before?.entity ?? null) !==
          JSON.stringify(basis.previous)
        )
          throw new ProductClassificationError("VERSION_CONFLICT");
        if (!(await referenceReviewIsCurrent(tx, basis)))
          throw new ProductClassificationError(
            "COMMERCIAL_REFERENCE_REVIEW_REQUIRED",
          );
        const appliedAt = this.now(),
          after = commercialVersionDecisionSchema.parse({
            ...referenceDesiredValue(intent, basis),
            id:
              before?.entity.id ??
              (await commercialVersionDecisionId(
                ctx.storeId,
                intent.beforeDocumentId,
                intent.afterDocumentId,
                this.digest,
              )),
            version: (before?.entity.version ?? 0) + 1,
            createdAt: before?.entity.createdAt ?? appliedAt,
            updatedAt: appliedAt,
          }),
          commandId = this.id();
        await repo.save(after, { commandId, deviceId: ctx.deviceId });
        return {
          operationId: request.operationId,
          schemaVersion: 1 as const,
          tool: request.tool,
          status: "COMPLETED" as const,
          userMessageId: ctx.userMessageId,
          appliedAt,
          before: before?.entity ?? null,
          after,
          commandId,
          syncState: "PENDING" as const,
          message:
            "Choix de référence enregistré localement. Offres retenues, TG, plans et exécutions conservés ; leur revue reste distincte.",
        };
      },
      signal,
    );
  }
}
