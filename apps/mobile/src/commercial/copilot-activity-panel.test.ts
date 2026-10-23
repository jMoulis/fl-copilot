import { createElement, type ComponentProps, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createHash, randomUUID } from "node:crypto";
import {
  afterEach,
  beforeEach,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { CopilotActivityPanel } from "./copilot-activity-panel";
import {
  CopilotActivityRepository,
  type CopilotActivityEntry,
} from "./copilot-activity";
import { actionExecutionFixture } from "../../../../scripts/test-action-execution-fixtures";
import { saveDecision } from "../../../../scripts/test-copilot-decision-fixtures";
const runtime = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("expo-router", () => ({ router: { push: runtime.push } }));
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: async (_algorithm: string, text: string) =>
    createHash("sha256").update(text).digest("hex"),
}));
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
}));
vi.mock("../components/ui", () => ({
  SectionCard: ({ children }: { children: ReactNode }) => children,
  SecondaryButton: "Button",
  InlineAlert: "Alert",
  StatusBadge: "Badge",
}));
vi.mock("../components/dashboard", () => ({ SegmentedControl: "Segments" }));
let rendered: ReactTestRenderer | undefined,
  props: ComponentProps<typeof CopilotActivityPanel>,
  read: MockInstance<CopilotActivityRepository["page"]>;
const entry = (id = randomUUID()): CopilotActivityEntry => ({
  id,
  kind: "DECISION",
  conversationId: randomUUID(),
  at: "2026-10-18T12:00:00.000Z",
  label: "Tester une mise en avant",
  status: "ACCEPT",
  detail: null,
  postponedUntil: null,
  syncState: "PENDING",
  conversationAvailable: true,
  sourceAvailable: true,
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
  runtime.push.mockReset();
  read = vi
    .spyOn(CopilotActivityRepository.prototype, "page")
    .mockResolvedValue({ entries: [entry()], next: null });
  props = {
    db: {} as never,
    storeId: randomUUID(),
    ownerId: randomUUID(),
    weekStart: "2026-10-12",
    focused: true,
    revision: "synced",
    filter: "ALL",
    onFilter: vi.fn(),
    onNavigate: vi.fn(),
  };
});
afterEach(async () => {
  await act(async () => rendered?.unmount());
  rendered = undefined;
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => {
    const node = createElement(CopilotActivityPanel, props);
    if (rendered) rendered.update(node);
    else rendered = create(node);
  });
}
const button = (label: string) =>
  rendered!.root
    .findAllByType("Button" as never)
    .find((n) => n.props.label === label)!;
