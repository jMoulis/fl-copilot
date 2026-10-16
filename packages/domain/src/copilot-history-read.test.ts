import { expect, it } from "vitest";
import {
  copilotHistoryReadInputSchema,
  copilotHistoryReadResultSchema,
} from "./copilot-history-read";
const uuid = "11111111-1111-4111-8111-111111111111";
it("accepts only bounded context lookups, with no model-controlled tenant or topic", () => {
  const input = { query: null, before: null, limit: 5 };
  expect(copilotHistoryReadInputSchema.parse(input)).toEqual(input);
  for (const patch of [
    { storeId: uuid },
    { ownerId: uuid },
    { conversationId: uuid },
    { limit: 6 },
    { limit: 0 },
    { query: "a" },
    { query: "a".repeat(121) },
  ]) {
    expect(
      copilotHistoryReadInputSchema.safeParse({ ...input, ...patch }).success,
    ).toBe(false);
  }
});
it("rejects incomplete cursors, duplicate or oversized messages and official evidence", () => {
  const result = {
    messages: [],
    hasMore: false,
    nextBefore: null,
    sources: [],
    sourcesOmitted: false,
    evidence: [],
  };
  expect(copilotHistoryReadResultSchema.parse(result)).toEqual(result);
  expect(
    copilotHistoryReadResultSchema.safeParse({ ...result, hasMore: true })
      .success,
  ).toBe(false);
  expect(
    copilotHistoryReadResultSchema.safeParse({ ...result, evidence: [{}] })
      .success,
  ).toBe(false);
  const message = {
    id: uuid,
    role: "USER",
    text: "Texte",
    attachments: [],
    createdAt: "2026-10-16T12:00:00.000Z",
  };
  expect(
    copilotHistoryReadResultSchema.safeParse({
      ...result,
      messages: [message, message],
    }).success,
  ).toBe(false);
  expect(
    copilotHistoryReadResultSchema.safeParse({
      ...result,
      messages: [{ ...message, role: "TOOL" }],
    }).success,
  ).toBe(false);
  expect(
    copilotHistoryReadResultSchema.safeParse({
      ...result,
      messages: [
        { ...message, text: "a".repeat(16000) },
        {
          ...message,
          id: "22222222-2222-4222-8222-222222222222",
          text: "b".repeat(3000),
        },
      ],
    }).success,
  ).toBe(false);
});
