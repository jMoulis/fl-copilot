import { DatabaseSync } from "node:sqlite";
import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../db/migrations";
import { JournalNoteRepository } from "./journal-note-repository";
import { JournalNotes } from "./journal-notes";
const runtime = vi.hoisted(() => ({
  sqlite: undefined as unknown,
  syncNow: vi.fn(async () => {}),
  alert: vi.fn(),
}));
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  TextInput: "Input",
  Pressable: "Pressable",
  Alert: { alert: runtime.alert },
}));
vi.mock("expo-router", () => ({
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
}));
vi.mock("expo-crypto", async () => ({
  randomUUID: (await import("node:crypto")).randomUUID,
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => ({
    sqlite: runtime.sqlite,
    deviceId: "22222222-2222-4222-8222-222222222222",
  }),
}));
vi.mock("../sync/sync-provider", () => ({
  useSync: () => ({ syncNow: runtime.syncNow, lastSyncedAt: undefined }),
}));
vi.mock("../components/ui", () => ({
  BottomSheet: ({
    visible,
    children,
  }: {
    visible: boolean;
    children: unknown;
  }) => (visible ? createElement("Sheet", {}, children as never) : null),
  InlineAlert: "Alert",
  PrimaryButton: "Button",
  SecondaryButton: "Button",
}));
const storeId = "11111111-1111-4111-8111-111111111111";
let tree: ReactTestRenderer | undefined, raw: DatabaseSync;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  raw = new DatabaseSync(":memory:");
  const db = new VisualTestDatabase(raw);
  await runLocalMigrations(db);
  runtime.sqlite = db;
  runtime.syncNow.mockReset().mockRejectedValue(Error("offline"));
  runtime.alert.mockReset();
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
  raw.close();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => {
    tree = create(createElement(JournalNotes, { storeId, date: "2026-11-12" }));
  });
}
function button(label: string) {
  return tree!.root.findAll(
    (n) => n.type === ("Button" as never) && n.props.label === label,
  )[0]!;
}
function pressable(label: string) {
  return tree!.root.findAll(
    (n) =>
      n.type === ("Pressable" as never) && n.props.accessibilityLabel === label,
  )[0]!;
}
function input(label: string) {
  return tree!.root.findAll(
    (n) =>
      n.type === ("Input" as never) && n.props.accessibilityLabel === label,
  )[0]!;
}
it("records a note for the selected Journal day with an optional period even when synchronization fails", async () => {
  await mount();
  await act(async () =>
    pressable("Ajouter une note du magasin").props.onPress(),
  );
  await act(async () =>
    input("Note du magasin").props.onChangeText("Livraison en retard"),
  );
  await act(async () => button("Ajouter une période").props.onPress());
  await act(async () =>
    input("Dernier jour de la note, AAAA-MM-JJ").props.onChangeText(
      "2026-11-11",
    ),
  );
  await act(async () => button("Enregistrer la note").props.onPress());
  expect(input("Note du magasin").props.value).toBe("Livraison en retard");
  expect(
    (
      await new JournalNoteRepository(
        runtime.sqlite as VisualTestDatabase,
      ).list(storeId, "2026-11-12")
    ).rows,
  ).toHaveLength(0);
  await act(async () =>
    input("Dernier jour de la note, AAAA-MM-JJ").props.onChangeText(
      "2026-11-14",
    ),
  );
  await act(async () => button("Enregistrer la note").props.onPress());
  const saved = (
    await new JournalNoteRepository(runtime.sqlite as VisualTestDatabase).list(
      storeId,
      "2026-11-14",
    )
  ).rows[0]!;
  expect(saved.entity).toMatchObject({
    text: "Livraison en retard",
    startDate: "2026-11-12",
    endDate: "2026-11-14",
  });
  expect(saved.syncState).toBe("PENDING");
  expect(tree!.root.findAllByType("Sheet" as never)).toHaveLength(0);
});
it("does not discard an unsaved draft without confirmation", async () => {
  await mount();
  await act(async () =>
    pressable("Ajouter une note du magasin").props.onPress(),
  );
  await act(async () =>
    input("Note du magasin").props.onChangeText("Accès compliqué"),
  );
  // BottomSheet's onClose is the same path for swipe, dismiss and close button.
  const sheet = tree!.root.findAll(
    (n) =>
      typeof n.type === "function" && n.props.title === "Noter dans le Journal",
  )[0]!;
  await act(async () => sheet.props.onClose());
  expect(runtime.alert).toHaveBeenCalled();
  expect(input("Note du magasin").props.value).toBe("Accès compliqué");
  const choices = runtime.alert.mock.calls[0]![2] as {
    text: string;
    onPress?: () => void;
  }[];
  await act(async () =>
    choices.find((c) => c.text === "Abandonner")!.onPress!(),
  );
  expect(tree!.root.findAllByType("Sheet" as never)).toHaveLength(0);
});
