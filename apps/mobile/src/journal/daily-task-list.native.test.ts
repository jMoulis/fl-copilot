import { notifyOutboxChanged } from "../sync/outbox-repository";
import { DatabaseSync } from "node:sqlite";
import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../db/migrations";
import { PersonalTaskRepository } from "./personal-task-repository";
import { DailyTaskList } from "./daily-task-list";
const runtime = vi.hoisted(() => ({
  sqlite: undefined as unknown,
  sync: vi.fn(async () => {}),
  refresh: vi.fn(async () => {}),
  permission: vi.fn(async () => false),
  navigate: vi.fn(),
  alert: vi.fn(),
}));
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  TextInput: "Input",
  Pressable: "Pressable",
  Switch: "Switch",
  Alert: { alert: runtime.alert },
  StyleSheet: { create: (s: unknown) => s },
}));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("expo-router", () => ({
  useFocusEffect: (f: () => void) => useEffect(f, [f]),
  router: { push: runtime.navigate },
}));
vi.mock("expo-crypto", async () => {
  const c = await import("node:crypto");
  return {
    randomUUID: c.randomUUID,
    CryptoDigestAlgorithm: { SHA256: "sha256" },
    digestStringAsync: async (_: string, s: string) =>
      c.createHash("sha256").update(s).digest("hex"),
  };
});
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => ({
    sqlite: runtime.sqlite,
    deviceId: "22222222-2222-4222-8222-222222222222",
  }),
}));
vi.mock("../sync/sync-provider", () => ({
  useSync: () => ({ syncNow: runtime.sync, lastSyncedAt: undefined }),
}));
vi.mock("../reminders/provider", () => ({
  useReminders: () => ({ refresh: runtime.refresh }),
}));
vi.mock("../reminders/native", () => ({
  requestReminderPermission: runtime.permission,
}));
vi.mock("../components/date-selector", () => ({
  DateSelector: "DateSelector",
}));
vi.mock("../components/ui", () => ({
  BottomSheet: ({
    visible,
    children,
    ...props
  }: {
    visible: boolean;
    children: unknown;
  }) => (visible ? createElement("Sheet", props, children as never) : null),
  InlineAlert: "Alert",
  PrimaryButton: "Button",
  SecondaryButton: "Button",
}));
const scope = {
  storeId: "11111111-1111-4111-8111-111111111111",
  ownerId: "33333333-3333-4333-8333-333333333333",
};
let raw: DatabaseSync, tree: ReactTestRenderer | undefined;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  raw = new DatabaseSync(":memory:");
  const db = new VisualTestDatabase(raw);
  await runLocalMigrations(db);
  runtime.sqlite = db;
  runtime.sync.mockReset().mockRejectedValue(Error("offline"));
  runtime.refresh.mockReset().mockResolvedValue(undefined);
  runtime.permission.mockClear();
  runtime.alert.mockReset();
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
  raw.close();
  vi.unstubAllGlobals();
});
const node = (type: string, label: string) =>
  tree!.root.findAll(
    (n) =>
      n.type === (type as never) &&
      (n.props.accessibilityLabel === label || n.props.label === label),
  )[0]!;
