import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatPushProvider } from "./chat-push-provider";
const runtime = vi.hoisted(() => ({
  state: "background",
  generation: 0,
  drain: vi.fn(async (revoke: (token: string) => Promise<void>) => {
    void revoke;
  }),
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
vi.mock("@/auth/auth-storage", () => ({ drainPendingLogouts: runtime.drain }));
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
  nativeRegistrationIsCurrent: () => {
    const generation = runtime.generation;
    return () => generation === runtime.generation;
  },
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
  runtime.drain.mockReset().mockResolvedValue(undefined);
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
  expect(runtime.read).toHaveBeenCalledTimes(3);
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

it("registers with native again after account replacement rather than reusing a retired native token", async () => {
  runtime.state = "active";
  await render();
  const owner = runtime.session.user.id;
  runtime.generation++;
  runtime.session = {
    ...runtime.session,
    user: { id: "44444444-4444-4444-8444-444444444444" },
  };
  try {
    await render();
    expect(runtime.nativeToken).toHaveBeenCalledTimes(2);
    expect(runtime.save).toHaveBeenCalledTimes(2);
  } finally {
    runtime.session = { ...runtime.session, user: { id: owner } };
  }
});
it("a native token obtained after logout cannot register the old destination", async () => {
  runtime.state = "active";
  let release!: (value: { type: "ios"; data: string }) => void;
  runtime.nativeToken.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await render();
  expect(release).toBeTypeOf("function");
  runtime.generation++;
  await act(async () => release({ type: "ios", data: "old-native-token" }));
  expect(runtime.token).not.toHaveBeenCalled();
  expect(runtime.save).not.toHaveBeenCalled();
});

it("does not register for native delivery until the former session's revocation is acknowledged", async () => {
  runtime.state = "active";
  let release!: () => void;
  runtime.drain.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await render();
  expect(release).toBeTypeOf("function");
  expect(runtime.nativeToken).not.toHaveBeenCalled();
  expect(runtime.save).not.toHaveBeenCalled();
  await act(async () => release());
  expect(runtime.nativeToken).toHaveBeenCalledTimes(1);
  expect(runtime.save).toHaveBeenCalledTimes(1);
});
it("keeps remote delivery retired if the previous logout still cannot reach the server", async () => {
  runtime.state = "active";
  runtime.drain.mockRejectedValueOnce(Error("offline"));
  await render();
  expect(runtime.nativeToken).not.toHaveBeenCalled();
  expect(runtime.save).not.toHaveBeenCalled();
});

it("does not reuse an unsolicited old native event as proof of registration for a fresh session", async () => {
  await render();
  await act(async () => {
    for (const listener of runtime.tokens)
      listener({ type: "ios", data: "retired-device-token" });
  });
  await act(async () => {
    runtime.state = "active";
    for (const listener of runtime.states) listener("active");
  });
  expect(runtime.nativeToken).toHaveBeenCalledTimes(1);
  expect(runtime.token).toHaveBeenCalledWith(
    expect.objectContaining({
      devicePushToken: { type: "ios", data: "native-token-a" },
    }),
  );
});
