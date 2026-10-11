import {
  copilotToolScopeSchema,
  copilotConversationSchema,
  copilotMessageSchema,
  copilotFormDefinitionSchema,
  copilotFormSchema,
  copilotFormEditSchema,
  evaluateCopilotForm,
  CopilotToolError,
  type CopilotToolScope,
  type CopilotForm,
  type CopilotFormIssue,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
export async function authorizeCopilotFormScope(
  tx: OutboxDatabase,
  raw: CopilotToolScope,
) {
  const parsed = copilotToolScopeSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.canReadStore)
    throw new CopilotToolError("FORBIDDEN");
  const scope = parsed.data;
  const row = await tx.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM copilot_conversations WHERE id=? AND store_id=? AND owner_id=?",
      scope.conversationId,
      scope.storeId,
      scope.ownerId,
    ),
    c = row
      ? copilotConversationSchema.parse(JSON.parse(row.payload_json))
      : null;
  if (
    !c ||
    c.status !== "ACTIVE" ||
    c.id !== scope.conversationId ||
    c.storeId !== scope.storeId ||
    c.ownerId !== scope.ownerId
  )
    throw new CopilotToolError("FORBIDDEN");
  return scope;
}
export async function readScopedCopilotForm(
  tx: OutboxDatabase,
  id: string,
  scope: CopilotToolScope,
) {
  const row = await tx.getFirstAsync<{
    payload_json: string;
    request_json: string;
  }>(
    "SELECT payload_json,request_json FROM copilot_forms WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
    id,
    scope.storeId,
    scope.ownerId,
    scope.conversationId,
  );
  if (!row) return null;
  const form = copilotFormSchema.parse(JSON.parse(row.payload_json));
  if (
    form.definition.id !== id ||
    form.storeId !== scope.storeId ||
    form.ownerId !== scope.ownerId ||
    form.conversationId !== scope.conversationId
  )
    throw new CopilotToolError("FORBIDDEN");
  return { form, requestJson: row.request_json };
}
export async function evaluateSavedCopilotForm(
  tx: OutboxDatabase,
  form: CopilotForm,
) {
  const e = evaluateCopilotForm(form.definition, form.answers);
  for (const f of form.definition.fields) {
    const value = e.normalized[f.key];
    if (f.type !== "FILE" || !value || typeof value === "string") continue;
    const row = await tx.getFirstAsync<{ id: string }>(
      "SELECT id FROM source_documents WHERE id=? AND store_id=? AND deleted_at IS NULL",
      value.sourceDocumentId,
      form.storeId,
    );
    if (!row) {
      e.issues.push({
        key: f.key,
        code: "SOURCE_UNAVAILABLE",
        message: `${f.label} : enregistrez le fichier dans ce magasin avant de répondre.`,
      });
      delete e.normalized[f.key];
    }
  }
  e.ready = e.issues.length === 0;
  return e;
}
/** Local conversational drafts only; READY is never authority to publish business data. */
export class CopilotFormRepository {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  private async transaction<T>(work: (tx: OutboxDatabase) => Promise<T>) {
    let result: T | undefined;
    try {
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        result = await work(tx);
      });
    } catch (e) {
      if (e instanceof CopilotToolError) throw e;
      throw new CopilotToolError("UNAVAILABLE");
    }
    return result!;
  }
  async create(raw: unknown, rawScope: CopilotToolScope, signal?: AbortSignal) {
    const parsed = copilotFormDefinitionSchema.safeParse(raw);
    if (!parsed.success) throw new CopilotToolError("INVALID_INPUT");
    const definition = parsed.data;
    return this.transaction(async (tx) => {
      if (signal?.aborted) throw new CopilotToolError("CANCELLED");
      const scope = await authorizeCopilotFormScope(tx, rawScope),
        message = await tx.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM copilot_messages WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
          definition.parentUserMessageId,
          scope.storeId,
          scope.ownerId,
          scope.conversationId,
        ),
        m = message
          ? copilotMessageSchema.parse(JSON.parse(message.payload_json))
          : null;
      if (
        !m ||
        m.role !== "USER" ||
        m.id !== definition.parentUserMessageId ||
        m.storeId !== scope.storeId ||
        m.ownerId !== scope.ownerId ||
        m.conversationId !== scope.conversationId
      )
        throw new CopilotToolError("FORBIDDEN");
      const old = await readScopedCopilotForm(tx, definition.id, scope),
        requestJson = JSON.stringify(definition);
      if (old) {
        if (old.requestJson !== requestJson)
          throw new CopilotToolError("OPERATION_CONFLICT");
        return old.form;
      }
      if (
        evaluateCopilotForm(definition, definition.prefill).issues.some(
          (i) => i.code === "UNKNOWN_FIELD",
        )
      )
        throw new CopilotToolError("INVALID_INPUT");
      const now = this.now(),
        form: CopilotForm = {
          definition,
          storeId: scope.storeId,
          ownerId: scope.ownerId,
          conversationId: scope.conversationId,
          answers: definition.prefill,
          status: "OPEN",
          submission: null,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
      await tx.runAsync(
        "INSERT INTO copilot_forms(id,store_id,owner_id,conversation_id,request_json,payload_json,updated_at) VALUES(?,?,?,?,?,?,?)",
        definition.id,
        scope.storeId,
        scope.ownerId,
        scope.conversationId,
        requestJson,
        JSON.stringify(form),
        now,
      );
      if (signal?.aborted) throw new CopilotToolError("CANCELLED");
      return form;
    });
  }
  async get(id: string, rawScope: CopilotToolScope) {
    return this.transaction(async (tx) => {
      const scope = await authorizeCopilotFormScope(tx, rawScope),
        row = await readScopedCopilotForm(tx, id, scope);
      return row?.form ?? null;
    });
  }
  async edit(
    raw: unknown,
    rawScope: CopilotToolScope,
    currentBasisToken: string,
    signal?: AbortSignal,
  ) {
    const parsed = copilotFormEditSchema.safeParse(raw);
    if (!parsed.success || !currentBasisToken || currentBasisToken.length > 256)
      throw new CopilotToolError("INVALID_INPUT");
    const input = parsed.data;
    return this.transaction(async (tx) => {
      if (signal?.aborted) throw new CopilotToolError("CANCELLED");
      const scope = await authorizeCopilotFormScope(tx, rawScope),
        old = await readScopedCopilotForm(tx, input.id, scope);
      if (!old) throw new CopilotToolError("FORBIDDEN");
      if (old.form.version !== input.expectedVersion)
        throw new CopilotToolError("OPERATION_CONFLICT");
      if (["CANCELLED", "STALE", "ANSWERED"].includes(old.form.status))
        throw new CopilotToolError("OPERATION_CONFLICT");
      const form = {
          ...old.form,
          version: old.form.version + 1,
          updatedAt: this.now(),
        },
        issues: CopilotFormIssue[] = [];
      if (currentBasisToken !== form.definition.basisToken)
        form.status = "STALE";
      else if (input.action === "CANCEL") form.status = "CANCELLED";
      else {
        if (
          Object.keys(input.answers).some(
            (k) => !form.definition.fields.some((f) => f.key === k),
          )
        )
          throw new CopilotToolError("INVALID_INPUT");
        form.answers = { ...form.answers, ...input.answers };
        const e = await evaluateSavedCopilotForm(tx, form);
        issues.push(...e.issues);
        form.status =
          input.action === "POSTPONE"
            ? "POSTPONED"
            : e.ready
              ? "READY"
              : "OPEN";
      }
      await tx.runAsync(
        "UPDATE copilot_forms SET payload_json=?,updated_at=? WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
        JSON.stringify(form),
        form.updatedAt,
        input.id,
        scope.storeId,
        scope.ownerId,
        scope.conversationId,
      );
      if (signal?.aborted) throw new CopilotToolError("CANCELLED");
      return { form, issues };
    });
  }
}