async function mount() {
  await act(async () => {
    tree = create(
      createElement(DailyTaskList, {
        scope,
        date: "2026-11-14",
        today: "2026-11-14",
        onTaskOpened: () => {},
      }),
    );
  });
}
it("keeps personal tasks available when the current commercial plan cannot be read", async () => {
  const db = runtime.sqlite as VisualTestDatabase;
  await new PersonalTaskRepository(db, scope).save(
    "55555555-5555-4555-8555-555555555555",
    { text: "Mon pense-bête", date: "2026-11-14", time: null, status: "TODO" },
    null,
    {
      deviceId: "22222222-2222-4222-8222-222222222222",
      commandId: "66666666-6666-4666-8666-666666666666",
      now: "2026-11-14T08:00:00.000Z",
      canWrite: () => true,
    },
  );
  await db.runAsync(
    "INSERT INTO commercial_week_plans(id,store_id,week_start,payload_json,sync_state,dirty) VALUES(?,?,?,'{}','SYNCED',0)",
    "77777777-7777-4777-8777-777777777777",
    scope.storeId,
    "2026-11-09",
  );
  await mount();
  expect(node("Pressable", "Détails : Mon pense-bête")).toBeDefined();
  expect(
    tree!.root.findAllByType("Alert" as never)[0]?.props.message,
  ).toContain("Tes pense-bêtes restent disponibles");
});
it("captures an offline private reminder for the selected day before requesting notification permission", async () => {
  await mount();
  const add = tree!.root.findAll(
    (n) =>
      n.type === ("Pressable" as never) &&
      n.props.style?.backgroundColor === "#AEE9B6",
  )[0];
  // The visible Add button keeps the approved compact label; find it by its child.
  const button =
    add ??
    tree!.root.findAll(
      (n) =>
        n.type === ("Pressable" as never) &&
        n
          .findAllByType("Text" as never)
          .some((t) => t.children.includes("Ajouter")),
    )[0]!;
  await act(async () => button.props.onPress());
  await act(async () =>
    node("Input", "À faire").props.onChangeText("Contrôler les avocats"),
  );
  await act(async () =>
    node("Switch", "À une heure précise").props.onValueChange(true),
  );
  await act(async () =>
    node("Switch", "Me rappeler sur cet appareil").props.onValueChange(true),
  );
  runtime.permission.mockImplementationOnce(async () => {
    expect(raw.prepare("SELECT count(*) n FROM personal_tasks").get()!.n).toBe(
      1,
    );
    expect(raw.prepare("SELECT count(*) n FROM sync_outbox").get()!.n).toBe(1);
    return false;
  });
  await act(async () =>
    node("Button", "Enregistrer le pense-bête").props.onPress(),
  );
  const repo = new PersonalTaskRepository(
      runtime.sqlite as VisualTestDatabase,
      scope,
    ),
    rows = await repo.list("2026-11-14", "2026-11-14");
  expect(rows[0]?.entity).toMatchObject({
    text: "Contrôler les avocats",
    date: "2026-11-14",
    time: "16:00",
    status: "TODO",
  });
  expect(runtime.permission).toHaveBeenCalledOnce();
  expect(tree!.root.findAllByType("Sheet" as never)).toHaveLength(0);
  expect(
    await new PersonalTaskRepository(runtime.sqlite as VisualTestDatabase, {
      ...scope,
      ownerId: "44444444-4444-4444-8444-444444444444",
    }).list("2026-11-14", "2026-11-14"),
  ).toEqual([]);
});
it("blocks native dismissal of a changed task while retaining the explicit close confirmation", async () => {
  await mount();
  const add = tree!.root.findAll(
    (n) =>
      n.type === ("Pressable" as never) &&
      n
        .findAllByType("Text" as never)
        .some((text) => text.children.includes("Ajouter")),
  )[0]!;
  await act(() => add.props.onPress());
  expect(tree!.root.findByType("Sheet" as never).props.dismissible).toBe(true);
  await act(() =>
    node("Input", "À faire").props.onChangeText("Vérifier les bananes"),
  );
  expect(tree!.root.findByType("Sheet" as never).props.dismissible).toBe(false);
  await act(() => tree!.root.findByType("Sheet" as never).props.onClose());
  expect(runtime.alert).toHaveBeenCalledOnce();
  expect(node("Input", "À faire").props.value).toBe("Vérifier les bananes");
  expect(raw.prepare("SELECT count(*) n FROM sync_outbox").get()!.n).toBe(0);
  await act(() => node("Input", "À faire").props.onChangeText(""));
  expect(tree!.root.findByType("Sheet" as never).props.dismissible).toBe(true);
  await act(() => tree!.root.findByType("Sheet" as never).props.onClose());
  expect(tree!.root.findAllByType("Sheet" as never)).toHaveLength(0);
});
it("does not create reminders or request permission for an untimed note and reopens a completed task explicitly", async () => {
  await mount();
  const add = tree!.root.findAll(
    (n) =>
      n.type === ("Pressable" as never) &&
      n
        .findAllByType("Text" as never)
        .some((t) => t.children.includes("Ajouter")),
  )[0]!;
  await act(async () => add.props.onPress());
  await act(async () =>
    node("Input", "À faire").props.onChangeText("Préparer les agrumes"),
  );
  await act(async () =>
    node("Button", "Enregistrer le pense-bête").props.onPress(),
  );
  expect(runtime.permission).not.toHaveBeenCalled();
  await act(async () =>
    node("Pressable", "Terminer : Préparer les agrumes").props.onPress(),
  );
  const repo = new PersonalTaskRepository(
      runtime.sqlite as VisualTestDatabase,
      scope,
    ),
    task = (await repo.list("2026-11-14", "2026-11-14"))[0]!.entity;
  expect(task.status).toBe("DONE");
  expect(task.completedAt).not.toBeNull();
  const history = tree!.root.findAll(
    (n) =>
      n.type === ("Pressable" as never) &&
      n
        .findAllByType("Text" as never)
        .some((t) => t.children.join("").includes("Terminés et annulés")),
  )[0]!;
  await act(async () => history.props.onPress());
  await act(async () =>
    node("Pressable", "Rouvrir : Préparer les agrumes").props.onPress(),
  );
  expect((await repo.get(task.id))?.entity).toMatchObject({
    status: "TODO",
    completedAt: null,
  });
});

it("reserves list height while changing days, ignores late reads and preserves same-day content on refresh", async () => {
  await mount();
  const list = tree!.root.find(
    (n) => String(n.type) === "View" && typeof n.props.onLayout === "function",
  );
  await act(() =>
    list.props.onLayout({ nativeEvent: { layout: { height: 176 } } }),
  );
  type Rows = Awaited<ReturnType<PersonalTaskRepository["list"]>>;
  const reads = new Map<string, (rows: Rows) => void>();
  const spy = vi
    .spyOn(PersonalTaskRepository.prototype, "list")
    .mockImplementation(
      (date) => new Promise<Rows>((resolve) => reads.set(date, resolve)),
    );
  const render = (date: string) =>
    createElement(DailyTaskList, {
      scope,
      date,
      today: "2026-11-14",
      onTaskOpened() {},
    });
  const placeholders = () =>
    tree!.root.findAll(
      (n) =>
        String(n.type) === "View" &&
        n.props.accessibilityRole === "progressbar",
    );
  try {
    await act(async () => {
      notifyOutboxChanged();
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(placeholders()).toHaveLength(0);
    await act(() => reads.get("2026-11-14")!([]));
    await act(() => tree!.update(render("2026-11-15")));
    expect(placeholders()).toHaveLength(1);
    expect(placeholders()[0]!.props.style.height).toBe(176);
    await act(() => tree!.update(render("2026-11-16")));
    await act(() => reads.get("2026-11-15")!([]));
    expect(placeholders()).toHaveLength(1);
    await act(() => reads.get("2026-11-16")!([]));
    expect(placeholders()).toHaveLength(0);
  } finally {
    spy.mockRestore();
  }
});
