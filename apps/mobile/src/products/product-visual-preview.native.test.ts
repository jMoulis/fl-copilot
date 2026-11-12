import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, it, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { visualLibraryFixture } from "../../../../scripts/test-visual-library-fixtures";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../db/migrations";
import { applyVisualEntity } from "./visual-library-repository";
import { VisualFileCache, visualFilePath } from "./visual-file-cache";
import {
  loadVisualLibraryState,
  type VisualLibraryState,
} from "./visual-library-state";
import { visualFileManifestSchema } from "@fl-copilot/sync-contracts";
import { useVisualLibrary } from "./use-visual-library";
import { ProductVisual } from "./product-visual";
let fixture = visualLibraryFixture();
let db: VisualTestDatabase;
let snapshot: VisualLibraryState;
let tree: ReactTestRenderer | undefined;
const queue = vi.fn(async () => {});
vi.mock("react-native", () => ({ Image: "Image", Text: "Text", View: "View" }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("expo-router", () => ({ useIsFocused: () => true }));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "11111111-1111-4111-8111-111111111111",
}));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      user: { id: fixture.actorId },
      stores: [{ storeId: fixture.storeId, role: "MANAGER" }],
    },
  }),
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => ({ sqlite: db, deviceId: fixture.deviceId }),
}));
vi.mock("../sync/sync-provider", () => ({
  useSync: () => ({ lastSyncedAt: null, visuals: { requestPreview: queue } }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: snapshot }),
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));
vi.mock("./visual-file-storage", () => ({
  nativeVisualFileStorage: {
    uri: async (
      store: string,
      variant: "SOURCE" | "PREVIEW",
      d: { mimeType: "image/png" | "image/jpeg"; contentHash: string },
    ) =>
      `file:///app/${visualFilePath(store, variant, d.mimeType, d.contentHash)}`,
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(async () => {
  if (tree) await act(() => tree!.unmount());
  tree = undefined;
  db?.raw.close();
  queue.mockClear();
});
it("keeps the legacy image visible, queues its PNG upgrade once, then renders the new cached preview without a generic badge", async () => {
  fixture = visualLibraryFixture();
  fixture.asset = { ...fixture.asset, mimeType: "image/png" };
  db = new VisualTestDatabase(new DatabaseSync(":memory:"));
  await runLocalMigrations(db);
  await applyVisualEntity(db, fixture.storeId, "visual_asset", fixture.asset);
  const cache = new VisualFileCache(db);
  const legacy = visualFileManifestSchema.parse({
    assetId: fixture.asset.id,
    storeId: fixture.storeId,
    processorVersion: "visual-image.v1",
    source: {
      contentHash: fixture.asset.contentHash,
      mimeType: fixture.asset.mimeType,
      sizeBytes: fixture.asset.sizeBytes,
      width: fixture.asset.width,
      height: fixture.asset.height,
    },
    preview: {
      contentHash: `sha256:${"b".repeat(64)}`,
      mimeType: "image/jpeg",
      sizeBytes: 100,
      width: 100,
      height: 100,
    },
  });
  const remember = async (manifest: typeof legacy) =>
    cache.remember(
      fixture.storeId,
      fixture.asset.id,
      "PREVIEW",
      {
        relativePath: visualFilePath(
          fixture.storeId,
          "PREVIEW",
          manifest.preview.mimeType,
          manifest.preview.contentHash,
        ),
        contentHash: manifest.preview.contentHash,
        sizeBytes: manifest.preview.sizeBytes,
      },
      manifest,
    );
  await remember(legacy);
  snapshot = await loadVisualLibraryState(db, fixture.storeId, fixture.actorId);
  function Harness() {
    const library = useVisualLibrary();
    return createElement(ProductVisual, {
      candidate: { asset: fixture.asset, illustrative: false, generic: true },
      category: "FRUIT",
      readUri: library.readUri,
    });
  }
  await act(async () => {
    tree = create(createElement(Harness));
  });
  const image = () => tree!.root.findAll((n) => String(n.type) === "Image")[0]!;
  expect(image().props.source.uri).toMatch(/\.jpg$/);
  expect(JSON.stringify(tree!.toJSON())).not.toContain("Générique");
  expect(queue).toHaveBeenCalledExactlyOnceWith(fixture.asset.id);
  const alpha = visualFileManifestSchema.parse({
    ...legacy,
    processorVersion: "visual-image.v2",
    preview: {
      ...legacy.preview,
      mimeType: "image/png",
      contentHash: `sha256:${"c".repeat(64)}`,
    },
  });
  await remember(alpha);
  snapshot = await loadVisualLibraryState(db, fixture.storeId, fixture.actorId);
  await act(async () => tree!.update(createElement(Harness)));
  expect(image().props.source.uri).toMatch(/\.png$/);
  expect(
    tree!.root.findAll((node) => String(node.type) === "View")[0]!.props.style
      .backgroundColor,
  ).toBe("transparent");
  expect(queue).toHaveBeenCalledTimes(1);
  expect(
    (await new VisualFileCache(db).get(
      fixture.storeId,
      fixture.asset,
      "PREVIEW",
    ))!.manifest!.processorVersion,
  ).toBe("visual-image.v2");
});
it("keeps the illustration disclosure for AI imagery while hiding the generic photo label", async () => {
  fixture = visualLibraryFixture();
  db = new VisualTestDatabase(new DatabaseSync(":memory:"));
  await act(async () => {
    tree = create(
      createElement(ProductVisual, {
        candidate: { asset: fixture.asset, illustrative: true, generic: true },
        category: "FRUIT",
        readUri: async () => "file:///illustration.png",
      }),
    );
  });
  const text = JSON.stringify(tree!.toJSON());
  expect(text).toContain("Illustration de synthèse");
  expect(text).toContain("Illustration");
  expect(text).not.toContain("Générique");
});
