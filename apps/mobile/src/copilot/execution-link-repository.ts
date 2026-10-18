import { legacyCommercialExecution } from "@fl-copilot/domain";
import {
  copilotExecutionLinkSchema,
  sameExecutionLinkIdentity,
  readExecutionLinkProposal,
  recommendationDecisionSchema,
  recommendationTrackingIdentityPayload,
  type CopilotMessage,
} from "@fl-copilot/domain";
import {
  commercialExecutionChecklist,
  commercialExecutionSameTarget,
} from "@fl-copilot/commercial-core";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import { joinedProductToolDatabase } from "./product-tool-transaction";
import { verifyPrivateToolRecord } from "./private-tool-record";
import { CommercialPlanRepository } from "../commercial/week-plan-repository";
type Scope = { storeId: string; ownerId: string };
type Row = {
  store_id: string;
  owner_id: string;
  payload_json: string;
  remote_payload_json: string | null;
  remote_version: number | null;
  sync_state: string;
  dirty: number;
};
function scoped(e: Scope, s: Scope) {
  if (e.storeId !== s.storeId || e.ownerId !== s.ownerId)
    throw Error("COPILOT_EXECUTION_LINK_SCOPE_INVALID");
}
export async function applyExecutionLinkRecord(
  db: OutboxDatabase,
  scope: Scope,
  payload: unknown,
  ackVersion?: number,
) {
  const e = copilotExecutionLinkSchema.parse(payload);
  scoped(e, scope);
  const old = await db.getFirstAsync<Row>(
    "SELECT * FROM copilot_execution_links WHERE id=?",
    e.id,
  );
  if (old) {
    scoped({ storeId: old.store_id, ownerId: old.owner_id }, scope);
    if (
      !sameExecutionLinkIdentity(
        copilotExecutionLinkSchema.parse(JSON.parse(old.payload_json)),
        e,
      )
    )
      throw Error("COPILOT_EXECUTION_LINK_IDENTITY_INVALID");
  }
  if (
    old?.dirty &&
    (ackVersion === undefined ||
      JSON.parse(old.payload_json).version !== ackVersion)
  ) {
    if ((old.remote_version ?? 0) <= e.version)
      await db.runAsync(
        "UPDATE copilot_execution_links SET remote_payload_json=?,remote_version=? WHERE id=?",
        JSON.stringify(e),
        e.version,
        e.id,
      );
    return;
  }
  if (old && (old.remote_version ?? 0) > e.version) return;
  await db.runAsync(
    "INSERT INTO copilot_execution_links(id,store_id,owner_id,conversation_id,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES(?,?,?,?,?,?,?,'SYNCED',0) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,remote_payload_json=excluded.remote_payload_json,remote_version=excluded.remote_version,sync_state='SYNCED',dirty=0",
    e.id,
    e.storeId,
    e.ownerId,
    e.conversationId,
    JSON.stringify(e),
    JSON.stringify(e),
    e.version,
  );
}
export class CopilotExecutionLinkRepository {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: Scope & { deviceId: string; canLink: boolean },
    private digest: (s: string) => Promise<string>,
    private id: () => string,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async open(raw: CopilotMessage) {
    const { message, content } = readExecutionLinkProposal(raw);
    scoped(message, this.scope);
    await verifyPrivateToolRecord(
      this.db,
      this.scope,
      message,
      content.assistantMessageId,
    );
    const row = await this.db.getFirstAsync<Row>(
      "SELECT * FROM copilot_execution_links WHERE id=?",
      message.id,
    );
    const link = row
      ? copilotExecutionLinkSchema.parse(JSON.parse(row.payload_json))
      : null;
    if (link) {
      scoped(link, this.scope);
      if (
        JSON.stringify(link.snapshot) !== JSON.stringify(content.snapshot) ||
        link.proposalMessageId !== message.id ||
        link.conversationId !== message.conversationId
      )
        throw Error("COPILOT_EXECUTION_LINK_IDENTITY_INVALID");
    }
    let status: "READY" | "STALE" | "CONFIRMED" | "WITHDRAWN" | "ERROR" = link
      ? row?.sync_state === "ERROR" || row?.sync_state === "CONFLICT"
        ? "ERROR"
        : link.version === 2
          ? "WITHDRAWN"
          : "CONFIRMED"
      : "READY";
    let proof: unknown = null;
    if (!link) {
      const s = content.snapshot,
        decisionRow = await this.db.getFirstAsync<Row>(
          "SELECT * FROM copilot_decisions WHERE id=? AND store_id=? AND owner_id=?",
          s.decision.id,
          this.scope.storeId,
          this.scope.ownerId,
        );
      const decision = decisionRow
        ? recommendationDecisionSchema.parse(
            JSON.parse(decisionRow.payload_json),
          )
        : null;
      if (decision) scoped(decision, this.scope);
      const taskRow = await this.db.getFirstAsync<{
        payload_json: string;
        sync_state: string;
      }>(
        "SELECT payload_json,sync_state FROM commercial_execution_tasks WHERE id=? AND store_id=?",
        s.task.id,
        this.scope.storeId,
      );
      const plan = await new CommercialPlanRepository(this.db, this.digest).get(
        this.scope.storeId,
        s.weekStart,
      );
      const target = plan
        ? (await commercialExecutionChecklist(plan.entity, this.digest)).find(
            (t) => t.id === s.task.id,
          )
        : null;
      const count = await this.db.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) AS n FROM copilot_execution_links WHERE store_id=? AND owner_id=?",
        this.scope.storeId,
        this.scope.ownerId,
      );
      if ((count?.n ?? 0) >= 500) status = "ERROR";
      else if (
        !decision ||
        decision.id !== s.decision.id ||
        decision.version !== s.decision.version ||
        decision.conversationId !== s.decision.conversationId ||
        ["ERROR", "CONFLICT"].includes(decisionRow!.sync_state) ||
        JSON.stringify(decision.revisions.at(-1)) !==
          JSON.stringify(s.decision.revision) ||
        (await this.digest(
          recommendationTrackingIdentityPayload(decision, s.decision.basis),
        )) !== decision.proposalDigest ||
        !taskRow ||
        ["ERROR", "CONFLICT"].includes(taskRow.sync_state) ||
        JSON.stringify(
          legacyCommercialExecution(JSON.parse(taskRow.payload_json)),
        ) !== JSON.stringify(s.task) ||
        !plan ||
        ["ERROR", "CONFLICT"].includes(plan.syncState) ||
        !target ||
        !commercialExecutionSameTarget(s.task, target)
      )
        status = "STALE";
      proof = [decisionRow, taskRow, plan, count];
    }
    return {
      message,
      content,
      link,
      status,
      syncState: row?.sync_state ?? null,
      review: await this.digest(JSON.stringify([message, row, proof])),
    };
  }
  async save(
    message: CopilotMessage,
    review: string,
    withdraw = false,
    signal?: AbortSignal,
  ) {
    if (!this.scope.canLink || signal?.aborted)
      throw Error("COPILOT_EXECUTION_LINK_FORBIDDEN");
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const repo = new CopilotExecutionLinkRepository(
          joinedProductToolDatabase(tx),
          this.scope,
          this.digest,
          this.id,
          this.now,
        ),
        state = await repo.open(message);
      if (state.review !== review)
        throw Error("COPILOT_EXECUTION_LINK_REVIEW_REQUIRED");
      if ((!withdraw && state.link) || (withdraw && state.link?.version === 2))
        return;
      if (withdraw ? state.status !== "CONFIRMED" : state.status !== "READY")
        throw Error("COPILOT_EXECUTION_LINK_REVIEW_REQUIRED");
      const now = this.now();
      const e = copilotExecutionLinkSchema.parse(
        withdraw
          ? { ...state.link, version: 2, withdrawnAt: now }
          : {
              id: message.id,
              storeId: this.scope.storeId,
              ownerId: this.scope.ownerId,
              conversationId: message.conversationId,
              proposalMessageId: message.id,
              snapshot: state.content.snapshot,
              createdAt: now,
              withdrawnAt: null,
              version: 1,
            },
      );
      if (now < message.createdAt)
        throw Error("COPILOT_EXECUTION_LINK_DATE_INVALID");
      await tx.runAsync(
        "INSERT INTO copilot_execution_links(id,store_id,owner_id,conversation_id,payload_json,sync_state,dirty) VALUES(?,?,?,?,?,'PENDING',1) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,sync_state='PENDING',dirty=1",
        e.id,
        e.storeId,
        e.ownerId,
        e.conversationId,
        JSON.stringify(e),
      );
      await new OutboxRepository(tx).enqueue({
        commandId: this.id(),
        deviceId: this.scope.deviceId,
        storeId: e.storeId,
        commandType: "COPILOT_EXECUTION_LINK_UPSERT",
        entityType: "copilot_execution_link",
        entityId: e.id,
        expectedRemoteVersion: withdraw ? 1 : null,
        payload: e,
        createdAt: now,
      });
      if (signal?.aborted) throw Error("COPILOT_EXECUTION_LINK_CANCELLED");
    });
    return this.open(message);
  }
}
