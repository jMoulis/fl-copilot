import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
const mocks = vi.hoisted(() => ({
  sheet: vi.fn(),
  alert: vi.fn(),
  copy: vi.fn(async () => true),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  ActionSheetIOS: { showActionSheetWithOptions: mocks.sheet },
  Alert: { alert: mocks.alert },
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: mocks.copy }));
import { showMessageMenu } from "./message-menu";
it("opens a native context menu without deleting on long press or cancel, and strips private metadata when copying", async () => {
  const f = chatFixture(randomUUID),
    remove = vi.fn();
  showMessageMenu(
    { ...f.message, text: "Réponse [Source](copilot-source:private-metadata)" },
    remove,
  );
  const [options, choose] = mocks.sheet.mock.calls.at(-1)!;
  expect(options.options).toEqual(["Copier", "Supprimer", "Annuler"]);
  choose(2);
  expect(remove).not.toHaveBeenCalled();
  choose(0);
  await vi.waitFor(() =>
    expect(mocks.copy).toHaveBeenCalledWith("Réponse Source"),
  );
  choose(1);
  expect(remove).toHaveBeenCalledOnce();
});
it("offers delete/cancel for attachment-only messages without an empty copy action", () => {
  const f = chatFixture(randomUUID),
    remove = vi.fn();
  showMessageMenu({ ...f.message, text: "" }, remove);
  const [options, choose] = mocks.sheet.mock.calls.at(-1)!;
  expect(options.options).toEqual(["Supprimer", "Annuler"]);
  choose(1);
  expect(remove).not.toHaveBeenCalled();
  choose(0);
  expect(remove).toHaveBeenCalledOnce();
});
