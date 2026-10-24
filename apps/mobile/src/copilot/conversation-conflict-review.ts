import {
  copilotConversationSchema,
  preserveCopilotConversationDeletions,
  copilotConversationMetadataEqual,
  type CopilotConversation,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import {
  ConflictRepository,
  reviewConflictVersions,
} from "../sync/conflict-repository";
type Scope = { storeId: string; ownerId: string };
type Row = {
  id: string;
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
    throw Error("COPILOT_CONVERSATION_SCOPE_INVALID");
}
const same = (a: CopilotConversation, b: CopilotConversation) =>
  a.id === b.id &&
  a.createdAt === b.createdAt &&
  a.ownerId === b.ownerId &&
  a.storeId === b.storeId;
export type ConversationResolutionContext = {
  storeId: string;
  ownerId: string;
  commandId: string;
  deviceId: string;
  reviewHash: string;
  reviewCaptureId: string;
  canResolve: () => boolean;
  signal?: AbortSignal;
};
/** Private conversation metadata only; deletion and immutable messages are independent. */
export async function readConversationConflictReview(
  db: OutboxDatabase,
  scope: Scope,
  id: string,
  digest: (s: string) => Promise<string>,
) {
  const row = await db.getFirstAsync<Row>(
    "SELECT * FROM copilot_conversations WHERE id=? AND store_id=? AND owner_id=?",
    id,
    scope.storeId,
    scope.ownerId,
  );
  if (!row) throw Error("COPILOT_CONVERSATION_REVIEW_REQUIRED");
  const local = copilotConversationSchema.parse(JSON.parse(row.payload_json));
  scoped(local, scope);
  if (local.id !== id || row.id !== id)
    throw Error("COPILOT_CONVERSATION_IDENTITY_INVALID");
  const parsed = row.remote_payload_json
      ? copilotConversationSchema.safeParse(JSON.parse(row.remote_payload_json))
      : null,
    cached = parsed?.success ? parsed.data : null,
    cacheValid =
      !!cached && same(local, cached) && cached.version === row.remote_version,
    current = {
      entity: local,
      syncState: row.sync_state,
      remoteVersion: row.remote_version,
    },
    conflicts = await new ConflictRepository(db).listOpenForEntity(
      scope.storeId,
      "copilot_conversation",
      id,
    ),
    group = conflicts.length
      ? reviewConflictVersions(
          conflicts,
          (raw) => {
            const p = copilotConversationSchema.safeParse(raw);
            return p.success ? p.data : null;
          },
          (candidate) => same(local, candidate),
          cached,
        )
      : {
          conflicts,
          conflict: null,
          remote: cacheValid ? cached : null,
          valid: cacheValid,
          reason: cacheValid
            ? null
            : "La version distante de cette conversation n’est pas vérifiée. Votre version est conservée ; aucun nouvel envoi ni retour en version 1 n’est proposé.",
        },
    remote = group.remote,
    commands = await db.getAllAsync<{
      command_id: string;
      status: string;
      payload_json: string;
      expected_remote_version: number | null;
      last_error_code: string | null;
    }>(
      "SELECT command_id,status,payload_json,expected_remote_version,last_error_code FROM sync_outbox WHERE store_id=? AND entity_type='copilot_conversation' AND entity_id=? AND status IN ('PENDING','SYNCING','CONFLICT','FAILED') ORDER BY local_sequence LIMIT 101",
      scope.storeId,
      id,
    );
  const ownedPayload = (raw: unknown) => {
    const p = copilotConversationSchema.safeParse(raw);
    return p.success && same(local, p.data);
  };
  const commandsOwned = commands.every((command) => {
      try {
        return ownedPayload(JSON.parse(command.payload_json));
      } catch {
        return false;
      }
    }),
    cohortOwned = conflicts.every((c) => ownedPayload(c.localPayload)),
    groupReady =
      ["CONFLICT", "ERROR"].includes(row.sync_state) &&
      group.valid &&
      !!remote &&
      (row.remote_version ?? 0) <= remote.version &&
      (!row.remote_payload_json || cacheValid) &&
      commandsOwned &&
      cohortOwned &&
      commands.length <= 100 &&
      !commands.some((c) => c.status === "SYNCING"),
    reason =
      group.reason ??
      (!commandsOwned || !cohortOwned
        ? "Les références privées de la comparaison ne correspondent pas au compte actuel. Aucune version n’est réaffectée."
        : !groupReady
          ? "La comparaison a changé, un envoi est en cours ou son historique dépasse la limite. Relisez les versions avant de décider."
          : null),
    hash = await digest(JSON.stringify({ scope, id, row, group, commands }));
  let localChoice: CopilotConversation | null = null,
    remoteChoice: CopilotConversation | null = null,
    deletionReason: string | null = null;
  if (groupReady && remote) {
    try {
      const history = conflicts.flatMap((c) => [
        copilotConversationSchema.parse(c.localPayload),
        copilotConversationSchema.parse(c.remotePayload),
      ]);
      localChoice = preserveCopilotConversationDeletions(
        local,
        remote,
        ...history,
      );
      remoteChoice = preserveCopilotConversationDeletions(
        remote,
        remote,
        local,
        ...history,
      );
    } catch {
      deletionReason =
        "Les suppressions connues ne peuvent pas être réunies dans cette comparaison. Les versions et les messages restent conservés ; aucune suppression n’est annulée.";
    }
  }
  const ready = groupReady && !!localChoice && !!remoteChoice;
  return {
    current,
    group,
    hash,
    ready,
    reason: deletionReason ?? reason,
    canKeepLocal: ready,
    canAdoptRemote: ready,
    localChoice,
    remoteChoice,
    remoteChoiceNeedsSend:
      !!remote &&
      !!remoteChoice &&
      !copilotConversationMetadataEqual(remote, remoteChoice),
  };
}
