import { expect, it } from "vitest";
import { copilotTurnRequestSchema } from "./copilot-turn";
const input = {
  replyId: "00000000-0000-4000-8000-000000000001",
  conversationId: "00000000-0000-4000-8000-000000000002",
  userMessageId: "00000000-0000-4000-8000-000000000003",
};
it("accepts stable application IDs and rejects client-authored authority or model context", () => {
  expect(copilotTurnRequestSchema.parse(input)).toEqual(input);
  for (const extra of [
    { ownerId: input.replyId },
    { canRespond: true },
    { context: {} },
    { model: "custom" },
  ])
    expect(
      copilotTurnRequestSchema.safeParse({ ...input, ...extra }).success,
    ).toBe(false);
  expect(
    copilotTurnRequestSchema.safeParse({ ...input, replyId: "not-a-uuid" })
      .success,
  ).toBe(false);
});
