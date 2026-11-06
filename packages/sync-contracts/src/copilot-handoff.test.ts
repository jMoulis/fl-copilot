import { expect, it } from "vitest";
let sequence = 0;
const randomUUID = () =>
  `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import { copilotTurnTransportRequestSchema } from "./copilot-handoff";
const f = chatFixture(randomUUID);
const plain: typeof f.message = { ...f.message, attachments: [] };
const ids = {
  conversationId: f.conversation.id,
  userMessageId: plain.id,
  replyId: randomUUID(),
};
const packet = {
  syncProtocolVersion: 1,
  appVersion: "test",
  storeId: f.storeId,
  deviceId: f.deviceId,
  commands: [
    {
      commandId: randomUUID(),
      localSequence: 1,
      type: "COPILOT_MESSAGE_APPEND",
      entityType: "copilot_message",
      entityId: plain.id,
      createdAt: plain.createdAt,
      payload: plain,
    },
  ],
};
it("retains old ID-only requests and allows the exact canonical plain-question command", () => {
  expect(copilotTurnTransportRequestSchema.parse(ids)).toEqual(ids);
  expect(
    copilotTurnTransportRequestSchema.parse({ ...ids, synchronization: packet })
      .synchronization,
  ).toEqual(packet);
});
it.each([
  "other-message",
  "business-command",
  "assistant",
  "attachment",
  "other-store",
  "empty",
])("rejects unrelated or unsuitable intake: %s", (mode) => {
  const input = JSON.parse(
    JSON.stringify({ ...ids, synchronization: packet }),
  ) as { synchronization: typeof packet } & typeof ids;
  const command = input.synchronization.commands[0]!;
  if (mode === "other-message") command.entityId = randomUUID();
  if (mode === "business-command") command.entityType = "product";
  if (mode === "assistant") command.payload.role = "ASSISTANT";
  if (mode === "attachment")
    command.payload.attachments = f.message.attachments;
  if (mode === "other-store") input.synchronization.storeId = randomUUID();
  if (mode === "empty") input.synchronization.commands = [];
  expect(copilotTurnTransportRequestSchema.safeParse(input).success).toBe(
    false,
  );
});
