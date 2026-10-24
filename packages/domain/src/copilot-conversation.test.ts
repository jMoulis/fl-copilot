import { it, expect } from "vitest";
import {
  copilotConversationSchema,
  preserveCopilotConversationDeletions,
  copilotConversationMetadataEqual,
  copilotMessageIsDeleted,
  copilotMessageSchema,
} from "./copilot-conversation";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const message = {
  id: id(1),
  storeId: id(2),
  ownerId: id(3),
  conversationId: id(4),
  role: "USER",
  text: "",
  attachments: [
    {
      sourceDocumentId: id(5),
      filename: "000123.xlsx",
      mediaType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  ],
  replyToMessageId: null,
  supersedesMessageId: null,
  version: 1,
  createdAt: "2026-10-11T12:00:00Z",
};
it("keeps an attachment-only user message and leading-zero filename without accepting embedded URLs/authority", () => {
  expect(copilotMessageSchema.parse(message).attachments[0]!.filename).toBe(
    "000123.xlsx",
  );
  expect(() =>
    copilotMessageSchema.parse({
      ...message,
      attachments: [
        { ...message.attachments[0], url: "https://private.example" },
      ],
    }),
  ).toThrow();
  expect(() =>
    copilotMessageSchema.parse({ ...message, actorRole: "ADMIN" }),
  ).toThrow();
});
it("rejects empty/duplicate/self-referencing messages and preserves append-only version one", () => {
  for (const m of [
    { ...message, attachments: [] },
    {
      ...message,
      attachments: [...message.attachments, ...message.attachments],
    },
    { ...message, replyToMessageId: message.id },
    { ...message, version: 2 },
  ])
    expect(() => copilotMessageSchema.parse(m)).toThrow();
});
it("rejects invalid conversation identity/time and archived conversation status is explicit", () => {
  const c = {
    id: id(1),
    storeId: id(2),
    ownerId: id(3),
    title: "Titre",
    status: "ARCHIVED",
    version: 2,
    createdAt: "2026-10-11T12:00:00Z",
    updatedAt: "2026-10-11T12:00:00Z",
  };
  expect(copilotConversationSchema.parse(c).status).toBe("ARCHIVED");
  expect(() =>
    copilotConversationSchema.parse({
      ...c,
      updatedAt: "2026-10-10T12:00:00Z",
    }),
  ).toThrow();
});

it("normalizes equivalent instants for stable chronological pagination", () => {
  const a = copilotMessageSchema.parse(message),
    b = copilotMessageSchema.parse({
      ...message,
      createdAt: "2026-10-11T12:00:00.000Z",
    });
  expect(a.createdAt).toBe(b.createdAt);
});

it("keeps canonical deletion time, unions tombstones and hides replies/cards without changing metadata authority", () => {
  const c = copilotConversationSchema.parse({
      id: id(4),
      storeId: id(2),
      ownerId: id(3),
      title: "Titre",
      status: "ACTIVE",
      version: 2,
      createdAt: "2026-10-11T12:00:00Z",
      updatedAt: "2026-10-11T12:00:00Z",
    }),
    canonical = copilotConversationSchema.parse({
      ...c,
      deletedAt: "2026-10-13T12:00:00Z",
      updatedAt: "2026-10-13T12:00:00Z",
      status: "ARCHIVED",
      deletedMessageIds: [id(1)],
    }),
    local = copilotConversationSchema.parse({
      ...canonical,
      deletedAt: "2026-10-12T12:00:00Z",
      updatedAt: "2026-10-12T12:00:00Z",
      deletedMessageIds: [id(6)],
    }),
    resolved = preserveCopilotConversationDeletions(c, canonical, local);
  expect(resolved.deletedAt).toBe(canonical.deletedAt);
  expect(resolved.updatedAt).toBe(canonical.deletedAt);
  expect(resolved.status).toBe("ARCHIVED");
  expect(resolved.deletedMessageIds).toEqual([id(1), id(6)]);
  expect(resolved.title).toBe(c.title);
  const question = copilotMessageSchema.parse({ ...message, text: "Question" });
  expect(copilotMessageIsDeleted(question, resolved)).toBe(true);
  const subset = { deletedMessageIds: [question.id] };
  expect(
    copilotMessageIsDeleted(
      {
        ...question,
        id: id(7),
        role: "ASSISTANT",
        replyToMessageId: question.id,
      },
      subset,
    ),
  ).toBe(true);
  expect(
    copilotMessageIsDeleted(
      {
        ...question,
        id: id(8),
        role: "TOOL",
        text: JSON.stringify({ assistantMessageId: id(6) }),
      },
      { deletedMessageIds: [id(6)] },
    ),
  ).toBe(true);
  expect(
    copilotConversationMetadataEqual(resolved, {
      ...resolved,
      version: 99,
      deletedMessageIds: [id(6), id(1)],
    }),
  ).toBe(true);
});
it("rejects foreign deletion identity and an oversized union rather than trimming or deleting the entire conversation", () => {
  const c = copilotConversationSchema.parse({
    id: id(4),
    storeId: id(2),
    ownerId: id(3),
    title: "Titre",
    status: "ACTIVE",
    version: 2,
    createdAt: "2026-10-11T12:00:00Z",
    updatedAt: "2026-10-11T12:00:00Z",
  });
  expect(() =>
    preserveCopilotConversationDeletions(c, { ...c, ownerId: id(9) }),
  ).toThrow("IDENTITY_INVALID");
  const a = {
    ...c,
    deletedMessageIds: Array.from({ length: 500 }, (_, n) => id(100 + n)),
  };
  expect(() =>
    preserveCopilotConversationDeletions(c, a, {
      ...c,
      deletedMessageIds: [id(700)],
    }),
  ).toThrow("DELETION_REVIEW_LIMIT");
  expect(a.deletedMessageIds).toHaveLength(500);
  expect(c).not.toHaveProperty("deletedAt");
});
