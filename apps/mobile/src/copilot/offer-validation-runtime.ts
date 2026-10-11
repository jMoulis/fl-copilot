import {
  offerValidationRequestSchema,
  offerValidationAuthoritySchema,
  offerValidationResultSchema,
  ProductClassificationError,
  type OfferValidationAuthority,
} from "@fl-copilot/domain";
import { commercialValidatedOfferId } from "@fl-copilot/commercial-core";
import {
  ValidatedOfferRepository,
  readValidatedOffers,
} from "../commercial/validated-offer-repository";
import { CommercialChoiceRepository } from "../commercial/offer-choice-repository";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  runReviewedStoreOperation,
  joinedProductToolDatabase,
  productToolRepository,
} from "./product-tool-transaction";
/** Source-review attestations are trusted application context, never model arguments. */
export class CopilotOfferValidationRuntime {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private digest: (text: string) => Promise<string>,
    private generateId: () => string,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async execute(
    raw: unknown,
    rawAuthority: OfferValidationAuthority,
    signal?: AbortSignal,
  ) {
    const parsed = offerValidationRequestSchema.safeParse(raw),
      authority = offerValidationAuthoritySchema.safeParse(rawAuthority);
    if (!parsed.success) throw new ProductClassificationError("INVALID_INPUT");
    if (!authority.success) throw new ProductClassificationError("FORBIDDEN");
    const request = parsed.data,
      { canValidateCommercialOffers, reviewedSources, ...scope } =
        authority.data,
      selection = request.input.selection;
    if (
      reviewedSources.length !== selection.length ||
      new Set(reviewedSources.map((r) => r.choiceId)).size !==
        selection.length ||
      selection.some(
        (r) =>
          !reviewedSources.some(
            (v) =>
              v.choiceId === r.choiceId && v.choiceVersion === r.choiceVersion,
          ),
      )
    )
      throw new ProductClassificationError("COMMERCIAL_SOURCE_REVIEW_REQUIRED");
    const result = await runReviewedStoreOperation(
      this.db,
      request,
      { ...scope, canExecute: canValidateCommercialOffers },
      offerValidationResultSchema,
      async (tx, ctx) => {
        const db = joinedProductToolDatabase(tx),
          choices = new CommercialChoiceRepository(db, this.digest),
          previous = await readValidatedOffers(tx, ctx.storeId),
          appliedAt = this.now(),
          ids: string[] = [],
          commandIds = selection.map(() => this.generateId());
        for (const ref of selection) {
          const c = await choices.get(ctx.storeId, ref.choiceId);
          if (!c || c.entity.status !== "RETAINED")
            throw new ProductClassificationError(
              "COMMERCIAL_CHOICE_UNAVAILABLE",
            );
          if (["ERROR", "CONFLICT"].includes(c.syncState))
            throw new ProductClassificationError("SYNC_CONFLICT");
          if (c.entity.version !== ref.choiceVersion)
            throw new ProductClassificationError("VERSION_CONFLICT");
          const reviewed = reviewedSources.find(
            (r) => r.choiceId === ref.choiceId,
          )!;
          if (
            reviewed.readingId !== c.entity.source.readingId ||
            reviewed.checksum !== c.entity.source.checksum
          )
            throw new ProductClassificationError(
              "COMMERCIAL_SOURCE_REVIEW_REQUIRED",
            );
          const product = await productToolRepository(tx).getProduct(
            c.entity.productId,
          );
          if (
            !product ||
            product.entity.storeId !== ctx.storeId ||
            product.entity.status !== "ACTIVE" ||
            product.entity.deletedAt
          )
            throw new ProductClassificationError("PRODUCT_UNAVAILABLE");
          if (["ERROR", "CONFLICT"].includes(product.syncState))
            throw new ProductClassificationError("SYNC_CONFLICT");
          if (product.entity.version !== ref.productVersion)
            throw new ProductClassificationError("VERSION_CONFLICT");
          const id = await commercialValidatedOfferId(
              ctx.storeId,
              ref.choiceId,
              ref.choiceVersion,
              this.digest,
            ),
            old = previous.find((v) => v.entity.id === id);
          if (old && ["ERROR", "CONFLICT"].includes(old.syncState))
            throw new ProductClassificationError("SYNC_CONFLICT");
          ids.push(id);
        }
        try {
          await new ValidatedOfferRepository(db, this.digest).validate(
            ctx.storeId,
            selection,
            { commandIds, deviceId: ctx.deviceId, createdAt: appliedAt },
          );
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "COMMERCIAL_VALIDATION_SOURCE_INVALID"
          )
            throw new ProductClassificationError("COMMERCIAL_SOURCE_INVALID");
          if (
            error instanceof Error &&
            error.message === "COMMERCIAL_VALIDATION_IMMUTABLE"
          )
            throw new ProductClassificationError(
              "COMMERCIAL_SOURCE_REVIEW_REQUIRED",
            );
          throw error;
        }
        const saved = await readValidatedOffers(tx, ctx.storeId);
        return {
          operationId: request.operationId,
          schemaVersion: 1 as const,
          tool: request.tool,
          status: "COMPLETED" as const,
          userMessageId: ctx.userMessageId,
          appliedAt,
          validations: ids.map((id, i) => {
            const record = saved.find((r) => r.entity.id === id);
            if (!record) throw new ProductClassificationError("UNAVAILABLE");
            return {
              entity: record.entity,
              commandId: previous.some((r) => r.entity.id === id)
                ? null
                : commandIds[i]!,
              syncState: record.syncState,
            };
          }),
          message:
            "Versions d’offres validées localement. Les validations existantes sont conservées ; aucun plan ni exécution en rayon n’a été enregistré.",
        };
      },
      signal,
    );
    if (
      result.validations.some(
        (v) =>
          !reviewedSources.some(
            (r) =>
              r.choiceId === v.entity.choice.id &&
              r.choiceVersion === v.entity.choice.version &&
              r.readingId === v.entity.choice.source.readingId &&
              r.checksum === v.entity.choice.source.checksum,
          ),
      )
    )
      throw new ProductClassificationError("COMMERCIAL_SOURCE_REVIEW_REQUIRED");
    return result;
  }
}
