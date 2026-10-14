import { informationQuestionBasis } from "./information-question-basis";
import {
  copilotFormSubmitRequestSchema,
  copilotFormSubmitAuthoritySchema,
  copilotFormSchema,
  copilotMessageSchema,
  readCopilotInformationRequest,
  CopilotToolError,
  CopilotFormError,
  type CopilotFormSubmitAuthority,
  type CopilotMessage,
  type CopilotForm,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  authorizeCopilotFormScope,
  readScopedCopilotForm,
  evaluateSavedCopilotForm,
} from "./form-repository";
import { joinedProductToolDatabase } from "./product-tool-transaction";
import { CopilotConversationRepository } from "./conversation-repository";
export type CopilotFormSubmission = {
  form: CopilotForm;
  message: CopilotMessage;
  syncState: string;
};
/** A submitted response is a conversation message, not business mutation authority. */
export class CopilotFormSubmissionService {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private generateId: () => string,
    private now: () => string = () => new Date().toISOString(),
    private options: { scheduleReply?: boolean; replyToTool?: boolean } = {},
  ) {}
  async submit(
    raw: unknown,
    rawAuthority: CopilotFormSubmitAuthority,
    signal?: AbortSignal,
  ): Promise<CopilotFormSubmission> {
    const parsed = copilotFormSubmitRequestSchema.safeParse(raw),
      authority = copilotFormSubmitAuthoritySchema.safeParse(rawAuthority);
    if (!parsed.success) throw new CopilotToolError("INVALID_INPUT");
    if (
      !authority.success ||
      !authority.data.canReadStore ||
      !authority.data.canSubmitForm
    )
      throw new CopilotToolError("FORBIDDEN");
    const input = parsed.data,
      ctx = authority.data;
    if (
      ctx.confirmedFormId !== input.formId ||
      ctx.confirmedFormVersion !== input.expectedVersion
    )
      throw new CopilotToolError("FORBIDDEN");
    let result: CopilotFormSubmission | undefined;
    try {
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        if (signal?.aborted) throw new CopilotToolError("CANCELLED");
        const scope = await authorizeCopilotFormScope(tx, {
            storeId: ctx.storeId,
            ownerId: ctx.ownerId,
            conversationId: ctx.conversationId,
            canReadStore: ctx.canReadStore,
          }),
          row = await readScopedCopilotForm(tx, input.formId, scope);
        if (!row) throw new CopilotToolError("FORBIDDEN");
        const before = row.form;
        const replyToMessageId = this.options.replyToTool
          ? before.definition.id
          : before.definition.parentUserMessageId;
        if (this.options.replyToTool) {
          const source = await tx.getFirstAsync<{
            payload_json: string;
            sync_state: string;
          }>(
            "SELECT payload_json,sync_state FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
            before.definition.id,
            ctx.storeId,
            ctx.ownerId,
            ctx.conversationId,
          );
          if (!source || source.sync_state !== "SYNCED")
            throw new CopilotToolError("FORBIDDEN");
          const artifact = readCopilotInformationRequest(
            JSON.parse(source.payload_json),
          );
          if (
            JSON.stringify(artifact.definition) !==
            JSON.stringify(before.definition)
          )
            throw new CopilotToolError("FORBIDDEN");
          if (
            before.status !== "ANSWERED" &&
            (await informationQuestionBasis(tx, scope, before.definition)) !==
              before.definition.basisToken
          )
            throw new CopilotFormError("STALE");
        }

        if (
          before.definition.basisToken !== ctx.currentBasisToken ||
          before.status === "STALE"
        )
          throw new CopilotFormError("STALE");
        if (before.status === "ANSWERED") {
          const saved = before.submission;
          if (!saved || saved.fromVersion !== input.expectedVersion)
            throw new CopilotFormError("VERSION_CONFLICT");
          const m = await tx.getFirstAsync<{
            payload_json: string;
            sync_state: string;
          }>(
            "SELECT payload_json,sync_state FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
            saved.messageId,
            ctx.storeId,
            ctx.ownerId,
            ctx.conversationId,
          );
          if (!m) throw new CopilotToolError("UNAVAILABLE");
          const message = copilotMessageSchema.parse(
            JSON.parse(m.payload_json),
          );
          if (
            message.id !== saved.messageId ||
            message.storeId !== ctx.storeId ||
            message.ownerId !== ctx.ownerId ||
            message.conversationId !== ctx.conversationId ||
            message.role !== "USER" ||
            message.replyToMessageId !== replyToMessageId
          )
            throw new CopilotToolError("FORBIDDEN");
          result = { form: before, message, syncState: m.sync_state };
          return;
        }
        if (before.version !== input.expectedVersion)
          throw new CopilotFormError("VERSION_CONFLICT");
        const evaluation = await evaluateSavedCopilotForm(tx, before);
        if (before.status !== "READY" || !evaluation.ready)
          throw new CopilotFormError("NOT_READY", evaluation.issues);
        const normalized = evaluation.normalized,
          lines: string[] = [],
          attachments = new Map<
            string,
            CopilotMessage["attachments"][number]
          >();
        for (const field of before.definition.fields) {
          const value = normalized[field.key];
          if (value === undefined || value === null) continue;
          let display: string;
          if (typeof value !== "string") {
            display = value.filename;
            attachments.set(value.sourceDocumentId, value);
          } else if (field.type === "CHOICE")
            display = field.options.find((o) => o.id === value)!.label;
          else if (field.type === "DATE")
            display = value.split("-").reverse().join("/");
          else if (field.type === "NUMBER")
            display =
              value.replace(".", ",") +
              (field.unit === "NONE" ? "" : " " + field.unit);
          else display = value;
          lines.push(field.label + " : " + display);
        }
        const answeredAt = this.now(),
          message = copilotMessageSchema.parse({
            id: this.generateId(),
            storeId: ctx.storeId,
            ownerId: ctx.ownerId,
            conversationId: ctx.conversationId,
            role: "USER",
            text:
              "Réponse — " + before.definition.title + "\n" + lines.join("\n"),
            attachments: [...attachments.values()],
            replyToMessageId,
            supersedesMessageId: null,
            version: 1,
            createdAt: answeredAt,
          }),
          commandId = this.generateId();
        await new CopilotConversationRepository(
          joinedProductToolDatabase(tx),
          scope,
        ).append(message, {
          commandId,
          deviceId: ctx.deviceId,
          preserveDraft: true,
          ...(this.options.scheduleReply ? { replyId: this.generateId() } : {}),
        });
        const form = copilotFormSchema.parse({
          ...before,
          status: "ANSWERED",
          version: before.version + 1,
          updatedAt: answeredAt,
          submission: {
            messageId: message.id,
            commandId,
            fromVersion: before.version,
            answeredAt,
            normalized,
          },
        });
        await tx.runAsync(
          "UPDATE copilot_forms SET payload_json=?,updated_at=? WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
          JSON.stringify(form),
          answeredAt,
          input.formId,
          ctx.storeId,
          ctx.ownerId,
          ctx.conversationId,
        );
        if (signal?.aborted) throw new CopilotToolError("CANCELLED");
        result = { form, message, syncState: "PENDING" };
      });
    } catch (e) {
      if (e instanceof CopilotToolError || e instanceof CopilotFormError)
        throw e;
      throw new CopilotToolError("UNAVAILABLE");
    }
    if (!result) throw new CopilotToolError("UNAVAILABLE");
    return result;
  }
}
