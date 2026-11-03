import { copilotHistoryPageSchema } from "@fl-copilot/sync-contracts";
import {
  copilotImportReferenceSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { mergeCopilotHistory } from "./history-window";
import type { CopilotDraft } from "@fl-copilot/domain";
import { CopilotConversationRepository } from "./conversation-repository";

/** Serializes local draft/send actions; no network is needed to capture a question. */
export class CopilotLocalChatController {
  private tail: Promise<unknown> = Promise.resolve();
  private history = new Map<
    string,
    { hasMore: boolean; before: { createdAt: string; id: string } | null }
  >();
  constructor(
    private readonly repo: CopilotConversationRepository,
    private readonly scope: {
      storeId: string;
      ownerId: string;
      deviceId: string;
    },
    private readonly id: () => string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly readHistory?: (
      conversationId: string,
      before?: { createdAt: string; id: string },
      signal?: AbortSignal,
    ) => Promise<unknown>,
  ) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => undefined);
    return result;
  }
  private async active(conversationId: string) {
    const conversation = await this.repo.get(conversationId);
    if (!conversation || conversation.status !== "ACTIVE")
      throw new Error("COPILOT_CONVERSATION_UNAVAILABLE");
    return conversation;
  }
  create(title = "Nouvelle conversation") {
    return this.serial(async () => {
      const time = this.now();
      const conversation = {
        id: this.id(),
        storeId: this.scope.storeId,
        ownerId: this.scope.ownerId,
        title,
        status: "ACTIVE" as const,
        version: 1,
        createdAt: time,
        updatedAt: time,
      };
      await this.repo.save(conversation, {
        commandId: this.id(),
        deviceId: this.scope.deviceId,
      });
      return conversation;
    });
  }
  removeMessage(conversationId: string, messageId: string) {
    return this.serial(() =>
      this.repo.remove(
        conversationId,
        messageId,
        { commandId: this.id(), deviceId: this.scope.deviceId },
        this.now(),
      ),
    );
  }
  removeConversation(conversationId: string, signal?: AbortSignal) {
    return this.serial(() =>
      this.repo.remove(
        conversationId,
        null,
        { commandId: this.id(), deviceId: this.scope.deviceId, signal },
        this.now(),
      ),
    );
  }
  open(conversationId: string, through?: { createdAt: string; id: string }) {
    return this.serial(async () => {
      const conversation = await this.active(conversationId);
      let page = await this.repo.messages(conversationId);
      while (
        through &&
        page.hasMore &&
        page.before &&
        (page.before.createdAt > through.createdAt ||
          (page.before.createdAt === through.createdAt &&
            page.before.id > through.id))
      ) {
        const older = await this.repo.messages(conversationId, 50, page.before);
        if (
          older.before &&
          (older.before.createdAt > page.before.createdAt ||
            (older.before.createdAt === page.before.createdAt &&
              older.before.id >= page.before.id))
        )
          throw Error("COPILOT_HISTORY_CURSOR_INVALID");
        page = mergeCopilotHistory(page, older, "OLDER");
      }
      const draft = await this.repo.draft(conversationId);
      const pendingTurns = await this.repo.pendingTurns(conversationId);
      return {
        conversation,
        ...page,
        hasMore: page.hasMore || this.remoteHasMore(conversationId),
        draft,
        pendingTurns,
      };
    });
  }
  private remoteHasMore(conversationId: string) {
    return (
      !!this.readHistory && (this.history.get(conversationId)?.hasMore ?? true)
    );
  }
  async refreshHistory(conversationId: string, signal?: AbortSignal) {
    if (!this.readHistory) return this.open(conversationId);
    await this.active(conversationId);
    const previous = this.history.get(conversationId);
    const raw = await this.readHistory(conversationId, undefined, signal);
    if (signal?.aborted) throw Error("COPILOT_HISTORY_CANCELLED");
    const page = await this.repo.restoreHistory(conversationId, raw);
    if (this.history.get(conversationId) === previous)
      this.history.set(conversationId, {
        hasMore: page.hasMore,
        before: page.before,
      });
    return this.open(conversationId);
  }
  async older(
    conversationId: string,
    before?: { createdAt: string; id: string },
  ) {
    await this.active(conversationId);
    let local = await this.repo.messages(conversationId, 50, before);
    if (!local.messages.length && this.remoteHasMore(conversationId)) {
      const cursor = this.history.get(conversationId)?.before ?? undefined;
      const raw = await this.readHistory!(conversationId, cursor);
      const page = copilotHistoryPageSchema.parse(raw);
      if (
        page.hasMore &&
        (!page.before ||
          (cursor &&
            (page.before.createdAt > cursor.createdAt ||
              (page.before.createdAt === cursor.createdAt &&
                page.before.id >= cursor.id))))
      )
        throw Error("COPILOT_HISTORY_CURSOR_INVALID");
      await this.repo.restoreHistory(conversationId, page);
      this.history.set(conversationId, {
        hasMore: page.hasMore,
        before: page.before,
      });
      local = await this.repo.messages(conversationId, 50, cursor);
    }
    const anchor =
      before &&
      (!local.before ||
        before.createdAt < local.before.createdAt ||
        (before.createdAt === local.before.createdAt &&
          before.id < local.before.id))
        ? before
        : local.before;
    return {
      ...local,
      before: anchor,
      hasMore: local.hasMore || this.remoteHasMore(conversationId),
    };
  }
  edit(
    conversationId: string,
    draft: Pick<CopilotDraft, "text" | "attachments">,
  ) {
    return this.serial(async () => {
      await this.active(conversationId);
      await this.repo.saveDraft(conversationId, {
        ...draft,
        updatedAt: this.now(),
      });
    });
  }
  editText(conversationId: string, text: string) {
    return this.serial(async () => {
      await this.active(conversationId);
      const draft = await this.repo.draft(conversationId);
      await this.repo.saveDraft(conversationId, {
        text,
        attachments: draft?.attachments ?? [],
        updatedAt: this.now(),
      });
    });
  }
  appendIntakeQuestion(conversationId: string, question: string) {
    return this.serial(async () => {
      await this.active(conversationId);
      await this.repo.appendIntakeQuestion(
        conversationId,
        question,
        this.now(),
      );
    });
  }
  attachPdf(
    conversationId: string,
    sourceDocumentId: string,
    signal?: AbortSignal,
  ) {
    return this.serial(async () => {
      await this.active(conversationId);
      return this.repo.attachPdf(
        conversationId,
        sourceDocumentId,
        this.now(),
        signal,
      );
    });
  }
  attachPdfs(
    conversationId: string,
    sourceDocumentIds: string[],
    signal?: AbortSignal,
  ) {
    return this.serial(async () => {
      await this.active(conversationId);
      return this.repo.attachPdfs(
        conversationId,
        sourceDocumentIds,
        this.now(),
        signal,
      );
    });
  }
  removeAttachment(conversationId: string, sourceDocumentId: string) {
    return this.serial(async () => {
      await this.active(conversationId);
      const draft = await this.repo.draft(conversationId);
      if (!draft) return;
      const updated = {
        ...draft,
        updatedAt: this.now(),
        attachments: draft.attachments.filter(
          (a) => a.sourceDocumentId !== sourceDocumentId,
        ),
      };
      await this.repo.saveDraft(conversationId, updated);
      return updated;
    });
  }
  sendImportReference(conversationId: string, raw: unknown) {
    return this.serial(async () => {
      await this.active(conversationId);
      const reference = copilotImportReferenceSchema.parse(raw);
      return this.repo.append(
        {
          id: this.id(),
          storeId: this.scope.storeId,
          ownerId: this.scope.ownerId,
          conversationId,
          role: "USER",
          text: JSON.stringify(reference),
          attachments: [],
          replyToMessageId: null,
          supersedesMessageId: null,
          version: 1,
          createdAt: this.now(),
        } as CopilotMessage,
        {
          commandId: this.id(),
          deviceId: this.scope.deviceId,
          preserveDraft: true,
        },
      );
    });
  }
  send(conversationId: string) {
    return this.serial(async () => {
      await this.active(conversationId);
      const draft = await this.repo.draft(conversationId);
      if (!draft || (!draft.text.trim() && !draft.attachments.length))
        throw new Error("COPILOT_DRAFT_EMPTY");
      if (draft.text.length > 6000) throw new Error("COPILOT_DRAFT_TOO_LONG");
      return this.repo.append(
        {
          id: this.id(),
          storeId: this.scope.storeId,
          ownerId: this.scope.ownerId,
          conversationId,
          role: "USER",
          text: draft.text,
          attachments: draft.attachments,
          replyToMessageId: null,
          supersedesMessageId: null,
          version: 1,
          createdAt: this.now(),
        },
        {
          commandId: this.id(),
          deviceId: this.scope.deviceId,
          replyId: this.id(),
        },
      );
    });
  }
}
