import { it, expect } from "vitest";
import {
  copilotConversationSchema,
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
