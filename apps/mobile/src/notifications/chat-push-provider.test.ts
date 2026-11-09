import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatPushProvider } from "./chat-push-provider";
const runtime = vi.hoisted(() => ({
  state: "background",
  sqlite: {},
  deviceId: "11111111-1111-4111-8111-111111111111",
  session: {
    accessToken: "test",
    user: { id: "22222222-2222-4222-8222-222222222222" },
    stores: [{ storeId: "33333333-3333-4333-8333-333333333333" }],
  },
  states: new Set<(state: string) => void>(),
  tokens: new Set<(token: { type: "ios"; data: string }) => void>(),
  read: vi.fn(async (key: string) =>
    key.startsWith("fl.email-push.") ? null : "1",
  ),
  write: vi.fn(async () => {}),
  save: vi.fn(async () => ({ enabled: true })),
  permission: vi.fn(async () => ({ granted: true })),
  token: vi.fn(async () => ({ data: "ExpoPushToken[aaaaaaaaaaaaaaaaaaaaaa]" })),
  nativeToken: vi.fn(async () => {
    const value = { type: "ios" as const, data: "native-token-a" };
    for (const callback of runtime.tokens) callback(value);
    return value;
  }),
  access: vi.fn(async (op: (token: string) => unknown) => op("test-access")),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: {
    get currentState() {
      return runtime.state;
    },
    addEventListener: (_: string, cb: (s: string) => void) => {
      runtime.states.add(cb);
      return { remove: () => runtime.states.delete(cb) };
    },
  },
}));
vi.mock("expo-constants", () => ({
  default: {
    appOwnership: "standalone",
    easConfig: { projectId: "test-project" },
  },
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: runtime.read,
  setItemAsync: runtime.write,
}));
vi.mock("@fl-copilot/api-client", () => ({
  ApiClient: class {
    updateDevicePushToken = runtime.save;
  },
}));
vi.mock("@/auth/auth-provider", () => ({
  useAuth: () => ({
    session: runtime.session,
    status: "authenticated",
    withAccessToken: runtime.access,
  }),
}));
vi.mock("@/providers/database-provider", () => ({
  useLocalDatabase: () => ({
    sqlite: runtime.sqlite,
    deviceId: runtime.deviceId,
  }),
}));
vi.mock("@/config/environment", () => ({
  getApiBaseUrl: () => "https://test.invalid",
}));
vi.mock(
  "@/reminders/coalesced-runner",
  async () => import("../reminders/coalesced-runner"),
);
vi.mock("@/reminders/native", () => ({
  requestReminderPermission: vi.fn(async () => true),
  notificationModule: async () => ({
    getPermissionsAsync: runtime.permission,
    getExpoPushTokenAsync: runtime.token,
    getDevicePushTokenAsync: runtime.nativeToken,
    IosAuthorizationStatus: { PROVISIONAL: 3 },
    addPushTokenListener: (
      cb: (token: { type: "ios"; data: string }) => void,
    ) => {
      runtime.tokens.add(cb);
      return { remove: () => runtime.tokens.delete(cb) };
    },
  }),
}));
let renderer: ReactTestRenderer | undefined;
async function render() {
  await act(async () => {
    if (renderer) renderer.update(createElement(ChatPushProvider, {}, null));
    else renderer = create(createElement(ChatPushProvider, {}, null));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    if (!String(a[0]).includes("react-test-renderer is deprecated"))
      original(...a);
  });
  runtime.state = "background";
  runtime.read.mockClear();
  runtime.save.mockClear();
  runtime.token
    .mockReset()
    .mockImplementation(async (options?: { devicePushToken?: unknown }) => {
      if (!options?.devicePushToken) {
        // Expo requests the native token, which emits its listener even unchanged.
        if (runtime.nativeToken.mock.calls.length < 2)
          await runtime.nativeToken();
      }
      return { data: "ExpoPushToken[aaaaaaaaaaaaaaaaaaaaaa]" };
    });
  runtime.nativeToken.mockClear();
  runtime.permission.mockClear();
  runtime.access.mockClear();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  runtime.states.clear();
  runtime.tokens.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("does not register from background mount/token events, then reconciles once on foreground", async () => {
  await render();
  await act(async () => {
    for (const cb of runtime.tokens)
      cb({ type: "ios", data: "native-token-a" });
  });
  expect(runtime.read).not.toHaveBeenCalled();
  expect(runtime.save).not.toHaveBeenCalled();
  await act(async () => {
    runtime.state = "active";
    for (const cb of runtime.states) cb("active");
  });
  expect(runtime.save).toHaveBeenCalledTimes(1);
  expect(runtime.token).toHaveBeenCalledTimes(1);
  await act(async () => renderer!.unmount());
  renderer = undefined;
  expect(runtime.states.size).toBe(0);
  expect(runtime.tokens.size).toBe(0);
});
it("ordinary rerenders do not re-register tokens or accumulate listeners", async () => {
  runtime.state = "active";
  await render();
  for (let i = 0; i < 100; i++) await render();
  expect(runtime.read).toHaveBeenCalledTimes(2);
  expect(runtime.save).toHaveBeenCalledTimes(1);
  expect(runtime.states.size).toBe(1);
  expect(runtime.tokens.size).toBe(1);
});

it("does not feed the native token read event back into another registration", async () => {
  runtime.state = "active";
  await render();
  expect(runtime.save).toHaveBeenCalledTimes(1);
  expect(runtime.nativeToken).toHaveBeenCalledTimes(1);
  expect(runtime.token).toHaveBeenCalledWith(
    expect.objectContaining({
      devicePushToken: { type: "ios", data: "native-token-a" },
    }),
  );
});
it("uses a rolled native token directly without requesting another native registration", async () => {
  runtime.state = "active";
  await render();
  runtime.save.mockClear();
  runtime.token.mockClear();
  await act(async () => {
    for (const cb of runtime.tokens)
      cb({ type: "ios", data: "native-token-b" });
  });
  expect(runtime.save).toHaveBeenCalledTimes(1);
  expect(runtime.nativeToken).toHaveBeenCalledTimes(1);
  expect(runtime.token).toHaveBeenCalledWith(
    expect.objectContaining({
      devicePushToken: { type: "ios", data: "native-token-b" },
    }),
  );
});

it("ignores repeated unchanged native token events", async () => {
  runtime.state = "active";
  await render();
  await act(async () => {
    for (let index = 0; index < 100; index++)
      for (const cb of runtime.tokens)
        cb({ type: "ios", data: "native-token-a" });
  });
  expect(runtime.save).toHaveBeenCalledTimes(1);
  expect(runtime.token).toHaveBeenCalledTimes(1);
  expect(runtime.nativeToken).toHaveBeenCalledTimes(1);
});
it("caches background rollover and reconciles it only on foreground", async () => {
  runtime.state = "active";
  await render();
  runtime.save.mockClear();
  runtime.token.mockClear();
  await act(async () => {
    runtime.state = "background";
    for (const cb of runtime.states) cb("background");
    for (const cb of runtime.tokens)
      cb({ type: "ios", data: "native-token-b" });
  });
  expect(runtime.save).not.toHaveBeenCalled();
  await act(async () => {
    runtime.state = "active";
    for (const cb of runtime.states) cb("active");
  });
  expect(runtime.save).toHaveBeenCalledTimes(1);
  expect(runtime.nativeToken).toHaveBeenCalledTimes(1);
  expect(runtime.token).toHaveBeenCalledWith(
    expect.objectContaining({
      devicePushToken: { type: "ios", data: "native-token-b" },
    }),
  );
});
