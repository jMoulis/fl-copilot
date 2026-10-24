import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import CommercialOfferScreen from "../app/commercial-offer/[id]";
import {
  commercialChoiceFixture,
  testChoiceDigest,
} from "../../../../scripts/test-commercial-choice-fixtures";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../db/migrations";
import { commercialChoiceId } from "@fl-copilot/commercial-core";
import { commercialOfferChoiceSchema } from "@fl-copilot/domain";
import { ProductMasterRepository } from "../products/product-master-repository";
import { CommercialChoiceRepository } from "./offer-choice-repository";
import { applyCommercialVisualReading } from "./visual-repository";
import { OutboxRepository } from "../sync/outbox-repository";
const runtime = vi.hoisted(() => ({
  session: undefined as unknown,
  database: undefined as unknown,
  params: {} as Record<string, string>,
  focused: true,
  sync: vi.fn(async () => {}),
  alert: vi.fn(),
}));
vi.mock("@/dates/calendar", () => import("../dates/calendar"));
vi.mock("@/commercial/choice-source", () => import("./choice-source"));
vi.mock(
  "@/commercial/offer-choice-repository",
  () => import("./offer-choice-repository"),
);
vi.mock(
  "@/products/product-master-repository",
  () => import("../products/product-master-repository"),
);
vi.mock(
  "@/commercial/choice-presentation",
  () => import("./choice-presentation"),
);
vi.mock("@/commercial/original-button", () => ({
  CommercialOriginalButton: "Original",
}));
vi.mock("@/commercial/mechanism-editor", () => ({
  MechanismEditor: "Mechanism",
}));
vi.mock("@/components/date-selector", () => ({ DateSelector: "Date" }));
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
  InlineAlert: "Alert",
  PrimaryButton: "Button",
  SecondaryButton: "Button",
  StatusBadge: "Badge",
}));
vi.mock("react-native", () => ({
  Text: "Text",
  TextInput: "Input",
  Alert: { alert: runtime.alert },
}));
vi.mock("expo-router", () => ({
  router: { back: vi.fn(), push: vi.fn() },
  useLocalSearchParams: () => runtime.params,
  useFocusEffect: (cb: () => void | (() => void)) => {
    const focus = runtime.focused;
    useEffect(() => (focus ? cb() : undefined), [cb, focus]);
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
const hosts = (tag: string) =>
  tree!.root.findAll(
    (n) => typeof n.type === "string" && String(n.type) === tag,
  );
const button = (label: string) =>
  hosts("Button").find((n) => n.props.label === label)!;
beforeEach(() => {
  runtime.focused = true;
  runtime.sync.mockClear();
  runtime.alert.mockClear();
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  db?.raw.close();
  vi.restoreAllMocks();
});
async function setup(original = true, role = "MANAGER") {
  const f = await commercialChoiceFixture();
  db = new VisualTestDatabase(new DatabaseSync(":memory:"));
  await runLocalMigrations(db);
  const product = { ...f.product, salesUnit: "KG" as const };
  await new ProductMasterRepository(db).upsertProduct(product, {
    commandId: randomUUID(),
    deviceId: randomUUID(),
  });
  const repo = new CommercialChoiceRepository(db, testChoiceDigest);
  let choice = f.choice as ReturnType<typeof commercialOfferChoiceSchema.parse>;
  if (original) {
    const source = {
      kind: "PDF_ORIGINAL" as const,
      sourceDocumentId: f.sourceDocumentId,
      checksum: `sha256:${"a".repeat(64)}`,
      pageNumber: 2,
      excerpt: "Raisin blanc vrac S44 moins de 2,20 EUR/kg",
    };
    choice = {
      ...choice,
      id: await commercialChoiceId(f.storeId, source, testChoiceDigest),
      source,
    };
    await db.runAsync(
      "INSERT INTO source_documents(id,store_id,source_type,checksum,local_processing_status,remote_upload_status,version,created_at,updated_at,sync_state,dirty) VALUES(?,?,'WEEKLY_COMMERCIAL_PDF',?,'PENDING','PENDING',1,?,?,'PENDING',1)",
      f.sourceDocumentId,
      f.storeId,
      source.checksum,
      f.choice.createdAt,
      f.choice.updatedAt,
    );
    runtime.params = { id: choice.id, choiceId: choice.id };
  } else {
    await applyCommercialVisualReading(db, f.storeId, f.reading);
    runtime.params = { id: f.readingId, operationIndex: "0", itemIndex: "0" };
  }
  await repo.save(choice, { commandId: randomUUID(), deviceId: randomUUID() });
  db.raw.exec("UPDATE sync_outbox SET status='ACKNOWLEDGED'");
  runtime.database = { sqlite: db, deviceId: randomUUID() };
  runtime.session = {
    user: { id: randomUUID() },
    stores: [{ storeId: f.storeId, role }],
  };
  await act(async () => {
    tree = create(createElement(CommercialOfferScreen));
  });
  return { ...f, choice, repo };
}
it.each([true, false])(
  "edits a %s-original retained offer through its real canonical writer and resets confirmations",
  async (original) => {
    const f = await setup(original);
    expect(button("Modifier ce choix")).toBeDefined();
    expect(hosts("Original")[0]?.props.sourceDocumentId).toBe(
      f.sourceDocumentId,
    );
    await act(async () => button("Modifier ce choix").props.onPress());
    await act(async () => hosts("Date")[0]!.props.onConfirm("2026-10-09"));
    await act(async () =>
      button("Cette opération s’applique à mon magasin").props.onPress(),
    );
    await act(async () =>
      button(
        "J’ai vérifié le produit, les dates et le mécanisme",
      ).props.onPress(),
    );
    await act(async () => button("Retenir pour mon magasin").props.onPress());
    expect((await f.repo.get(f.storeId, f.choice.id))?.entity).toMatchObject({
      source: f.choice.source,
      saleStart: "2026-10-09",
      version: 2,
    });
    expect(await new OutboxRepository(db).listPending(f.storeId)).toHaveLength(
      1,
    );
    expect(button("Modifier ce choix")).toBeDefined();
  },
);
it("keeps an unavailable original choice readable and withdrawable, with no edit controls for a member", async () => {
  const f = await setup();
  await db.runAsync(
    "UPDATE source_documents SET deleted_at=?",
    f.choice.updatedAt,
  );
  runtime.focused = false;
  await act(async () => tree!.update(createElement(CommercialOfferScreen)));
  runtime.focused = true;
  await act(async () => tree!.update(createElement(CommercialOfferScreen)));
  expect(button("Modifier ce choix").props.disabled).toBe(true);
  await act(async () => button("Retirer cette offre").props.onPress());
  const actions = runtime.alert.mock.calls[0]![2] as Array<{
    text: string;
    onPress?(): void;
  }>;
  await act(async () => actions.find((a) => a.text === "Retirer")!.onPress!());
  expect((await f.repo.get(f.storeId, f.choice.id))?.entity.status).toBe(
    "WITHDRAWN",
  );
  runtime.session = {
    ...(runtime.session as object),
    stores: [{ storeId: f.storeId, role: "MEMBER" }],
  };
  await act(async () => tree!.update(createElement(CommercialOfferScreen)));
  expect(button("Modifier ce choix")).toBeUndefined();
  expect(button("Retirer cette offre")).toBeUndefined();
});
it("does not commit a queued save after the editor actor changes", async () => {
  const f = await setup();
  await act(async () => button("Modifier ce choix").props.onPress());
  await act(async () =>
    button("Cette opération s’applique à mon magasin").props.onPress(),
  );
  await act(async () =>
    button(
      "J’ai vérifié le produit, les dates et le mécanisme",
    ).props.onPress(),
  );
  let release!: () => void;
  const pending = new Promise<void>((r) => (release = r)),
    transaction = db.withExclusiveTransactionAsync.bind(db);
  vi.spyOn(db, "withExclusiveTransactionAsync").mockImplementationOnce(
    async (task) => {
      await pending;
      return transaction(task);
    },
  );
  await act(async () => button("Retenir pour mon magasin").props.onPress());
  expect(button("Enregistrement…").props.disabled).toBe(true);
  runtime.session = {
    user: { id: randomUUID() },
    stores: [{ storeId: f.storeId, role: "MANAGER" }],
  };
  await act(async () => tree!.update(createElement(CommercialOfferScreen)));
  await act(async () => {
    release();
    await pending;
  });
  expect((await f.repo.get(f.storeId, f.choice.id))?.entity.version).toBe(1);
  expect(await new OutboxRepository(db).listPending(f.storeId)).toEqual([]);
});
