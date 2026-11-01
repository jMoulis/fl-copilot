import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RestartForm } from "../app/commercial-restart";
import { Alert } from "react-native";
import { commercialReviewFixture } from "../../../../scripts/test-commercial-processing-fixtures";
import { SourceDocumentRepository } from "../documents/source-document-repository";
import { applyCommercialVisualReading } from "./visual-repository";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { commercialPlanFixture } from "../../../../scripts/test-commercial-plan-fixtures";
import { testChoiceDigest } from "../../../../scripts/test-commercial-choice-fixtures";
import { runLocalMigrations } from "../db/migrations";
import { applyCommercialChoice } from "./offer-choice-repository";
import {
  applyCommercialPreparation,
  CommercialPreparationRepository,
} from "./week-preparation-repository";

const runtime = vi.hoisted(() => ({
  session: undefined as unknown,
  database: undefined as unknown,
  weekStart: "",
  focused: true,
  sync: vi.fn(async () => {}),
}));
vi.mock("@/dates/calendar", () => import("../dates/calendar"));
vi.mock("@/commercial/physical-allocation-card", () => ({
  PhysicalAllocationCard: "Physical",
}));
vi.mock("@/commercial/plan-validation-view", () => ({
  CommercialPlanValidationView: "PlanValidation",
}));
vi.mock("@/commercial/offer-validation-view", () => ({
  CommercialOfferValidationView: "OfferValidation",
}));
vi.mock(
  "@/commercial/week-preparation-repository",
  () => import("./week-preparation-repository"),
);
vi.mock(
  "@/commercial/offer-choice-repository",
  () => import("./offer-choice-repository"),
);
vi.mock(
  "@/commercial/choice-presentation",
  () => import("./choice-presentation"),
);
vi.mock(
  "@/commercial/preparation-presentation",
  () => import("./preparation-presentation"),
);
vi.mock("@/auth/auth-provider", () => ({
  useAuth: () => ({ session: runtime.session }),
}));
vi.mock("@/providers/database-provider", () => ({
  useLocalDatabase: () => runtime.database,
}));
vi.mock("@/sync/sync-provider", () => ({
  useSync: () => ({ syncNow: runtime.sync }),
}));
vi.mock("@/components/ui", () => ({
  AppScreen: "Screen",
  AppHeader: "Header",
  SectionCard: "Card",
  SecondaryButton: "Button",
  PrimaryButton: "Button",
  InlineAlert: "Alert",
  StatusBadge: "Badge",
}));
vi.mock("react-native", () => ({
  Text: "Text",
  TextInput: "Input",
  Switch: "Switch",
  View: "View",
  Alert: { alert: vi.fn() },
}));
vi.mock("expo-router", () => ({
  router: { back: vi.fn(), push: vi.fn() },
  useLocalSearchParams: () => ({ weekStart: runtime.weekStart }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const focused = runtime.focused;
    useEffect(() => (focused ? cb() : undefined), [focused, cb]);
  },
}));
vi.mock("expo-crypto", async () => {
  const { createHash, randomUUID } = await import("node:crypto");
  return {
    randomUUID,
    CryptoDigestAlgorithm: { SHA256: "SHA256" },
    digestStringAsync: async (_algorithm: string, text: string) =>
      createHash("sha256").update(text).digest("hex"),
  };
});
let tree: ReactTestRenderer | undefined, db: VisualTestDatabase;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runtime.focused = true;
  runtime.sync.mockClear();
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  db?.raw.close();
  vi.unstubAllGlobals();
});

vi.mock("@/config/environment", () => ({
  getApiBaseUrl: () => "http://test.invalid",
}));
vi.mock(
  "@/documents/commercial-analysis-recovery",
  () => import("../documents/commercial-analysis-recovery"),
);
vi.mock(
  "@/commercial/restart-preparation",
  () => import("./restart-preparation"),
);
const hosts = (tag: string) =>
  tree!.root.findAll(
    (n) => typeof n.type === "string" && String(n.type) === tag,
  );
const button = (label: string) =>
  hosts("Button").find((n) => n.props.label === label)!;
const toggle = (label: string) =>
  hosts("Switch").find((n) => n.props.accessibilityLabel === label)!;
