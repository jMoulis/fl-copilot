import {
  readCopilotPreparationProposal,
  preparationBasisSchema,
  preparationIntent,
  preparationResultSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { verifyPrivateToolRecord } from "./private-tool-record";
import { CommercialPreparationRepository } from "../commercial/week-preparation-repository";
import { readCommercialChoices } from "../commercial/offer-choice-repository";
import { CopilotCommercialPreparationRuntime } from "./commercial-preparation-runtime";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
export class CopilotPreparationProposalController {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: {
      storeId: string;
      ownerId: string;
      deviceId: string;
      canPrepareCommercialWeek: boolean;
    },
    private digest: (s: string) => Promise<string>,
    private id: () => string,
  ) {}
  async open(raw: CopilotMessage) {
    const { message, content, request } = readCopilotPreparationProposal(raw);
    await verifyPrivateToolRecord(
      this.db,
      this.scope,
      message,
      content.assistantMessageId,
    );
    const previous = await this.db.getFirstAsync<{
      result_json: string;
      store_id: string;
      owner_id: string;
      conversation_id: string;
    }>("SELECT * FROM copilot_tool_results WHERE operation_id=?", message.id);
    if (previous) {
      const r = preparationResultSchema.parse(JSON.parse(previous.result_json));
      const { id, storeId, version, createdAt, updatedAt, ...draft } = r.after;
      void id;
      void storeId;
      void version;
      void createdAt;
      void updatedAt;
      if (
        previous.store_id !== message.storeId ||
        previous.owner_id !== message.ownerId ||
        previous.conversation_id !== message.conversationId ||
        r.operationId !== message.id ||
        r.userMessageId !== message.replyToMessageId ||
        JSON.stringify(draft) !== JSON.stringify(request.input.draft)
      )
        throw Error("PREPARATION_PROPOSAL_SCOPE");
      return { message, content, request, status: "COMPLETED" as const };
    }
    const prep = await new CommercialPreparationRepository(
      this.db,
      this.digest,
    ).get(this.scope.storeId, content.input.weekStart);
    const refs = content.basis.preparation.offerRefs;
    const choices = (await readCommercialChoices(this.db, this.scope.storeId))
      .filter((c) => refs.some((r) => r.choiceId === c.entity.id))
      .sort((a, b) => a.entity.id.localeCompare(b.entity.id));
    const current = prep
      ? preparationBasisSchema.parse({
          preparation: prep.entity,
          choices: choices.map((c) => c.entity),
        })
      : null;
    const expected = preparationBasisSchema.parse({
      ...content.basis,
      choices: [...content.basis.choices].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
    });
    const stale =
      JSON.stringify(current) !== JSON.stringify(expected) ||
      [prep, ...choices].some(
        (r) => r && ["ERROR", "CONFLICT"].includes(r.syncState),
      );
    return {
      message,
      content,
      request,
      status: stale ? ("STALE" as const) : ("READY" as const),
    };
  }
  async confirm(message: CopilotMessage, signal?: AbortSignal) {
    if (!this.scope.canPrepareCommercialWeek)
      throw Error("PREPARATION_PROPOSAL_FORBIDDEN");
    const state = await this.open(message);
    if (state.status === "COMPLETED") return state;
    if (state.status !== "READY") throw Error("PREPARATION_PROPOSAL_STALE");
    await new CopilotCommercialPreparationRuntime(
      this.db,
      this.digest,
      this.id,
    ).execute(
      state.request,
      {
        ...this.scope,
        conversationId: message.conversationId,
        userMessageId: message.replyToMessageId!,
        decisionLevel: "REVIEWED",
        authorizedRequestJson: preparationIntent(state.request),
      },
      signal,
    );
    return this.open(message);
  }
}
