import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { AuthSessionResponse } from "@fl-copilot/sync-contracts";
import { AuthProvider, useAuth } from "./auth-provider";
const runtime = vi.hoisted(() => ({
  expectedOwner: undefined as string | undefined,
  assertOwner: vi.fn(),
  markVerified: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
  request: vi.fn(),
  verify: vi.fn(),
  refresh: vi.fn(),
  remoteLogout: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("../components/ui", () => ({
  AppScreen: "Screen",
  AppHeader: "Header",
  InlineAlert: "Alert",
  PrimaryButton: "Button",
}));
vi.mock("expo-constants", () => ({
  default: { expoConfig: { version: "0.1.0" } },
}));
vi.mock("@/config/environment", () => ({
  getApiBaseUrl: () => "https://example.test",
}));
vi.mock("@/providers/database-provider", () => ({
  useDeviceIdentity: () => "device",
  useDatabaseAccessBinding: () =>
    runtime.expectedOwner
      ? { ownerId: runtime.expectedOwner, generation: "generation" }
      : undefined,
}));
vi.mock("./auth-storage", () => ({
  loadStoredSession: runtime.load,
  saveStoredSession: runtime.save,
  clearStoredSession: runtime.clear,
  assertRestoredSessionOwner: runtime.assertOwner,
  markRestoredSessionVerified: runtime.markVerified,
}));
vi.mock("@fl-copilot/api-client", async (original) => ({
  ...(await original<typeof import("@fl-copilot/api-client")>()),
  ApiClient: class {
    requestLoginCode = runtime.request;
    verifyLoginCode = runtime.verify;
    refreshSession = runtime.refresh;
    logout = runtime.remoteLogout;
  },
}));
let tree: ReactTestRenderer | undefined, auth: ReturnType<typeof useAuth>;
function Probe() {
  auth = useAuth();
  return createElement("PrivateContent");
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function session(owner = "owner"): AuthSessionResponse {
  return {
    user: { id: owner, email: "owner@example.test", displayName: "Owner" },
    stores: [{ storeId: "store", role: "MANAGER", name: "Store" }],
    accessToken: "access",
    accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    refreshToken: "refresh",
  };
}
async function mount() {
  await act(async () => {
    tree = create(createElement(AuthProvider, {}, createElement(Probe)));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
  runtime.expectedOwner = undefined;
  vi.resetAllMocks();
  runtime.assertOwner.mockImplementation(
    async (_g: string, expected: string, actual: string) => {
      if (expected !== actual) {
        const { LocalCopyError } = await import("../db/local-copy-contracts");
        throw new LocalCopyError("OWNER");
      }
    },
  );
  runtime.load.mockResolvedValue(null);
  runtime.request.mockResolvedValue({ challengeId: "challenge" });
  runtime.verify.mockResolvedValue(session());
  runtime.refresh.mockResolvedValue(session());
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});
it("rejects a late code request from an unmounted provider", async () => {
  await mount();
  const request = deferred<{ challengeId: string }>();
  runtime.request.mockReturnValue(request.promise);
  const operation = auth.requestCode("owner@example.test");
  const result = expect(operation).rejects.toThrow("session a changé");
  await act(async () => tree!.unmount());
  request.resolve({ challengeId: "late" });
  await result;
  expect(runtime.save).not.toHaveBeenCalled();
});
it("cannot establish a late verified session after local logout", async () => {
  await mount();
  await act(async () => auth.requestCode("owner@example.test"));
  const verify = deferred<AuthSessionResponse>();
  runtime.verify.mockReturnValue(verify.promise);
  const operation = auth.verifyCode("123456"),
    result = expect(operation).rejects.toThrow("session a changé");
  await act(async () => auth.logout({ localOnly: true }));
  verify.resolve(session());
  await result;
  expect(runtime.save).not.toHaveBeenCalled();
  expect(runtime.remoteLogout).not.toHaveBeenCalled();
});
it("requires the copy's known owner before saving credentials or publishing authenticated content", async () => {
  runtime.expectedOwner = "original-owner";
  await mount();
  await act(async () => auth.requestCode("other@example.test"));
  await expect(auth.verifyCode("123456")).rejects.toThrow("compte d’origine");
  expect(auth.status).toBe("anonymous");
  expect(runtime.save).not.toHaveBeenCalled();
  runtime.verify.mockResolvedValue(session("original-owner"));
  await act(async () => auth.verifyCode("123456"));
  expect(auth.session?.user.id).toBe("original-owner");
  expect(runtime.save).toHaveBeenCalledTimes(1);
});
it("does not expose a retained marker from a foreign account when a restored copy opens", async () => {
  runtime.expectedOwner = "original-owner";
  runtime.load.mockResolvedValue({
    refreshToken: "old",
    marker: session("other"),
  });
  await mount();
  expect(auth.status).toBe("anonymous");
  expect(runtime.clear).toHaveBeenCalledTimes(1);
  expect(runtime.refresh).not.toHaveBeenCalled();
});
it("drains canonical logout and prevents an in-flight refresh from writing back after the operational tree closes", async () => {
  runtime.load.mockResolvedValue({ refreshToken: "old", marker: session() });
  const refresh = deferred<AuthSessionResponse>();
  runtime.refresh.mockReturnValue(refresh.promise);
  await mount();
  expect(auth.status).toBe("authenticated");
  await act(async () => auth.logout({ localOnly: true }));
  await act(async () => tree!.unmount());
  await act(async () => refresh.resolve(session()));
  expect(runtime.clear).toHaveBeenCalledTimes(1);
  expect(runtime.save).not.toHaveBeenCalled();
  await expect(auth.withAccessToken(async () => "unreachable")).rejects.toThrow(
    "session a changé",
  );
});
it("keeps credentials and shows a retry instead of logging out when cold SecureStore reading is temporarily unavailable", async () => {
  runtime.load.mockRejectedValueOnce(Error("KEYCHAIN_TEMPORARILY_UNAVAILABLE"));
  await mount();
  expect(runtime.clear).not.toHaveBeenCalled();
  expect(runtime.remoteLogout).not.toHaveBeenCalled();
  expect(runtime.save).not.toHaveBeenCalled();
  expect(
    tree!.root.find((node) => String(node.type) === "Button").props.label,
  ).toBe("Réessayer");
});
it("does not erase a stored session when the restored-copy ownership trace is temporarily unreadable", async () => {
  runtime.expectedOwner = "owner";
  runtime.load.mockResolvedValue({
    refreshToken: "retained",
    marker: session(),
  });
  runtime.assertOwner.mockRejectedValueOnce(Error("KEYCHAIN_UNAVAILABLE"));
  await mount();
  expect(runtime.clear).not.toHaveBeenCalled();
  expect(runtime.refresh).not.toHaveBeenCalled();
});
it("retries a failed cold read explicitly, keeps private children absent while waiting and restores offline access without logging out", async () => {
  runtime.load.mockRejectedValueOnce(Error("KEYCHAIN_UNAVAILABLE"));
  await mount();
  const retry = () => tree!.root.find((n) => String(n.type) === "Button");
  const stored = deferred<{
    refreshToken: string;
    marker: AuthSessionResponse;
  }>();
  runtime.load.mockReturnValueOnce(stored.promise);
  runtime.refresh.mockRejectedValueOnce(Error("NETWORK_OFFLINE"));
  await act(async () => retry().props.onPress());
  expect(retry().props.disabled).toBe(true);
  expect(
    tree!.root.findAll((node) => String(node.type) === "PrivateContent"),
  ).toHaveLength(0);
  expect(runtime.load).toHaveBeenCalledTimes(2);
  expect(runtime.refresh).not.toHaveBeenCalled();
  await act(async () =>
    stored.resolve({ refreshToken: "retained", marker: session() }),
  );
  expect(tree!.root.findAll((n) => String(n.type) === "Button")).toHaveLength(
    0,
  );
  expect(auth.status).toBe("authenticated");
  expect(auth.session?.user.id).toBe("owner");
  expect(
    tree!.root.findAll((node) => String(node.type) === "PrivateContent"),
  ).toHaveLength(1);
  expect(runtime.clear).not.toHaveBeenCalled();
});
it("does not replace a newer authenticated session when an older startup read fails late", async () => {
  let fail!: (reason: Error) => void;
  runtime.load.mockReturnValue(
    new Promise((_, reject) => {
      fail = reject;
    }),
  );
  await mount();
  await act(async () => auth.requestCode("owner@example.test"));
  await act(async () => auth.verifyCode("123456"));
  await act(async () => fail(Error("OLD_READ_FAILED")));
  expect(auth.status).toBe("authenticated");
  expect(runtime.clear).not.toHaveBeenCalled();
  expect(tree!.root.findAll((n) => String(n.type) === "Button")).toHaveLength(
    0,
  );
});
it("retains a safely blocked startup after repeated errors and never prints credentials or native diagnostics", async () => {
  runtime.load.mockRejectedValue(
    Error("private-refresh-secret /private/native/path"),
  );
  await mount();
  for (let i = 0; i < 3; i++)
    await act(async () =>
      tree!.root.find((n) => String(n.type) === "Button").props.onPress(),
    );
  expect(runtime.load).toHaveBeenCalledTimes(4);
  expect(runtime.clear).not.toHaveBeenCalled();
  expect(JSON.stringify(tree!.toJSON())).not.toContain(
    "private-refresh-secret",
  );
  expect(
    tree!.root.find((n) => String(n.type) === "Alert").props.message,
  ).toContain("sans supprimer l’application");
});
it("opens valid cached content immediately after a retry even while network token renewal remains unresolved", async () => {
  runtime.load.mockRejectedValueOnce(Error("KEYCHAIN_UNAVAILABLE"));
  await mount();
  runtime.load.mockResolvedValue({
    refreshToken: "retained",
    marker: session(),
  });
  const network = deferred<AuthSessionResponse>();
  runtime.refresh.mockReturnValue(network.promise);
  await act(async () =>
    tree!.root.find((n) => String(n.type) === "Button").props.onPress(),
  );
  expect(auth.status).toBe("authenticated");
  expect(tree!.root.findAll((n) => String(n.type) === "Button")).toHaveLength(
    0,
  );
  expect(runtime.clear).not.toHaveBeenCalled();
  await act(async () => network.resolve(session()));
});
it("ignores a failed startup read after the provider closes without clearing a later stored session", async () => {
  let fail!: (reason: Error) => void;
  runtime.load.mockReturnValue(
    new Promise((_, reject) => {
      fail = reject;
    }),
  );
  await mount();
  await act(async () => tree!.unmount());
  await act(async () => fail(Error("LATE_KEYCHAIN_FAILURE")));
  expect(runtime.clear).not.toHaveBeenCalled();
  expect(runtime.remoteLogout).not.toHaveBeenCalled();
});
