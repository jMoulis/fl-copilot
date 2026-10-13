import { mergeCopilotHistory } from "./history-window";
import type { CopilotDraft } from "@fl-copilot/domain";
import { CopilotConversationRepository } from "./conversation-repository";

/** Serializes local draft/send actions; no network is needed to capture a question. */
export class CopilotLocalChatController {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly repo: CopilotConversationRepository,
    private readonly scope: {
      storeId: string;
      ownerId: string;
      deviceId: string;
    },
    private readonly id: () => string,
    private readonly now: () => string = () => new Date().toISOString(),
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
      return { conversation, ...page, draft, pendingTurns };
    });
  }
  older(conversationId: string, before: { createdAt: string; id: string }) {
    return this.serial(async () => {
      await this.active(conversationId);
      return this.repo.messages(conversationId, 50, before);
    });
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
