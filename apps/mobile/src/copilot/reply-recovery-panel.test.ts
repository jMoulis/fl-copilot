import { createElement, type ElementType } from "react";
import { Alert } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import {
  CopilotConversationRepository,
  applyCopilotRecord,
} from "./conversation-repository";
import { CopilotLocalChatController } from "./local-chat-controller";
import { CopilotTurnDelivery } from "./turn-delivery";
import { receiveCopilotReply } from "./response-receiver";
import { CopilotLocalChatPanel } from "./local-chat-panel";
import { ApiClientError } from "@fl-copilot/api-client";
import type { CopilotTurnRequest } from "@fl-copilot/domain";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Text: "Text",
  View: "View",
  Pressable: "Pressable",
  Alert: { alert: vi.fn() },
  Platform: { OS: "ios" },
}));
vi.mock("../components/ui", () => ({
  BottomSheet: () => null,
  MenuRow: () => null,
}));
vi.mock("./chat-view", () => ({
  CopilotChatView: (props: Record<string, unknown>) =>
    createElement("ChatView", props),
}));
vi.mock("../documents/source-original-button", () => ({
  SourceOriginalButton: () => null,
}));
vi.mock("./source-image-attachment", () => ({
  SourceImageAttachment: () => null,
}));
vi.mock("../commercial/analysis-recovery-panel", () => ({
  CommercialAnalysisRecoveryPanel: () => null,
}));
vi.mock("../commercial/original-button", () => ({
  CommercialOriginalButton: () => null,
}));
class Adapter implements OutboxDatabase {
  constructor(readonly db: DatabaseSync) {}
  async execAsync(s: string) {
    this.db.exec(s);
  }
  async runAsync(s: string, ...p: (string | number | null)[]) {
    return this.db.prepare(s).run(...p);
  }
  async getFirstAsync<T>(s: string, ...p: (string | number | null)[]) {
    return (this.db.prepare(s).get(...p) as T) ?? null;
  }
  async getAllAsync<T>(s: string, ...p: (string | number | null)[]) {
    return this.db.prepare(s).all(...p) as T[];
  }
  async withExclusiveTransactionAsync(
    task: (tx: OutboxDatabase) => Promise<void>,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
let renderer: ReactTestRenderer | undefined, db: DatabaseSync | undefined;
const view = () => renderer!.root.findByType("ChatView" as ElementType).props;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  db?.close();
  db = undefined;
  vi.restoreAllMocks();
});
async function setup(
  mode:
    | "LOST"
    | "RECOVER"
    | "PROGRESS"
    | "PENDING"
    | "AUTH"
    | "SCOPE"
    | "SERVER_ERROR" = "LOST",
) {
  db = new DatabaseSync(":memory:");
  const a = new Adapter(db),
    f = chatFixture(randomUUID);
  await runLocalMigrations(a);
  const repo = new CopilotConversationRepository(a, f),
    controller = new CopilotLocalChatController(repo, f, randomUUID);
  await repo.save(f.conversation, {
    commandId: randomUUID(),
    deviceId: f.deviceId,
  });
  const oldParent = { ...f.message, attachments: [] };
  await repo.append(oldParent, {
    commandId: randomUUID(),
    deviceId: f.deviceId,
  });
  await controller.edit(f.conversation.id, {
    text: "Prix des produits en 2025",
    attachments: [],
  });
  const parent = await controller.send(f.conversation.id),
    request = (await controller.open(f.conversation.id)).pendingTurns[0]!;
  const reply = {
    ...parent,
    id: request.replyId,
    role: "ASSISTANT" as const,
    text: "Voici les prix de vente.",
    replyToMessageId: parent.id,
  };
  const ask = vi.fn(
    async (
      _request: CopilotTurnRequest,
      _signal: AbortSignal,
      onProgress: (text: string) => void,
    ): Promise<unknown> => {
      if (mode === "PROGRESS" || mode === "SERVER_ERROR")
        onProgress("Début provisoire");
      if (mode === "SERVER_ERROR") throw Error("COPILOT_STREAM_FAILED");
      if (mode === "PENDING")
        throw new ApiClientError(409, {
          code: "COPILOT_TURN_PENDING",
          messageFr: "Une réponse est en préparation.",
          retryable: true,
        });
      if (mode === "AUTH")
        throw new ApiClientError(401, {
          code: "AUTH_REQUIRED",
          messageFr: "Veuillez vous connecter.",
          retryable: false,
        });
      if (mode === "SCOPE") throw Error("COPILOT_STREAM_SCOPE_INVALID");
      throw Error("WIRE_LOST");
    },
  );
  const sync = vi.fn(async () => {
    await a.runAsync("UPDATE copilot_messages SET sync_state='SYNCED'");
    if (mode === "RECOVER" && ask.mock.calls.length)
      await applyCopilotRecord(a, f, "copilot_message", reply);
  });
  const delivery = new CopilotTurnDelivery(a, f, { sync, ask });
  const props = {
    controller,
    delivery,
    conversationId: f.conversation.id,
    scopeKey: f.storeId + f.ownerId,
    onConversations: vi.fn(),
    externalMessageRevision: 0,
  };
  await act(async () => {
    renderer = create(createElement(CopilotLocalChatPanel, props));
  });
  const refresh = async () => {
    props.externalMessageRevision++;
    await act(async () =>
      renderer!.update(createElement(CopilotLocalChatPanel, props)),
    );
  };
  return {
    a,
    f,
    controller,
    repo,
    parent,
    oldParent,
    request,
    reply,
    ask,
    sync,
    refresh,
  };
}
it("removes only the matching delivery warning when the durable reply arrives through background synchronization", async () => {
  const x = await setup();
  expect(view().error).toContain("La réponse n’a pas pu être reçue");
  await applyCopilotRecord(x.a, x.f, "copilot_message", x.reply);
  await x.refresh();
  expect(view().messages.some((m: { id: string }) => m.id === x.reply.id)).toBe(
    true,
  );
  expect(view().error).toBeUndefined();
  expect(view().status).toBe("IDLE");
  expect(x.ask).toHaveBeenCalledTimes(1);
});
it("keeps the warning for its pending question when an unrelated answer arrives", async () => {
  const x = await setup();
  await applyCopilotRecord(x.a, x.f, "copilot_message", {
    ...x.reply,
    id: randomUUID(),
    replyToMessageId: x.oldParent.id,
  });
  await x.refresh();
  expect(view().error).toContain("La réponse n’a pas pu être reçue");
  expect(view().status).toBe("QUEUED");
});
it("preserves an independent draft-save error when the matching reply arrives", async () => {
  const x = await setup();
  vi.spyOn(x.controller, "editText").mockRejectedValueOnce(
    Error("LOCAL_SAVE_FAILED"),
  );
  await act(async () => view().onDraftChange("Mon brouillon reste ici"));
  await receiveCopilotReply(x.a, x.f, x.request, {
    message: x.reply,
    alreadyApplied: true,
  });
  await x.refresh();
  expect(view().error).toContain("Le brouillon n’a pas pu être enregistré");
  expect(view().draft).toBe("Mon brouillon reste ici");
});

