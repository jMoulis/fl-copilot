import { createElement, useEffect, useState, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { commercialExecutionChecklist } from "@fl-copilot/commercial-core";
import {
  commercialExecutionTaskSchema,
  type CommercialExecutionTask,
  type CommercialWeekPlan,
} from "@fl-copilot/sync-contracts";
import { commercialPlanFixture } from "../../../../scripts/test-commercial-plan-fixtures";
import { CommercialExecutionView } from "./execution-view";
import type { LocalCommercialExecution } from "./execution-repository";

const env = vi.hoisted(() => ({
  sqlite: {},
  deviceId: "73376f4f-366e-4c14-9de5-e6b7296a914a",
  records: [] as LocalCommercialExecution[],
  list: vi.fn(),
  save: vi.fn(),
  sync: vi.fn(),
  push: vi.fn(),
  alert: vi.fn(),
}));
vi.mock("@/providers/database-provider", () => ({
  useLocalDatabase: () => ({ sqlite: env.sqlite, deviceId: env.deviceId }),
}));
vi.mock("@/sync/sync-provider", () => ({
  useSync: () => ({ syncNow: env.sync, status: "synced" }),
}));
vi.mock("expo-router", () => ({
  router: { push: env.push },
  useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn]),
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => randomUUID(),
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: async (_: unknown, value: string) =>
    createHash("sha256").update(value).digest("hex"),
}));
vi.mock("react-native", () => ({
  Text: "Text",
  TextInput: "Input",
  View: "View",
  Pressable: "Pressable",
  Platform: { OS: "ios" },
  Alert: { alert: env.alert },
}));
vi.mock("@/components/ui", () => ({
  BottomSheet: ({
    children,
    footer,
    ...props
  }: {
    children: ReactNode;
    footer?: ReactNode;
  }) =>
    createElement(
      "Sheet",
      props,
      children,
      createElement("FixedFooter", null, footer),
    ),
  SectionCard: "Card",
  PrimaryButton: "Button",
  SecondaryButton: "Button",
  InlineAlert: "Alert",
}));
vi.mock("../components/ui", () => ({ SecondaryButton: "Button" }));
vi.mock("../components/date-selector", () => ({
  DateSelector: "DateSelector",
}));
vi.mock("@/dates/calendar", () => import("../dates/calendar"));
vi.mock("../components/dashboard", () => ({
  DetailsDisclosure: ({
    title,
    children,
  }: {
    title: string;
    children: ReactNode;
  }) => {
    const [open, setOpen] = useState(false);
    return createElement(
      "Disclosure",
      { title, onPress: () => setOpen(!open) },
      open ? children : null,
    );
  },
}));
vi.mock("../products/use-visual-library", () => ({
  useVisualLibrary: () => ({}),
}));
vi.mock("./execution-checklist-view", () => ({
  ExecutionChecklistView: "Checklist",
}));
vi.mock("./tg-presentation-view", () => ({
  TgPresentationView: ({
    placements,
    renderFooter,
    ...props
  }: {
    placements: CommercialWeekPlan["preparation"]["placements"];
    renderFooter?(
      placement: CommercialWeekPlan["preparation"]["placements"][number],
    ): ReactNode;
  }) =>
    createElement(
      "TgPresentation",
      { ...props, placements },
      placements.map((placement) =>
        createElement(
          "TgTarget",
          { key: placement.id },
          renderFooter?.(placement),
        ),
      ),
    ),
}));
vi.mock("./execution-repository", () => ({
  CommercialExecutionRepository: class {
    list = env.list;
    save = env.save;
  },
  readCommercialExecutionPlan: vi.fn(),
}));

let tree: ReactTestRenderer | undefined;
const digest = async (value: string) =>
  createHash("sha256").update(value).digest("hex");
const hosts = (type: string) =>
  tree!.root.findAll(
    (node) => typeof node.type === "string" && node.type === type,
  );
const button = (label: string) =>
  hosts("Button").find((node) => node.props.label === label)!;
const input = (label: string) =>
  hosts("Input").find((node) => node.props.accessibilityLabel === label)!;
const details = () =>
  hosts("Pressable").find(
    (node) =>
      node.props.accessibilityLabel === "Ajouter des précisions (facultatif)",
  )!;