function confirmation() {
  const args = vi.mocked(Alert.alert).mock.calls.at(-1)!;
  return args[2]!.find((b) => b.text === "Confirmer")!.onPress!;
}
async function setup() {
  const f = await commercialPlanFixture();
  db = new VisualTestDatabase(new DatabaseSync(":memory:"));
  await runLocalMigrations(db);
  await applyCommercialChoice(db, f.storeId, f.choice);
  await applyCommercialPreparation(db, f.storeId, f.preparation);
  await applyCommercialVisualReading(db, f.storeId, f.reading);
  const r = {
    ...commercialReviewFixture(),
    sourceDocumentId: f.reading.sourceDocumentId,
    checksum: `sha256:${"a".repeat(64)}`,
    canRestart: true,
  };
  await new SourceDocumentRepository(db).createCommercialPdf({
    document: {
      id: r.sourceDocumentId,
      storeId: f.storeId,
      sourceType: "WEEKLY_COMMERCIAL_PDF",
      originalFilename: "semaine.pdf",
      localFileUri: "file:///semaine.pdf",
      checksum: r.checksum,
      localProcessingStatus: "PENDING",
      remoteUploadStatus: "LOCAL_ONLY",
      version: 1,
      createdAt: r.observedAt,
      updatedAt: r.observedAt,
      syncState: "LOCAL_ONLY",
      dirty: true,
    },
    file: {
      id: randomUUID(),
      storeId: f.storeId,
      sourceDocumentId: r.sourceDocumentId,
      localUri: "file:///semaine.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      checksum: r.checksum,
      retentionStatus: "RETAINED",
      uploadStatus: "LOCAL_ONLY",
      createdAt: r.observedAt,
      updatedAt: r.observedAt,
    },
  });
  db.raw.exec(
    "UPDATE source_documents SET remote_upload_status='CONFIRMED'; UPDATE local_jobs SET status='COMPLETED'",
  );
  const read = vi.fn(async () => r),
    props = {
      db,
      deviceId: randomUUID(),
      storeId: f.storeId,
      ownerId: randomUUID(),
      canChange: true,
      initialWeek: f.preparation.weekStart,
      sourceId: r.sourceDocumentId,
      read,
      sync: runtime.sync,
    };
  await act(async () => {
    tree = create(createElement(RestartForm, props));
  });
  return { f, r, props, read };
}
it("requires explicit confirmation with week, file and cost; atomically clears and queues once, then can undo only the draft", async () => {
  const { f, props } = await setup();
  await act(() => button("Vérifier avant de recommencer").props.onPress());
  const prompt = vi.mocked(Alert.alert).mock.calls.at(-1)!;
  expect(prompt[1]).toContain("semaine.pdf");
  expect(prompt[1]).toContain("2026");
  expect(prompt[1]).toContain("crédits IA");
  expect(
    (
      await new CommercialPreparationRepository(db, testChoiceDigest).get(
        f.storeId,
        f.preparation.weekStart,
      )
    )?.entity,
  ).toEqual(f.preparation);
  const confirm = confirmation();
  await act(async () => {
    confirm();
    confirm();
  });
  const cleared = (await new CommercialPreparationRepository(
    db,
    testChoiceDigest,
  ).get(f.storeId, f.preparation.weekStart))!.entity;
  expect(cleared).toMatchObject({
    version: 2,
    placements: [],
    offerRefs: [],
    note: "",
  });
  expect(
    db.raw
      .prepare(
        "SELECT * FROM local_jobs WHERE type='COMMERCIAL_ANALYSIS_RESUME'",
      )
      .all(),
  ).toHaveLength(1);
  expect(
    db.raw.prepare("SELECT * FROM commercial_week_plans").all(),
  ).toHaveLength(0);
  await act(() => tree!.unmount());
  await act(() => {
    tree = create(createElement(RestartForm, props));
  });
  await act(() => button("Restaurer le brouillon précédent").props.onPress());
  const restore = vi
    .mocked(Alert.alert)
    .mock.calls.at(-1)![2]!
    .find((b) => b.text === "Restaurer")!.onPress!;
  await act(() => restore());
  const restored = (await new CommercialPreparationRepository(
    db,
    testChoiceDigest,
  ).get(f.storeId, f.preparation.weekStart))!.entity;
  expect(restored).toMatchObject({
    placements: f.preparation.placements,
    offerRefs: f.preparation.offerRefs,
    version: 3,
  });
  expect(
    db.raw
      .prepare(
        "SELECT * FROM local_jobs WHERE type='COMMERCIAL_ANALYSIS_RESUME'",
      )
      .all(),
  ).toHaveLength(1);
});
it("ignores old confirmation callbacks after a week change or role loss", async () => {
  const { f, props } = await setup();
  await act(() =>
    toggle("Relancer l’analyse du PDF").props.onValueChange(false),
  );
  await act(() => button("Vérifier avant de recommencer").props.onPress());
  const old = confirmation();
  await act(() => button("Semaine suivante").props.onPress());
  await act(() => old());
  expect(
    (
      await new CommercialPreparationRepository(db, testChoiceDigest).get(
        f.storeId,
        f.preparation.weekStart,
      )
    )?.entity,
  ).toEqual(f.preparation);
  await act(() => button("Semaine précédente").props.onPress());
  await act(() => button("Vérifier avant de recommencer").props.onPress());
  const beforeRoleLoss = confirmation();
  await act(() =>
    tree!.update(createElement(RestartForm, { ...props, canChange: false })),
  );
  await act(() => beforeRoleLoss());
  expect(db.raw.prepare("SELECT * FROM sync_outbox").all()).toHaveLength(0);
});
it("keeps the draft intact if the refreshed analysis is blocked or the reply is lost", async () => {
  const { f, props, r } = await setup();
  await act(() =>
    tree!.update(
      createElement(RestartForm, {
        ...props,
        read: async () => ({ ...r, canRestart: false }),
      }),
    ),
  );
  await act(() => button("Vérifier avant de recommencer").props.onPress());
  expect(hosts("Alert")).not.toHaveLength(0);
  expect(
    (
      await new CommercialPreparationRepository(db, testChoiceDigest).get(
        f.storeId,
        f.preparation.weekStart,
      )
    )?.entity,
  ).toEqual(f.preparation);
  expect(db.raw.prepare("SELECT * FROM sync_outbox").all()).toHaveLength(0);
});

