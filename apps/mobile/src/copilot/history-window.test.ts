import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import { mergeCopilotHistory, type CopilotHistoryPage } from "./history-window";
const fixture = chatFixture(randomUUID);
function page(indices: number[], hasMore: boolean): CopilotHistoryPage {
  const messages = indices.map((index) => ({
    entity: {
      ...fixture.message,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      text: `Message ${index}`,
    },
    syncState: "SYNCED",
  }));
  const first = messages[0]?.entity;
  return {
    messages,
    hasMore,
    before: first ? { id: first.id, createdAt: first.createdAt } : null,
  };
}
it("retains older loaded pages and cursor across overlapping latest refreshes, without duplicates while refreshing synchronization state", () => {
  const older = mergeCopilotHistory(
    page([3, 4, 5], true),
    page([1, 2], false),
    "OLDER",
  );
  const refreshed = page([4, 5, 6], true);
  older.messages.find(
    (record) => record.entity.id === refreshed.messages[0]!.entity.id,
  )!.syncState = "PENDING";
  const merged = mergeCopilotHistory(older, refreshed);
  expect(merged.messages.map((m) => m.entity.text)).toEqual([
    "Message 1",
    "Message 2",
    "Message 3",
    "Message 4",
    "Message 5",
    "Message 6",
  ]);
  expect(merged.hasMore).toBe(false);
  expect(merged.before).toEqual(older.before);
  expect(
    merged.messages.find(
      (record) => record.entity.id === refreshed.messages[0]!.entity.id,
    )?.syncState,
  ).toBe("SYNCED");
});
it("marks an empty older-page result exhausted, preserving loaded content for a race at the boundary", () => {
  const loaded = page([2, 3], true);
  const end = mergeCopilotHistory(loaded, page([], false), "OLDER");
  expect(end.messages).toEqual(loaded.messages);
  expect(end.hasMore).toBe(false);
  expect(end.before).toEqual(loaded.before);
});
it.each(["storeId", "ownerId", "conversationId"] as const)(
  "refuses cross-%s page merging",
  (key) => {
    const incoming = page([1], false);
    incoming.messages[0]!.entity = {
      ...incoming.messages[0]!.entity,
      [key]: randomUUID(),
    };
    expect(() =>
      mergeCopilotHistory(page([2], true), incoming, "OLDER"),
    ).toThrow("COPILOT_HISTORY_SCOPE_INVALID");
  },
);