const rows = () => rendered!.root.findAllByType("Pressable" as never);
const text = () => JSON.stringify(rendered!.toJSON());
async function toggle() {
  await act(async () => button("Décisions et réalisations").props.onPress());
}
it("reads only on explicit opening and keeps pagination through folding and returning from its conversation", async () => {
  const first = entry(),
    next = { id: first.id, kind: first.kind, at: first.at };
  read.mockResolvedValueOnce({ entries: [first], next }).mockResolvedValue({
    entries: [{ ...entry(), label: "Page suivante" }],
    next: null,
  });
  await render();
  expect(read).not.toHaveBeenCalled();
  await toggle();
  expect(text()).toContain("Conseil retenu");
  expect(text()).not.toContain("Réalisation déclarée");
  await act(async () => rows()[0]!.props.onPress());
  expect(props.onNavigate).not.toHaveBeenCalled();
  expect(runtime.push).toHaveBeenCalledWith({
    pathname: "/copilot",
    params: { conversationId: first.conversationId },
  });
  await act(async () => button("Page suivante du suivi").props.onPress());
  expect(read.mock.lastCall?.[2]).toEqual(next);
  expect(props.onNavigate).toHaveBeenCalledTimes(1);
  expect(text()).toContain("Page suivante");
  await toggle();
  expect(read).toHaveBeenCalledTimes(2);
  await toggle();
  expect(read.mock.lastCall?.[2]).toEqual(next);
  expect(button("Page précédente du suivi")).toBeDefined();
  props = { ...props, focused: false };
  await render();
  props = { ...props, focused: true };
  await render();
  expect(read.mock.lastCall?.[2]).toEqual(next);
});
it("coalesces 300 syncing renders, rereads on a focused return even during sync, and permits explicit retry", async () => {
  props = { ...props, revision: "syncing" };
  await render();
  await toggle();
  for (let i = 0; i < 300; i++) await render();
  expect(read).toHaveBeenCalledTimes(1);
  props = { ...props, focused: false };
  await render();
  props = { ...props, focused: true };
  await render();
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => button("Actualiser le suivi").props.onPress());
  expect(read).toHaveBeenCalledTimes(3);
  props = { ...props, revision: "synced-pull-2" };
  await render();
  expect(read).toHaveBeenCalledTimes(4);
  await toggle();
  props = { ...props, revision: "synced-pull-3" };
  await render();
  expect(read).toHaveBeenCalledTimes(4);
});
it("preserves visible entries on read failure, recovers manually, and ignores late results after a scope change", async () => {
  const first = entry();
  read.mockResolvedValueOnce({ entries: [first], next: null });
  await render();
  await toggle();
  read.mockRejectedValueOnce(Error("private database detail"));
  props = { ...props, revision: "pull-2" };
  await render();
  expect(text()).toContain(first.label);
  expect(text()).not.toContain("private database detail");
  expect(rendered!.root.findAllByType("Alert" as never)).toHaveLength(1);
  await act(async () => button("Actualiser le suivi").props.onPress());
  expect(rendered!.root.findAllByType("Alert" as never)).toHaveLength(0);
  let resolve!: (value: {
    entries: CopilotActivityEntry[];
    next: null;
  }) => void;
  read.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  props = { ...props, revision: "pull-3" };
  await render();
  read.mockResolvedValue({
    entries: [{ ...entry(), label: "Nouveau compte" }],
    next: null,
  });
  props = { ...props, ownerId: randomUUID() };
  await render();
  await act(async () =>
    resolve({
      entries: [{ ...entry(), label: "Ancien compte secret" }],
      next: null,
    }),
  );
  expect(text()).toContain("Nouveau compte");
  expect(text()).not.toContain("Ancien compte secret");
});
it("keeps its open state across week changes, resets the page, and exposes no action on an unavailable conversation", async () => {
  const first = entry(),
    next = { id: first.id, kind: first.kind, at: first.at };
  read.mockResolvedValue({ entries: [first], next });
  await render();
  await toggle();
  await act(async () => button("Page suivante du suivi").props.onPress());
  read.mockResolvedValue({
    entries: [
      { ...entry(), conversationAvailable: false, sourceAvailable: false },
    ],
    next: null,
  });
  props = { ...props, weekStart: "2026-10-19" };
  await render();
  expect(read.mock.lastCall).toEqual(["2026-10-19", "ALL", undefined]);
  expect(rows()[0]!.props.disabled).toBe(true);
  expect(text()).toContain("enregistrement conservé");
});
it("renders genuine SQLite decisions and declarations without a commercial plan, and navigating writes no command", async () => {
  read.mockRestore();
  const f = await actionExecutionFixture();
  try {
    await saveDecision(f, "ACCEPT");
    const initial = await f.repository.open(f.actionCard);
    await f.repository.save(f.actionCard, initial.review);
    props = {
      ...props,
      db: f.db,
      storeId: f.scope.storeId,
      ownerId: f.scope.ownerId,
    };
    const before = await f.db.getFirstAsync(
      "SELECT COUNT(*) n FROM sync_outbox",
    );
    await render();
    await toggle();
    expect(rows()).toHaveLength(2);
    expect(text()).toContain("Conseil retenu");
    expect(text()).toContain("Réalisation déclarée");
    await act(async () => rows()[0]!.props.onPress());
    expect(runtime.push.mock.lastCall?.[0].params.conversationId).toBe(
      f.conversation.id,
    );
    expect(
      await f.db.getFirstAsync("SELECT COUNT(*) n FROM sync_outbox"),
    ).toEqual(before);
  } finally {
    await act(async () => rendered?.unmount());
    rendered = undefined;
    f.db.db.close();
  }
});
