import { z } from "zod";
import {
  readStoreLayoutScenarioCard,
  type CopilotMessage,
  type CommercialWeekPreparation,
} from "@fl-copilot/domain";
import {
  preparePhysicalAllocationDraft,
  commercialWeekPreparationId,
} from "@fl-copilot/commercial-core";
import { verifyPrivateToolRecord } from "./private-tool-record";
import { CommercialPreparationRepository } from "../commercial/week-preparation-repository";
import { assertLocalPhysicalAllocation } from "../commercial/physical-allocation-sources";
import { joinedProductToolDatabase } from "./product-tool-transaction";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
const resultSchema = z.strictObject({
  kind: z.literal("LAYOUT_PREPARATION_LINK"),
  operationId: z.uuid(),
  userMessageId: z.uuid(),
  appliedAt: z.iso.datetime(),
  preparationId: z.uuid(),
  preparationVersion: z.number().int().positive(),
  commandId: z.uuid(),
});
export class LayoutPreparationController {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: {
      storeId: string;
      ownerId: string;
      deviceId: string;
      canPrepareCommercialWeek: boolean;
    },
    private digest: (s: string) => Promise<string>,
    private uuid: () => string,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  private async inspect(tx: OutboxDatabase, raw: CopilotMessage) {
    const { message, content } = readStoreLayoutScenarioCard(raw),
      s = content.scenario;
    await verifyPrivateToolRecord(
      tx,
      this.scope,
      message,
      content.assistantMessageId,
    );
    const result = await tx.getFirstAsync<{
      store_id: string;
      owner_id: string;
      conversation_id: string;
      request_json: string;
      result_json: string;
    }>("SELECT * FROM copilot_tool_results WHERE operation_id=?", message.id);
    const repo = new CommercialPreparationRepository(
        joinedProductToolDatabase(tx),
        this.digest,
      ),
      before = await repo.get(this.scope.storeId, s.weekStart);
    if (result) {
      const value = resultSchema.parse(JSON.parse(result.result_json));
      if (
        result.store_id !== this.scope.storeId ||
        result.owner_id !== this.scope.ownerId ||
        result.conversation_id !== message.conversationId ||
        result.request_json !== message.text ||
        value.operationId !== message.id ||
        value.userMessageId !== message.replyToMessageId ||
        value.preparationId !==
          (await commercialWeekPreparationId(
            this.scope.storeId,
            s.weekStart,
            this.digest,
          ))
      )
        throw Error("PHYSICAL_ALLOCATION_RESULT_INVALID");
      return {
        status: "COMPLETED" as const,
        message,
        before: before?.entity ?? null,
        result: value,
      };
    }
    if (!this.scope.canPrepareCommercialWeek)
      throw Error("PHYSICAL_ALLOCATION_FORBIDDEN");
    if (before && ["ERROR", "CONFLICT"].includes(before.syncState))
      throw Error("PHYSICAL_ALLOCATION_SYNC_CONFLICT");
    await assertLocalPhysicalAllocation(tx, this.scope.storeId, s);
    const after = preparePhysicalAllocationDraft(s, before?.entity ?? null, {
      id: await commercialWeekPreparationId(
        this.scope.storeId,
        s.weekStart,
        this.digest,
      ),
      now: this.now(),
    });
    return {
      status: "READY" as const,
      message,
      before: before?.entity ?? null,
      after,
    };
  }
  async open(raw: CopilotMessage) {
    let state:
      Awaited<ReturnType<LayoutPreparationController["inspect"]>> | undefined;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      state = await this.inspect(tx, raw);
    });
    if (!state) throw Error("PHYSICAL_ALLOCATION_UNAVAILABLE");
    return state;
  }
  async confirm(
    raw: CopilotMessage,
    expected: CommercialWeekPreparation | null,
    signal?: AbortSignal,
  ) {
    if (!this.scope.canPrepareCommercialWeek)
      throw Error("PHYSICAL_ALLOCATION_FORBIDDEN");
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      if (signal?.aborted) throw Error("CANCELLED");
      const state = await this.inspect(tx, raw);
      if (state.status === "COMPLETED") return;
      if (JSON.stringify(state.before) !== JSON.stringify(expected))
        throw Error("PHYSICAL_ALLOCATION_PREPARATION_CHANGED");
      const commandId = this.uuid(),
        appliedAt = this.now(),
        after = { ...state.after, updatedAt: appliedAt };
      await new CommercialPreparationRepository(
        joinedProductToolDatabase(tx),
        this.digest,
      ).save(after, { commandId, deviceId: this.scope.deviceId });
      const value = resultSchema.parse({
        kind: "LAYOUT_PREPARATION_LINK",
        operationId: raw.id,
        userMessageId: raw.replyToMessageId,
        appliedAt,
        preparationId: after.id,
        preparationVersion: after.version,
        commandId,
      });
      await tx.runAsync(
        "INSERT INTO copilot_tool_results(operation_id,store_id,owner_id,conversation_id,request_json,result_json,created_at) VALUES(?,?,?,?,?,?,?)",
        raw.id,
        this.scope.storeId,
        this.scope.ownerId,
        raw.conversationId,
        raw.text,
        JSON.stringify(value),
        appliedAt,
      );
      if (signal?.aborted) throw Error("CANCELLED");
    });
    return this.open(raw);
  }
}
