import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { RecommendationDecisionCard } from "./recommendation-decision-card";
import { nativeRecommendationDecisionConflictFixture } from "../../../../scripts/test-recommendation-decision-conflict-fixtures";
import {
  decisionNativeFixture,
  decisionChoiceFixture,
} from "../../../../scripts/test-copilot-decision-fixtures";
import { OutboxRepository } from "../sync/outbox-repository";
import { ConflictRepository } from "../sync/conflict-repository";
import { applyDecisionRecord } from "./decision-repository";
import { recommendationDecisionSchema } from "@fl-copilot/domain";
const runtime = vi.hoisted(() => ({ focused: true, sync: vi.fn() }));
vi.mock("./chat-text", () => ({ ChatText: "Text" }));
vi.mock("../components/date-selector", () => ({
  DateSelector: "DateSelector",
}));
vi.mock("@/sync/sync-provider", () => ({
  useSync: () => ({ syncNow: runtime.sync }),
}));
vi.mock("@/components/ui", () => ({
  SectionCard: "Card",
  SecondaryButton: "Button",
  InlineAlert: "Alert",
}));
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  Switch: "Switch",
  Pressable: "Pressable",
  TextInput: "Input",
  ActivityIndicator: "Spinner",
}));
vi.mock("expo-router", () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    const focus = runtime.focused;
    useEffect(() => (focus ? cb() : undefined), [cb, focus]);
  },
}));
let tree: ReactTestRenderer | undefined;
const close: Array<() => void> = [];
function hosts(tag: string) {
  return tree!.root.findAll(
    (n) => typeof n.type === "string" && n.type === tag,
  );
}
function button(label: string) {
  return hosts("Button").find((n) => n.props.label === label)!;
}
function pressable(label: string) {
  return hosts("Pressable").find(
    (n) =>
      n.props.accessibilityLabel === label ||
      n
        .findAll((c) => typeof c.type === "string" && String(c.type) === "Text")
        .some((c) => c.props.children === label),
  )!;
}
function text() {
  return hosts("Text")
    .map((n) => String(n.props.children))
    .join("\n");
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function view(
  f: Awaited<ReturnType<typeof decisionNativeFixture>>,
  canConfirm = true,
) {
  return createElement(RecommendationDecisionCard, {
    message: f.card,
    repository: f.repo,
    canConfirm,
  });
}
async function mountConflict() {
  const s = await nativeRecommendationDecisionConflictFixture();
  close.push(() => s.db.close());
  await act(async () => {
    tree = create(view(s.f));
  });
  return s;
}
async function choose() {
  await act(async () => hosts("Switch")[0]!.props.onValueChange(true));
  await act(async () => button("Conserver ma version locale").props.onPress());
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runtime.focused = true;
  runtime.sync.mockReset().mockResolvedValue(undefined);
  const error = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      error(...args);
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  for (const c of close.splice(0)) c();
});
it("keeps an edited action across blur/refocus and saves it through the real canonical writer", async () => {
  const f = await decisionNativeFixture();
  close.push(() => f.db.db.close());
  await act(async () => {
    tree = create(view(f));
  });
  await act(async () => pressable("Modifier").props.onPress());
  await act(async () =>
    hosts("Input")
      .find((n) => n.props.accessibilityLabel === "Action modifiée")!
      .props.onChangeText("Une TG plus petite"),
  );
  runtime.focused = false;
  await act(async () => tree!.update(view(f)));
  runtime.focused = true;
  await act(async () => tree!.update(view(f)));
  expect(
    hosts("Input").find(
      (n) => n.props.accessibilityLabel === "Action modifiée",
    )!.props.value,
  ).toBe("Une TG plus petite");
  await act(async () => pressable("Enregistrer ma décision").props.onPress());
  expect((await f.repo.open(f.card)).decision!.revisions.at(-1)).toMatchObject({
    type: "MODIFY",
    modifiedAction: "Une TG plus petite",
  });
  expect(
    (await new OutboxRepository(f.db).listPending(f.storeId)).filter(
      (c) => c.entityType === "copilot_decision",
    ),
  ).toHaveLength(1);
});
it("refreshes the parent after commit and after synchronization even once the child review unmounts", async () => {
  const s = await mountConflict(),
    gate = deferred();
  runtime.sync.mockReturnValueOnce(gate.promise);
  await choose();
  expect(hosts("Switch")).toHaveLength(0);
  expect(text()).toContain("Décision enregistrée sur cet appareil");
  const command = (
      await new OutboxRepository(s.a).listPending(s.scope.storeId)
    )[0]!,
    remote = recommendationDecisionSchema.parse({
      ...s.review.remote,
      version: 2,
      revisions: [
        ...s.review.remote.revisions,
        {
          ...s.review.remote.revisions[0]!,
          ...decisionChoiceFixture("ACCEPT"),
          version: 2,
        },
      ],
    });
  await applyDecisionRecord(s.a, s.scope, remote);
  await new ConflictRepository(s.a).recordPushConflict(command, {
    commandId: command.commandId,
    entityType: command.entityType,
    entityId: command.entityId,
    status: "CONFLICT",
    remoteEntity: remote,
    remoteVersion: 2,
  });
  await s.a.runAsync("UPDATE copilot_decisions SET sync_state='CONFLICT'");
  await s.a.runAsync(
    "UPDATE sync_outbox SET status='CONFLICT' WHERE command_id=?",
    command.commandId,
  );
  await act(async () => {
    gate.resolve();
    await gate.promise;
  });
  expect(hosts("Switch")).toHaveLength(1);
  expect(hosts("Switch")[0]!.props.value).toBe(false);
  expect(text()).toContain("Choix contradictoires à comparer");
});
it("does not report a failed write when the parent read fails after a committed resolution", async () => {
  const s = await mountConflict();
  runtime.sync.mockRejectedValueOnce(Error("OFFLINE"));
  vi.spyOn(s.f.repo, "open").mockRejectedValueOnce(Error("POST_COMMIT_READ"));
  await choose();
  expect(
    s.db.prepare("SELECT sync_state FROM copilot_decisions").get()!.sync_state,
  ).toBe("PENDING");
  expect(
    hosts("Alert").some((n) => n.props.title === "Comparaison enregistrée"),
  ).toBe(true);
  expect(text()).not.toContain("La décision n’a pas été enregistrée");
});
it("discards a delayed parent refresh after changing the displayed private repository", async () => {
  const s = await mountConflict(),
    gate = deferred(),
    original = s.f.repo.open.bind(s.f.repo);
  runtime.sync.mockRejectedValueOnce(Error("OFFLINE"));
  vi.spyOn(s.f.repo, "open").mockImplementationOnce(async (m) => {
    const result = await original(m);
    await gate.promise;
    return result;
  });
  await choose();
  const other = await decisionNativeFixture();
  close.push(() => other.db.db.close());
  await act(async () => tree!.update(view(other)));
  await act(async () => {
    gate.resolve();
    await gate.promise;
  });
  expect(text()).not.toContain("Décision enregistrée sur cet appareil");
  expect((await other.repo.open(other.card)).decision).toBeNull();
  expect((await s.f.repo.open(s.f.card)).decision!.revisions.at(-1)!.type).toBe(
    "MODIFY",
  );
});
it("cancels a delayed normal form save when confirmation permission changes", async () => {
  const f = await decisionNativeFixture();
  close.push(() => f.db.db.close());
  await act(async () => {
    tree = create(view(f));
  });
  await act(async () => pressable("Accepter").props.onPress());
  const entered = deferred(),
    gate = deferred(),
    read = f.db.getFirstAsync.bind(f.db);
  let held = false;
  f.db.getFirstAsync = async <T>(
    sql: string,
    ...params: Array<string | number | null>
  ) => {
    const result = await read<T>(sql, ...params);
    if (!held && sql.includes("FROM copilot_messages")) {
      held = true;
      entered.resolve();
      await gate.promise;
    }
    return result;
  };
  await act(async () => {
    pressable("Enregistrer ma décision").props.onPress();
    await entered.promise;
  });
  await act(async () => tree!.update(view(f, false)));
  await act(async () => {
    gate.resolve();
    await gate.promise;
  });
  expect((await f.repo.open(f.card)).decision).toBeNull();
  expect(await new OutboxRepository(f.db).listPending(f.storeId)).toEqual([]);
});
