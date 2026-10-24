import { randomUUID } from "node:crypto";
import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, expect, it, describe, vi } from "vitest";
import { VisualLibraryConflict } from "./visual-conflict";
import {
  nativeVisualConflictFixture,
  visualConflictKinds,
} from "../../../../scripts/test-visual-conflict-fixtures";
import { applyVisualEntity } from "./visual-library-repository";
const runtime = vi.hoisted(() => ({
  session: undefined as unknown,
  database: undefined as unknown,
  focused: true,
  sync: vi.fn(),
  back: vi.fn(),
  uri: vi.fn(),
  hold: undefined as
    undefined | { entered: () => void; promise: Promise<void> },
}));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({ session: runtime.session }),
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => runtime.database,
}));
vi.mock("../sync/sync-provider", () => ({
  useSync: () => ({ syncNow: runtime.sync }),
}));
vi.mock("../components/ui", () => ({
  InlineAlert: "Alert",
  PrimaryButton: "Button",
  SecondaryButton: "Button",
  SectionCard: "Card",
}));
vi.mock("./visual-file-storage", () => ({
  nativeVisualFileStorage: { uri: runtime.uri },
}));
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  Pressable: "Check",
  Image: "Image",
  ActivityIndicator: "Spinner",
}));
vi.mock("expo-router", () => ({
  router: { back: runtime.back },
  useFocusEffect: (cb: () => void | (() => void)) => {
    const focus = runtime.focused;
    useEffect(() => (focus ? cb() : undefined), [cb, focus]);
  },
}));
vi.mock("./visual-id-digest", async () => {
  const { createHash } = await import("node:crypto");
  return {
    digestVisualId: async (s: string) =>
      createHash("sha256").update(s).digest("hex"),
  };
});
vi.mock("expo-crypto", async () => {
  const { randomUUID, createHash } = await import("node:crypto");
  return {
    randomUUID,
    CryptoDigestAlgorithm: { SHA256: "SHA256" },
    digestStringAsync: async (_algorithm: string, text: string) => {
      if (runtime.hold) {
        const hold = runtime.hold;
        runtime.hold = undefined;
        hold.entered();
        await hold.promise;
      }
      return createHash("sha256").update(text).digest("hex");
    },
  };
});
type Fixture = Awaited<ReturnType<typeof nativeVisualConflictFixture>>;
let tree: ReactTestRenderer | undefined;
const fixtures: Fixture[] = [];
function hosts(tag: string) {
  return tree!.root.findAll(
    (n) => typeof n.type === "string" && n.type === tag,
  );
}
function button(label: string) {
  return hosts("Button").find(
    (n) => String(n.props.label).replace(/^✓ /, "") === label,
  )!;
}
function check(part: string) {
  return hosts("Check").find((n) =>
    String(n.props.accessibilityLabel).includes(part),
  )!;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function view(s: Fixture) {
  return createElement(VisualLibraryConflict, { conflict: s.review.conflict });
}
async function setup(
  kind: (typeof visualConflictKinds)[number],
  retired?: "LOCAL" | "REMOTE",
) {
  const s = await nativeVisualConflictFixture(kind, ":memory:", retired);
  fixtures.push(s);
  runtime.database = { sqlite: s.a, deviceId: s.scope.deviceId };
  runtime.session = {
    user: { id: s.scope.ownerId },
    stores: [{ storeId: s.scope.storeId, role: "MANAGER" }],
  };
  await act(async () => {
    tree = create(view(s));
  });
  return s;
}
async function select(local = true, compare = true) {
  await act(async () =>
    button(
      local ? "Garder mon choix" : "Garder le choix synchronisé",
    ).props.onPress(),
  );
  if (
    hosts("Check").some((n) =>
      String(n.props.accessibilityLabel).includes("droits d’utilisation"),
    )
  )
    await act(async () => check("droits d’utilisation").props.onPress());
  if (compare) await act(async () => check("J’ai comparé").props.onPress());
}
function snapshot(s: Fixture) {
  return [
    s.review.table,
    "visual_conflict_history",
    "sync_conflicts",
    "sync_outbox",
    "local_jobs",
  ].map((t) => s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runtime.focused = true;
  runtime.hold = undefined;
  runtime.sync.mockReset().mockResolvedValue(undefined);
  runtime.back.mockReset();
  runtime.uri.mockReset().mockResolvedValue(null);
  const error = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      error(...args);
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  for (const s of fixtures.splice(0)) s.db.close();
  runtime.hold = undefined;
});
describe.each(visualConflictKinds)("%s mounted visual comparison", (kind) => {
  it("requires its own choice and comparison and accepts a double press exactly once", async () => {
    const s = await setup(kind),
      before = s.count("visual_conflict_history");
    expect(button("Confirmer cette résolution").props.disabled).toBe(true);
    await select();
    const action = button("Confirmer cette résolution");
    expect(action.props.disabled).toBe(false);
    await act(async () => {
      action.props.onPress();
      action.props.onPress();
    });
    expect(s.count("visual_conflict_history")).toBe(before + 1);
    expect(runtime.sync).toHaveBeenCalledTimes(1);
    expect(runtime.back).toHaveBeenCalledTimes(1);
  });
  it("requires rereading a changed comparison and clears all previous consents", async () => {
    const s = await setup(kind);
    await select();
    await applyVisualEntity(s.a, s.scope.storeId, kind, {
      ...s.review.remote,
      version: 3,
    });
    await act(async () => button("Confirmer cette résolution").props.onPress());
    expect(s.count("visual_conflict_history")).toBe(0);
    expect(
      hosts("Alert").some((n) =>
        String(n.props.message).includes("comparaison a changé"),
      ),
    ).toBe(true);
    expect(check("J’ai comparé").props.accessibilityState.checked).toBe(false);
    await act(async () => button("Relire la comparaison").props.onPress());
    expect(button("Confirmer cette résolution").props.disabled).toBe(true);
    expect(
      hosts("Check").every((n) => n.props.accessibilityState.checked === false),
    ).toBe(true);
    await select(false);
    await act(async () => button("Confirmer cette résolution").props.onPress());
    expect(
      (await s.library.get(kind, s.scope.storeId, s.review.local.id))!
        .remoteVersion,
    ).toBe(3);
  });
  it.each([
    "OWNER",
    "STORE",
    "ROLE",
    "DEVICE",
    "DATABASE",
    "TARGET",
    "BLUR",
    "UNMOUNT",
  ] as const)(
    "cancels a delayed visual decision on %s replacement",
    async (mode) => {
      const s = await setup(kind),
        before = snapshot(s);
      await select();
      const entered = deferred(),
        gate = deferred();
      runtime.hold = { entered: entered.resolve, promise: gate.promise };
      await act(async () => {
        button("Confirmer cette résolution").props.onPress();
        await entered.promise;
      });
      await act(async () => {
        if (mode === "OWNER")
          runtime.session = {
            user: { id: randomUUID() },
            stores: [{ storeId: s.scope.storeId, role: "MANAGER" }],
          };
        if (mode === "STORE")
          runtime.session = {
            user: { id: s.scope.ownerId },
            stores: [{ storeId: randomUUID(), role: "MANAGER" }],
          };
        if (mode === "ROLE")
          runtime.session = {
            user: { id: s.scope.ownerId },
            stores: [{ storeId: s.scope.storeId, role: "VIEWER" }],
          };
        if (mode === "DEVICE")
          runtime.database = { sqlite: s.a, deviceId: randomUUID() };
        if (mode === "DATABASE") {
          const other = await nativeVisualConflictFixture(kind);
          fixtures.push(other);
          runtime.database = { sqlite: other.a, deviceId: s.scope.deviceId };
        }
        if (mode === "BLUR") runtime.focused = false;
        if (mode === "UNMOUNT") {
          tree!.unmount();
          tree = undefined;
        } else
          tree!.update(
            createElement(VisualLibraryConflict, {
              conflict:
                mode === "TARGET"
                  ? {
                      ...s.review.conflict,
                      id: randomUUID(),
                      entityId: randomUUID(),
                    }
                  : s.review.conflict,
            }),
          );
      });
      await act(async () => {
        gate.resolve();
        await gate.promise;
      });
      expect(snapshot(s)).toEqual(before);
      expect(runtime.sync).not.toHaveBeenCalled();
      expect(runtime.back).not.toHaveBeenCalled();
    },
  );
  it("keeps readable metadata after a failed reread and refuses an old button callback after a database replacement", async () => {
    const s = await setup(kind);
    await select();
    const old = button("Confirmer cette résolution").props.onPress,
      before = snapshot(s);
    vi.spyOn(s.a, "getFirstAsync").mockRejectedValueOnce(Error("READ_FAILURE"));
    await act(async () => button("Relire la comparaison").props.onPress());
    expect(hosts("Card")).toHaveLength(2);
    expect(button("Confirmer cette résolution").props.disabled).toBe(true);
    const other = await nativeVisualConflictFixture(kind);
    fixtures.push(other);
    runtime.database = { sqlite: other.a, deviceId: s.scope.deviceId };
    await act(async () => tree!.update(view(s)));
    await act(async () => old());
    expect(snapshot(s)).toEqual(before);
    expect(runtime.back).not.toHaveBeenCalled();
  });
  it("retains a committed choice if the background send fails", async () => {
    const s = await setup(kind);
    runtime.sync.mockRejectedValueOnce(Error("OFFLINE"));
    await select();
    await act(async () => button("Confirmer cette résolution").props.onPress());
    expect(s.count("visual_conflict_history")).toBe(1);
    expect(
      (await s.library.get(kind, s.scope.storeId, s.review.local.id))!
        .syncState,
    ).toBe("PENDING");
    expect(runtime.back).toHaveBeenCalledTimes(1);
    expect(hosts("Alert")).toHaveLength(0);
  });
});
for (const kind of visualConflictKinds)
  it.each(["LOCAL", "REMOTE"] as const)(
    `${kind} reactivation requires its own consent (retired %s)`,
    async (retired) => {
      const s = await setup(kind, retired);
      await select(retired === "REMOTE");
      expect(button("Confirmer cette résolution").props.disabled).toBe(true);
      await act(async () => check("remise en diffusion").props.onPress());
      expect(button("Confirmer cette résolution").props.disabled).toBe(false);
      await act(async () => button("Relire la comparaison").props.onPress());
      expect(
        hosts("Check").every(
          (n) => n.props.accessibilityState.checked === false,
        ),
      ).toBe(true);
      await select(retired === "REMOTE");
      await act(async () => check("remise en diffusion").props.onPress());
      await act(async () =>
        button("Confirmer cette résolution").props.onPress(),
      );
      expect(s.count("visual_conflict_history")).toBe(1);
    },
  );
it("an uploaded photo requires separate rights confirmation and changing sides clears it", async () => {
  await setup("visual_asset");
  await act(async () => button("Garder mon choix").props.onPress());
  await act(async () => check("J’ai comparé").props.onPress());
  expect(button("Confirmer cette résolution").props.disabled).toBe(true);
  await act(async () => check("droits d’utilisation").props.onPress());
  expect(button("Confirmer cette résolution").props.disabled).toBe(false);
  await select(false);
  await act(async () => button("Garder mon choix").props.onPress());
  expect(check("droits d’utilisation").props.accessibilityState.checked).toBe(
    false,
  );
  expect(check("J’ai comparé").props.accessibilityState.checked).toBe(false);
});
it("shows a missing local preview without throwing or changing the source metadata", async () => {
  const s = await setup("visual_asset"),
    before = snapshot(s);
  runtime.uri.mockRejectedValue(Error("MISSING_FILE"));
  await act(async () =>
    button("Voir la photo conservée sur cet appareil").props.onPress(),
  );
  expect(
    hosts("Text").some((n) =>
      String(n.props.children).includes("photo n’est pas disponible"),
    ),
  ).toBe(true);
  expect(snapshot(s)).toEqual(before);
});
