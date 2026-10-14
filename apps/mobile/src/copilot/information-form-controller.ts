import { informationQuestionBasis } from "./information-question-basis";
import {
  CopilotFormError,
  readCopilotInformationRequest,
  copilotMessageSchema,
  type CopilotMessage,
  type CopilotFormAnswers,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { verifyPrivateToolRecord } from "./private-tool-record";
import { CopilotFormRepository } from "./form-repository";
import { CopilotFormSubmissionService } from "./form-submission-service";
import {
  CopilotFormCardController,
  CopilotFormCardActionError,
} from "./form-card-controller";
import type { CopilotFormCardAction } from "./inline-form-card";
export class CopilotInformationFormController {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private actor: { storeId: string; ownerId: string; deviceId: string },
    private id: () => string,
  ) {}
  private scope(conversationId: string) {
    return {
      storeId: this.actor.storeId,
      ownerId: this.actor.ownerId,
      conversationId,
      canReadStore: true,
    };
  }
  private serial<T>(work: () => Promise<T>) {
    const task = this.tail.then(work);
    this.tail = task.catch(() => undefined);
    return task;
  }
  async open(raw: CopilotMessage) {
    const artifact = readCopilotInformationRequest(raw);
    await verifyPrivateToolRecord(
      this.db,
      this.actor,
      artifact.message,
      artifact.content.assistantMessageId,
    );
    const scope = this.scope(artifact.message.conversationId),
      repo = new CopilotFormRepository(this.db);
    let form = await repo.create(artifact.definition, scope);
    const response = await this.db.getFirstAsync<{
      payload_json: string;
      sync_state: string;
    }>(
      "SELECT payload_json,sync_state FROM copilot_messages WHERE store_id=? AND owner_id=? AND conversation_id=? AND json_extract(payload_json,'$.role')='USER' AND json_extract(payload_json,'$.replyToMessageId')=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
      scope.storeId,
      scope.ownerId,
      scope.conversationId,
      artifact.message.id,
    );
    const responseMessage = response
      ? copilotMessageSchema.parse(JSON.parse(response.payload_json))
      : null;
    if (
      responseMessage &&
      (responseMessage.storeId !== scope.storeId ||
        responseMessage.ownerId !== scope.ownerId ||
        responseMessage.conversationId !== scope.conversationId ||
        responseMessage.replyToMessageId !== artifact.message.id)
    )
      throw Error("COPILOT_INFORMATION_BINDING_INVALID");
    const basis = await this.basis(artifact.message);
    if (
      !responseMessage &&
      !["ANSWERED", "CANCELLED", "STALE"].includes(form.status) &&
      basis !== form.definition.basisToken
    )
      form = (
        await repo.edit(
          {
            id: form.definition.id,
            expectedVersion: form.version,
            action: "SAVE",
            answers: form.answers,
          },
          scope,
          basis,
        )
      ).form;
    return {
      form,
      responseMessage,
      responseSyncState: response?.sync_state ?? null,
    };
  }
  private basis(message: CopilotMessage) {
    return informationQuestionBasis(
      this.db,
      this.scope(message.conversationId),
      readCopilotInformationRequest(message).definition,
    );
  }
  save(
    message: CopilotMessage,
    answers: CopilotFormAnswers,
    signal?: AbortSignal,
  ) {
    return this.serial(async () => {
      const state = await this.open(message);
      if (
        state.responseMessage ||
        ["ANSWERED", "STALE", "CANCELLED"].includes(state.form.status)
      )
        return state;
      const repo = new CopilotFormRepository(this.db);
      await repo.edit(
        {
          id: state.form.definition.id,
          expectedVersion: state.form.version,
          action: "SAVE",
          answers,
        },
        this.scope(message.conversationId),
        await this.basis(message),
        signal,
      );
      return this.open(message);
    });
  }
  perform(
    message: CopilotMessage,
    action: CopilotFormCardAction,
    answers: CopilotFormAnswers,
    signal?: AbortSignal,
  ) {
    return this.serial(async () => {
      const state = await this.open(message);
      if (state.responseMessage) return state;
      const repo = new CopilotFormRepository(this.db),
        submission = new CopilotFormSubmissionService(
          this.db,
          this.id,
          undefined,
          { scheduleReply: true, replyToTool: true },
        );
      const result = await new CopilotFormCardController(repo, submission, () =>
        this.basis(message),
      ).perform(
        action,
        state.form,
        answers,
        this.scope(message.conversationId),
        { deviceId: this.actor.deviceId, canSubmitForm: true },
        signal,
      );
      if (action === "SUBMIT" && !result.submission && result.issues.length)
        throw new CopilotFormCardActionError(
          result.form,
          new CopilotFormError("NOT_READY", result.issues),
        );
      return this.open(message);
    });
  }
}