it("shows a service refusal distinctly from the locally cleared draft and retains restoration", async () => {
  const { f, props } = await setup();
  await act(() =>
    tree!.update(
      createElement(RestartForm, {
        ...props,
        sync: async () => {
          await db.runAsync(
            "UPDATE local_jobs SET status='FAILED' WHERE type='COMMERCIAL_ANALYSIS_RESUME'",
          );
        },
      }),
    ),
  );
  await act(() => button("Vérifier avant de recommencer").props.onPress());
  await act(() => confirmation()());
  expect(
    hosts("Alert").some((n) =>
      String(n.props.message).includes("n’a pas été acceptée"),
    ),
  ).toBe(true);
  expect(button("Restaurer le brouillon précédent").props.disabled).toBe(false);
  expect(
    (
      await new CommercialPreparationRepository(db, testChoiceDigest).get(
        f.storeId,
        f.preparation.weekStart,
      )
    )?.entity.placements,
  ).toEqual([]);
});

it("invalidates a retained confirmation when the operational SQLite instance changes", async () => {
  const { props } = await setup();
  await act(() =>
    toggle("Relancer l’analyse du PDF").props.onValueChange(false),
  );
  await act(() => button("Vérifier avant de recommencer").props.onPress());
  const retained = confirmation();
  const replacement = new VisualTestDatabase(new DatabaseSync(":memory:"));
  try {
    await runLocalMigrations(replacement);
    await act(() =>
      tree!.update(createElement(RestartForm, { ...props, db: replacement })),
    );
    await act(() => retained());
    expect(db.raw.prepare("SELECT * FROM sync_outbox").all()).toHaveLength(0);
    expect(
      replacement.raw.prepare("SELECT * FROM sync_outbox").all(),
    ).toHaveLength(0);
  } finally {
    await act(() => tree!.unmount());
    tree = undefined;
    replacement.raw.close();
  }
});
