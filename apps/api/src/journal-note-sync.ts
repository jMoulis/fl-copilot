import {
  prepareJournalNote,
  journalNoteWithdrawalSchema,
  sameJournalNote,
  storeJournalNoteSchema,
  withdrawJournalNote,
  type StoreJournalNote,
} from "@fl-copilot/domain";
import type { SyncCommand } from "@fl-copilot/sync-contracts";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "./sync/processed-command-service";
import type { createMongoSyncChangeService } from "./sync/sync-change-service";
export class JournalNoteParentPendingError extends Error {
  constructor() {
    super("JOURNAL_NOTE_PARENT_PENDING");
  }
}
export type JournalNoteDocument = StoreJournalNote & { _id: string };
export function serializeJournalNote(row: JournalNoteDocument) {
  const { _id, ...note } = row;
  if (_id !== note.id) throw Error("JOURNAL_NOTE_IDENTITY_CHANGED");
  return storeJournalNoteSchema.parse(note);
}
export async function applyJournalNoteCommand(
  ctx: MongoCommandMutationContext,
  storeId: string,
  command: SyncCommand,
  requestId: string,
  changes: ReturnType<typeof createMongoSyncChangeService>,
): Promise<CommandMutationResult> {
  const reject = (code: string, messageFr: string): CommandMutationResult => ({
    resultStatus: "REJECTED",
    resultingVersion: null,
    responseJson: { error: { code, messageFr, retryable: false, requestId } },
  });
  if (command.entityType !== "store_journal_note")
    return reject("JOURNAL_NOTE_INVALID", "Vérifiez cette note du magasin.");
  const collection =
    ctx.database.collection<JournalNoteDocument>("storeJournalNotes");
  const row = await collection.findOne(
    { _id: command.entityId },
    { session: ctx.session },
  );
  if (row && row.storeId !== storeId)
    return reject(
      "JOURNAL_NOTE_SCOPE_INVALID",
      "Cette note appartient à un autre magasin.",
    );
  const previous = row ? serializeJournalNote(row) : null;
  let note: StoreJournalNote;
  try {
    if (command.type === "CREATE_JOURNAL_NOTE") {
      note = prepareJournalNote(storeId, command.payload);
      if (
        note.id !== command.entityId ||
        command.expectedRemoteVersion !== null
      )
        throw Error("invalid identity");
      if (previous) {
        if (!sameJournalNote(previous, note))
          return reject(
            "JOURNAL_NOTE_IMMUTABLE",
            "La note initiale est conservée. Pour la corriger, retirez-la puis créez une nouvelle note.",
          );
        return {
          resultStatus: "APPLIED",
          resultingVersion: previous.version,
          responseJson: { remoteEntity: previous },
        };
      }
    } else if (command.type === "WITHDRAW_JOURNAL_NOTE") {
      if (!previous) throw new JournalNoteParentPendingError();
      const payload = journalNoteWithdrawalSchema.parse(command.payload);
      if (
        !sameJournalNote(previous, prepareJournalNote(storeId, payload.capture))
      )
        return reject(
          "JOURNAL_NOTE_IMMUTABLE",
          "La note a changé. Rouvrez son original avant de la retirer.",
        );
      if (command.expectedRemoteVersion !== 1) throw Error("invalid revision");
      note = withdrawJournalNote(previous, payload.withdrawnAt);
      if (previous.withdrawnAt)
        return {
          resultStatus: "APPLIED",
          resultingVersion: previous.version,
          responseJson: { remoteEntity: previous },
        };
    } else throw Error("invalid command");
  } catch (error) {
    if (error instanceof JournalNoteParentPendingError) throw error;
    return reject(
      "JOURNAL_NOTE_INVALID",
      "Vérifiez le texte et la période de la note. Son original reste conservé.",
    );
  }
  await collection.replaceOne({ _id: note.id, storeId }, note, {
    upsert: true,
    session: ctx.session,
  });
  await ctx.database.collection("storeJournalNoteHistory").insertOne(
    {
      storeId,
      noteId: note.id,
      version: note.version,
      commandId: command.commandId,
      note,
    },
    { session: ctx.session },
  );
  await changes.append(ctx, {
    storeId,
    entityType: "store_journal_note",
    entityId: note.id,
    operation: "UPSERT",
    entityVersion: note.version,
  });
  return {
    resultStatus: "APPLIED",
    resultingVersion: note.version,
    responseJson: { remoteEntity: note },
  };
}
