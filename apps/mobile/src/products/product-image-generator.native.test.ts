import { createElement } from "react";
import { Image } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { afterEach, it, expect, vi } from "vitest";
import { ApiClient, ApiClientError } from "@fl-copilot/api-client";
import { visualLibraryFixture } from "../../../../scripts/test-visual-library-fixtures";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../db/migrations";
import { ProductMasterRepository } from "./product-master-repository";
import { VisualLibraryRepository } from "./visual-library-repository";
import { ProductImageGenerator } from "./product-image-generator";
import type { VisualLibraryController } from "./use-visual-library";
import { visualFilePath } from "./visual-file-cache";

let f = visualLibraryFixture(),
  db: VisualTestDatabase,
  tree: ReactTestRenderer | undefined;
const source = () => ({
  contentHash: f.asset.contentHash,
  mimeType: "image/png" as const,
  width: 1024 as const,
  height: 1024 as const,
  sizeBytes: 100,
});
const image = () => ({
  ...source(),
  provenance: {
    type: "AI_GENERATED" as const,
    provider: "TEST_FIXTURE_NOT_REAL_AI",
    model: "test",
    promptVersion: "test",
  },
});
vi.mock("react-native", () => ({ Image: "Image", Text: "Text", View: "View" }));
vi.mock("expo-crypto", () => ({
  randomUUID: () => globalThis.crypto.randomUUID(),
}));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({
    withAccessToken: async <T>(fn: (token: string) => Promise<T>) =>
      fn("test-token"),
  }),
}));
vi.mock("../config/environment", () => ({
  getApiBaseUrl: () => "https://example.test",
}));
vi.mock("../components/ui", () => ({
  InlineAlert: "Alert",
  PrimaryButton: "PrimaryButton",
  SecondaryButton: "SecondaryButton",
}));
vi.mock("./visual-file-storage", () => ({
  nativeVisualFileStorage: {
    write: vi.fn(async () => {}),
    uri: vi.fn(async () => "file:///test.png"),
    capture: vi.fn(async () => ({
      ...source(),
      relativePath: visualFilePath(
        f.storeId,
        "SOURCE",
        "image/png",
        f.asset.contentHash,
      ),
    })),
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(async () => {
  if (tree) await act(() => tree!.unmount());
  tree = undefined;
  db?.raw.close();
  vi.restoreAllMocks();
});
async function setup() {
  f = visualLibraryFixture();
  db = new VisualTestDatabase(new DatabaseSync(":memory:"));
  await runLocalMigrations(db);
  await new ProductMasterRepository(db).upsertProduct(f.product, {
    commandId: randomUUID(),
    deviceId: f.deviceId,
  });
  const options = vi
    .spyOn(ApiClient.prototype, "productImageOptions")
    .mockResolvedValue({
      available: true,
      reasonFr: null,
      model: "test",
      estimatedCostUsd: 0.03,
      policyId: "test",
      productVersion: f.product.version,
    });
  const generate = vi
    .spyOn(ApiClient.prototype, "generateProductImage")
    .mockImplementation(async (_token, _store, input) => ({
      requestId: input.requestId,
      productId: f.product.id,
      productVersion: f.product.version,
      status: "READY",
      image: image(),
    }));
  const status = vi
    .spyOn(ApiClient.prototype, "productImageStatus")
    .mockImplementation(async (_token, _store, id) => ({
      requestId: id,
      productId: f.product.id,
      productVersion: f.product.version,
      status: "READY",
      image: image(),
    }));
  vi.spyOn(
    ApiClient.prototype,
    "downloadGeneratedProductImage",
  ).mockResolvedValue(new Uint8Array(100));
  const gallery = {
    sqlite: db,
    context: {
      storeId: f.storeId,
      actorId: f.actorId,
      deviceId: f.deviceId,
      id: randomUUID,
      now: () => f.at,
      canWrite: () => true,
    },
    canWrite: true,
  } as unknown as VisualLibraryController;
  const saved = vi.fn(),
    close = vi.fn();
  const mount = async () => {
    await act(async () => {
      tree = create(
        createElement(ProductImageGenerator, {
          product: f.product,
          gallery,
          visible: true,
          onSaved: saved,
          onClose: close,
        }),
      );
    });
  };
  await mount();
  return { options, generate, status, saved, close, mount };
}
async function click(label: string) {
  await act(async () => {
    const button = tree!.root.findAll(
      (n) => n.props.label === label && typeof n.type === "string",
    )[0]!;
    expect(button.props.disabled).not.toBe(true);
    button.props.onPress();
    await new Promise((r) => setTimeout(r, 0));
  });
}
it("opening is free; an explicit generation shows an unapproved preview, then a separate choice writes the canonical local metadata", async () => {
  const s = await setup();
  expect(s.options).toHaveBeenCalledOnce();
  expect(s.generate).not.toHaveBeenCalled();
  await click("Générer l’image");
  expect(s.generate).toHaveBeenCalledOnce();
  expect(
    await new VisualLibraryRepository(db).list("visual_asset", f.storeId),
  ).toHaveLength(0);
  const confirm = () =>
    tree!.root.findAll(
      (n) =>
        n.props.label === "Utiliser cette image" && typeof n.type === "string",
    )[0]!;
  expect(confirm().props.disabled).toBe(true);
  await act(() => tree!.root.findByType(Image).props.onLoad());
  await click("Utiliser cette image");
  await act(async () => {
    await vi.waitFor(() => expect(s.saved).toHaveBeenCalledOnce());
  });
  expect(
    (await new VisualLibraryRepository(db).list("visual_asset", f.storeId))[0]!
      .entity.provenance.type,
  ).toBe("AI_GENERATED");
});
it("after a lost response and remount, reads the retained request instead of making another billable call", async () => {
  const s = await setup();
  s.generate.mockRejectedValueOnce(
    new ApiClientError(0, {
      code: "NETWORK_UNAVAILABLE",
      messageFr: "Connexion interrompue",
      retryable: true,
    }),
  );
  await click("Générer l’image");
  expect(s.generate).toHaveBeenCalledOnce();
  const id = s.generate.mock.calls[0]![2].requestId;
  await act(() => tree!.unmount());
  tree = undefined;
  await s.mount();
  expect(s.status).toHaveBeenCalledWith("test-token", f.storeId, id);
  expect(s.generate).toHaveBeenCalledOnce();
  expect(tree!.root.findByType(Image)).toBeDefined();
});

it("reopens a rejected output with its reason and a usable abandon action, without generating again", async () => {
  const s = await setup();
  const failure = new ApiClientError(422, {
    code: "PRODUCT_IMAGE_TRANSPARENCY_INVALID",
    messageFr: "Le fond n’est pas transparent.",
    retryable: false,
  });
  s.generate.mockRejectedValueOnce(failure);
  await click("Générer l’image");
  s.status.mockRejectedValueOnce(failure);
  await act(() => tree!.unmount());
  tree = undefined;
  await s.mount();
  expect(s.options).toHaveBeenCalledTimes(2);
  expect(s.generate).toHaveBeenCalledOnce();
  expect(
    tree!.root.findAll((n) => n.props.message === failure.message).length,
  ).toBeGreaterThan(0);
  await click("Abandonner cette demande");
  const button = tree!.root.findAll(
    (n) => n.props.label === "Générer l’image" && typeof n.type === "string",
  )[0]!;
  expect(button.props.disabled).toBe(false);
  expect(s.generate).toHaveBeenCalledOnce();
});