it("recovers a durably synchronized reply before reporting transport failure, without another AI request", async () => {
  const x = await setup("RECOVER");
  expect(view().error).toBeUndefined();
  expect(view().status).toBe("IDLE");
  expect(x.ask).toHaveBeenCalledTimes(1);
  expect(x.sync).toHaveBeenCalledTimes(2);
  expect((await x.controller.open(x.f.conversation.id)).pendingTurns).toEqual(
    [],
  );
  expect(
    view().messages.filter((m: { id: string }) => m.id === x.reply.id),
  ).toHaveLength(1);
});
it.each(["PENDING", "PROGRESS"] as const)(
  "keeps %s recoverable delivery queued without a false failure or storing partial text",
  async (mode) => {
    const x = await setup(mode);
    expect(view().error).toBeUndefined();
    expect(view().status).toBe("QUEUED");
    expect((await x.controller.open(x.f.conversation.id)).pendingTurns).toEqual(
      [x.request],
    );
    expect(
      view().messages.some(
        (m: { text: string }) => m.text === "Début provisoire",
      ),
    ).toBe(false);
    x.ask.mockResolvedValueOnce({ message: x.reply, alreadyApplied: true });
    await act(async () => view().onRetry());
    expect(view().status).toBe("IDLE");
    expect(view().error).toBeUndefined();
    expect(x.ask.mock.calls.map((args) => args[0])).toEqual([
      x.request,
      x.request,
    ]);
    expect(
      view().messages.filter((m: { id: string }) => m.id === x.reply.id),
    ).toHaveLength(1);
  },
);
it.each(["AUTH", "SCOPE"] as const)(
  "retains %s hard failures without attempting a recovery pull or new AI request",
  async (mode) => {
    const x = await setup(mode);
    expect(view().error).toBeDefined();
    expect(view().status).toBe("QUEUED");
    if (mode === "AUTH") expect(view().error).toBe("Veuillez vous connecter.");
    expect(x.ask).toHaveBeenCalledTimes(1);
    expect(x.sync).toHaveBeenCalledTimes(1);
  },
);

