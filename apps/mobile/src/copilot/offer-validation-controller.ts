import {
  readCopilotOfferValidationProposal,
  offerValidationReviewedSources,
  offerValidationIntent,
  offerValidationResultSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
import {
  commercialValidatedOfferId,
  commercialValidatedOfferSameBusiness,
  commercialOfferValidationReviewData,
  projectCommercialSourceOffer,
  commercialChoiceProductUnitMatches,
} from "@fl-copilot/commercial-core";
import {
  synchronizedCommercialVisualReadingSchema,
  commercialValidatedOfferSchema,
} from "@fl-copilot/sync-contracts";
import { verifyPrivateToolRecord } from "./private-tool-record";
import { ProductMasterRepository } from "../products/product-master-repository";
import { CommercialChoiceRepository } from "../commercial/offer-choice-repository";
import { CopilotOfferValidationRuntime } from "./offer-validation-runtime";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
export class CopilotOfferValidationController {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: {
      storeId: string;
      ownerId: string;
      deviceId: string;
      canValidateCommercialOffers: boolean;
    },
    private digest: (s: string) => Promise<string>,
    private id: () => string,
  ) {}
  async open(raw: CopilotMessage) {
    const { message, content, request } =
      readCopilotOfferValidationProposal(raw);
    await verifyPrivateToolRecord(
      this.db,
      this.scope,
      message,
      content.assistantMessageId,
    );
    const ids = await Promise.all(
      content.basis.entries.map((e) =>
        commercialValidatedOfferId(
          this.scope.storeId,
          e.choice.id,
          e.choice.version,
          this.digest,
        ),
      ),
    );
    const journal = await this.db.getFirstAsync<{
      result_json: string;
      store_id: string;
      owner_id: string;
      conversation_id: string;
    }>("SELECT * FROM copilot_tool_results WHERE operation_id=?", message.id);
    if (journal) {
      const result = offerValidationResultSchema.parse(
        JSON.parse(journal.result_json),
      );
      if (
        journal.store_id !== message.storeId ||
        journal.owner_id !== message.ownerId ||
        journal.conversation_id !== message.conversationId ||
        result.operationId !== message.id ||
        result.userMessageId !== message.replyToMessageId ||
        result.validations.length !== content.basis.entries.length ||
        result.validations.some((v, i) => {
          const e = content.basis.entries[i]!;
          return (
            v.entity.id !== ids[i] ||
            v.entity.storeId !== message.storeId ||
            JSON.stringify(v.entity.choice) !== JSON.stringify(e.choice) ||
            !commercialValidatedOfferSameBusiness(v.entity, {
              ...v.entity,
              ...commercialOfferValidationReviewData(e.offer),
            }) ||
            (e.validation !== null &&
              (JSON.stringify(v.entity) !== JSON.stringify(e.validation) ||
                v.commandId !== null))
          );
        })
      )
        throw Error("OFFER_VALIDATION_SCOPE");
      return { message, content, request, status: "COMPLETED" as const };
    }
    let stale = false;
    for (const [i, e] of content.basis.entries.entries()) {
      const choice = await new CommercialChoiceRepository(
          this.db,
          this.digest,
        ).get(this.scope.storeId, e.choice.id),
        product = await new ProductMasterRepository(this.db).getProduct(
          e.product.id,
        ),
        pageRow = await this.db.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM commercial_visual_readings WHERE id=? AND store_id=?",
          e.choice.source.readingId,
          this.scope.storeId,
        ),
        validationRow = await this.db.getFirstAsync<{
          payload_json: string;
          sync_state: string;
        }>(
          "SELECT payload_json,sync_state FROM commercial_validated_offers WHERE id=? AND store_id=?",
          ids[i]!,
          this.scope.storeId,
        );
      if (
        !choice ||
        ["ERROR", "CONFLICT"].includes(choice.syncState) ||
        JSON.stringify(choice.entity) !== JSON.stringify(e.choice) ||
        !product ||
        ["ERROR", "CONFLICT"].includes(product.syncState) ||
        JSON.stringify(product.entity) !== JSON.stringify(e.product) ||
        !commercialChoiceProductUnitMatches(e.choice, e.product.salesUnit) ||
        !pageRow
      ) {
        stale = true;
        break;
      }
      try {
        const page = synchronizedCommercialVisualReadingSchema.parse(
          JSON.parse(pageRow.payload_json),
        );
        if (
          page.status !== "READY" ||
          page.storeId !== this.scope.storeId ||
          JSON.stringify(
            projectCommercialSourceOffer(
              page,
              e.choice.source.operationIndex,
              e.choice.source.itemIndex,
            ),
          ) !== JSON.stringify(e.offer) ||
          JSON.stringify(
            validationRow
              ? commercialValidatedOfferSchema.parse(
                  JSON.parse(validationRow.payload_json),
                )
              : null,
          ) !== JSON.stringify(e.validation) ||
          (validationRow &&
            ["ERROR", "CONFLICT"].includes(validationRow.sync_state))
        ) {
          stale = true;
          break;
        }
      } catch {
        stale = true;
        break;
      }
    }
    return {
      message,
      content,
      request,
      status: stale ? ("STALE" as const) : ("READY" as const),
    };
  }
  async confirm(
    message: CopilotMessage,
    sourceReviewed: boolean,
    signal?: AbortSignal,
  ) {
    if (!this.scope.canValidateCommercialOffers)
      throw Error("OFFER_VALIDATION_FORBIDDEN");
    if (sourceReviewed !== true)
      throw Error("OFFER_VALIDATION_REVIEW_REQUIRED");
    const state = await this.open(message);
    if (state.status === "COMPLETED") return state;
    if (state.status !== "READY") throw Error("OFFER_VALIDATION_STALE");
    await new CopilotOfferValidationRuntime(
      this.db,
      this.digest,
      this.id,
    ).execute(
      state.request,
      {
        ...this.scope,
        conversationId: message.conversationId,
        userMessageId: message.replyToMessageId!,
        authorizedRequestJson: offerValidationIntent(state.request),
        decisionLevel: "REVIEWED",
        reviewedSources: offerValidationReviewedSources(state.content.basis),
      },
      signal,
    );
    return this.open(message);
  }
}