const savedRecord = (
  entity: CommercialExecutionTask,
): LocalCommercialExecution => ({
  entity,
  syncState: "PENDING",
  remote: null,
  remoteVersion: null,
  lastErrorCode: null,
});
async function render(props: Parameters<typeof CommercialExecutionView>[0]) {
  await act(async () => {
    if (tree) tree.update(createElement(CommercialExecutionView, props));
    else tree = create(createElement(CommercialExecutionView, props));
  });
}
async function placement() {
  const fixture = await commercialPlanFixture();
  const placementId = fixture.plan.preparation.placements[0]!.id;
  await render({
    plan: fixture.plan,
    presentation: "placement",
    placementId,
    renderDetail: (content, action) =>
      createElement(
        "DetailScreen",
        null,
        content,
        createElement("FixedAction", null, action),
      ),
  });
  return { ...fixture, placementId };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const log = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      log(...args);
  });
  env.records = [];
  env.list.mockReset().mockImplementation(async () => env.records);
  env.save
    .mockReset()
    .mockImplementation(async (entity: CommercialExecutionTask) => {
      env.records = [savedRecord(entity)];
    });
  env.sync.mockReset().mockResolvedValue(undefined);
  env.push.mockReset();
  env.alert.mockReset();
});
afterEach(async () => {
  await act(() => tree?.unmount());
  tree = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("opens the installation confirmation without writing and closes an untouched sheet without a dirty prompt", async () => {
  const { plan, placementId } = await placement();
  expect(
    hosts("TgPresentation")[0]!.props.placements.map(
      (p: { id: string }) => p.id,
    ),
  ).toEqual([placementId]);
  expect(env.list).toHaveBeenCalledWith(plan.storeId, plan.revisionId);
  expect(button("Déclarer l’installation").parent!.type).toBe("FixedAction");
  expect(
    hosts("Button").filter(
      (node) => node.props.label === "Déclarer l’installation",
    ),
  ).toHaveLength(1);
  expect(env.save).not.toHaveBeenCalled();
  await act(() => button("Déclarer l’installation").props.onPress());
  expect(hosts("Sheet")).toHaveLength(1);
  expect(button("Confirmer la déclaration").parent!.type).toBe("FixedFooter");
  expect(env.save).not.toHaveBeenCalled();
  await act(() => hosts("Sheet")[0]!.props.onClose());
  expect(hosts("Sheet")[0]!.props.visible).toBe(false);
  expect(button("Confirmer la déclaration").props.disabled).toBe(true);
  await act(() => button("Confirmer la déclaration").props.onPress());
  expect(env.save).not.toHaveBeenCalled();
  await act(() => hosts("Sheet")[0]!.props.onDismiss());
  expect(hosts("Sheet")).toHaveLength(0);
  expect(env.alert).not.toHaveBeenCalled();
  expect(env.save).not.toHaveBeenCalled();
  expect(env.sync).not.toHaveBeenCalled();
});

it("saves only after confirmation with the canonical task identity, no invented actuals and one write for a double tap", async () => {
  const { plan, placementId } = await placement();
  const proposal = (await commercialExecutionChecklist(plan, digest)).find(
    (item) => item.kind === "INSTALL_TG" && item.targetId === placementId,
  )!;
  await act(() => button("Déclarer l’installation").props.onPress());
  let finish!: () => void;
  env.save.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const confirm = button("Confirmer la déclaration").props.onPress;
  await act(async () => {
    confirm();
    confirm();
  });
  expect(env.save).toHaveBeenCalledOnce();
  const [task, command] = env.save.mock.calls[0]!;
  expect(commercialExecutionTaskSchema.safeParse(task).success).toBe(true);
  expect(task).toMatchObject({
    ...proposal,
    status: "DONE",
    note: "",
    version: 1,
  });
  expect(task.completedAt).toEqual(expect.any(String));
  expect(task.actuals ?? null).toBeNull();
  expect(command).toEqual({
    commandId: expect.any(String),
    deviceId: env.deviceId,
  });
  expect(button("Confirmer la déclaration").props.disabled).toBe(true);
  await act(() => hosts("Sheet")[0]!.props.onClose());
  expect(hosts("Sheet")).toHaveLength(1);
  expect(env.sync).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(hosts("Sheet")[0]!.props.visible).toBe(false);
  await act(() => hosts("Sheet")[0]!.props.onDismiss());
  expect(hosts("Sheet")).toHaveLength(0);
  expect(env.sync).toHaveBeenCalledExactlyOnceWith(plan.storeId);
});

it("keeps optional notes and actual details when closing is cancelled and validates them with the existing form before saving", async () => {
  await placement();
  await act(() => button("Déclarer l’installation").props.onPress());
  await act(() => details().props.onPress());
  await act(() =>
    input("Note ou motif de la déclaration").props.onChangeText(
      "Balisage vérifié",
    ),
  );
  await act(() =>
    input("Emplacement réel déclaré").props.onChangeText("TG à l’entrée"),
  );
  await act(() =>
    input("Prix réel déclaré en euros").props.onChangeText("2,19"),
  );
  await act(() => hosts("Sheet")[0]!.props.onClose());
  expect(env.alert).toHaveBeenCalledOnce();
  expect(hosts("Sheet")).toHaveLength(1);
  expect(input("Note ou motif de la déclaration").props.value).toBe(
    "Balisage vérifié",
  );
  expect(input("Emplacement réel déclaré").props.value).toBe("TG à l’entrée");
  expect(env.save).not.toHaveBeenCalled();
  await act(() => button("Confirmer la déclaration").props.onPress());
  expect(env.save).not.toHaveBeenCalled();
  expect(hosts("Sheet")).toHaveLength(1);
  await act(() =>
    hosts("Pressable")
      .find(
        (node) => node.props.accessibilityLabel === "Unité du prix : pièce",
      )!
      .props.onPress(),
  );
  await act(() => button("Confirmer la déclaration").props.onPress());
  expect(env.save).toHaveBeenCalledOnce();
  expect(env.save.mock.calls[0]![0]).toMatchObject({
    status: "DONE",
    note: "Balisage vérifié",
    actuals: {
      start: null,
      end: null,
      price: "2.19",
      priceUnit: "PIECE",
      location: "TG à l’entrée",
    },
  });
});

it("preserves the closing declaration until native dismissal and ignores an old dismissal after reopening", async () => {
  await placement();
  await act(() => button("Déclarer l’installation").props.onPress());
  await act(() => details().props.onPress());
  await act(() =>
    input("Note ou motif de la déclaration").props.onChangeText(
      "Saisie à abandonner",
    ),
  );
  const oldInput = input("Note ou motif de la déclaration").props.onChangeText;
  await act(() => hosts("Sheet")[0]!.props.onClose());
  const buttons = env.alert.mock.calls[0]![2] as {
    text: string;
    onPress?(): void;
  }[];
  await act(() =>
    buttons.find((choice) => choice.text === "Fermer")!.onPress!(),
  );
  const dismissed = hosts("Sheet")[0]!.props.onDismiss;
  expect(hosts("Sheet")[0]!.props.visible).toBe(false);
  await act(() => oldInput("Modification trop tardive"));
  expect(input("Note ou motif de la déclaration").props.value).toBe(
    "Saisie à abandonner",
  );
  expect(input("Note ou motif de la déclaration").props.editable).toBe(false);
  await act(() => button("Déclarer l’installation").props.onPress());
  await act(() => dismissed());
  expect(hosts("Sheet")[0]!.props.visible).toBe(true);
  expect(hosts("Input")).toHaveLength(0);
  await act(() => details().props.onPress());
  expect(input("Note ou motif de la déclaration").props.value).toBe("");
  expect(env.save).not.toHaveBeenCalled();
});

it.each(["placementId", "initialTaskId"] as const)(
  "does not substitute the first TG for an unknown explicit %s",
  async (identifier) => {
    const { plan } = await placement();
    await render({
      plan,
      presentation: "placement",
      [identifier]: randomUUID(),
    });
    expect(hosts("TgPresentation")).toHaveLength(0);
    expect(
      hosts("Alert").some((node) => node.props.title === "TG introuvable"),
    ).toBe(true);
    expect(
      hosts("Button").some(
        (node) => node.props.label === "Déclarer l’installation",
      ),
    ).toBe(false);
    expect(hosts("Sheet")).toHaveLength(0);
    expect(env.save).not.toHaveBeenCalled();
  },
);

it("keeps the default checklist used by weekly pilot and routes a conflicting task to synchronization", async () => {
  const { plan } = await commercialPlanFixture();
  const proposals = await commercialExecutionChecklist(plan, digest);
  const proposal = proposals.find((item) => item.kind === "INSTALL_TG")!;
  const task = commercialExecutionTaskSchema.parse({
    ...proposal,
    status: "TODO",
    note: "",
    completedAt: null,
    version: 1,
    createdAt: plan.createdAt,
    updatedAt: plan.createdAt,
  });
  env.records = [{ ...savedRecord(task), syncState: "CONFLICT" }];
  await render({ plan, compact: true });
  expect(hosts("TgPresentation")).toHaveLength(0);
  expect(hosts("Checklist")).toHaveLength(1);
  expect(hosts("Checklist")[0]!.props.filter).toBe("TODO");
  expect(hosts("Checklist")[0]!.props.proposals).toEqual(proposals);
  await act(() =>
    hosts("Checklist")[0]!.props.onOpen(proposal, env.records[0]),
  );
  expect(env.push).toHaveBeenCalledWith("/sync-center");
  expect(hosts("Sheet")).toHaveLength(0);
  expect(env.save).not.toHaveBeenCalled();
});