it("clears the warning after explicitly removing its failed question", async () => {
  const x = await setup();
  await act(async () => view().onDeleteMessage(x.parent));
  const buttons = vi.mocked(Alert.alert).mock.calls.at(-1)![2]!;
  await act(async () =>
    buttons.find((button) => button.style === "destructive")!.onPress!(),
  );
  expect(view().error).toBeUndefined();
  expect((await x.controller.open(x.f.conversation.id)).pendingTurns).toEqual(
    [],
  );
});
it("correlates a newly sent question separately from an older successful answer", async () => {
  const x = await setup("RECOVER");
  await act(async () => view().onDraftChange("Et la marge ?"));
  x.ask.mockRejectedValueOnce(Error("SECOND_STREAM_LOST"));
  await act(async () => view().onSend());
  expect(view().error).toContain("La réponse n’a pas pu être reçue");
  const snapshot = await x.controller.open(x.f.conversation.id),
    request = snapshot.pendingTurns[0]!;
  expect(request.replyId).not.toBe(x.request.replyId);
  const parent = snapshot.messages.find(
    (m) => m.entity.id === request.userMessageId,
  )!.entity;
  await receiveCopilotReply(x.a, x.f, request, {
    message: {
      ...parent,
      id: request.replyId,
      role: "ASSISTANT",
      replyToMessageId: parent.id,
      text: "Voici la marge.",
    },
    alreadyApplied: true,
  });
  await x.refresh();
  expect(view().error).toBeUndefined();
  expect(view().status).toBe("IDLE");
  expect(x.ask).toHaveBeenCalledTimes(2);
});

it("retains an explicit server stream failure even after provisional progress", async () => {
  const x = await setup("SERVER_ERROR");
  expect(view().error).toBeDefined();
  expect(x.sync).toHaveBeenCalledTimes(2);
  expect(x.ask).toHaveBeenCalledTimes(1);
  expect((await x.controller.open(x.f.conversation.id)).pendingTurns).toEqual([
    x.request,
  ]);
});

it("does not acknowledge a reply ID attached to the wrong question", async () => {
  const x = await setup();
  await applyCopilotRecord(x.a, x.f, "copilot_message", {
    ...x.reply,
    replyToMessageId: x.oldParent.id,
  });
  await x.refresh();
  expect(view().error).toBeDefined();
  expect(view().status).toBe("QUEUED");
  expect((await x.controller.open(x.f.conversation.id)).pendingTurns).toEqual([
    x.request,
  ]);
});
it("does not acknowledge an answer dated before its question", async () => {
  const x = await setup();
  await applyCopilotRecord(x.a, x.f, "copilot_message", {
    ...x.reply,
    createdAt: "2020-01-01T00:00:00.000Z",
  });
  await x.refresh();
  expect(view().error).toBeDefined();
  expect(view().status).toBe("QUEUED");
  expect((await x.controller.open(x.f.conversation.id)).pendingTurns).toEqual([
    x.request,
  ]);
});
