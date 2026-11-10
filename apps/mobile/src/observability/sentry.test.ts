import { afterEach, beforeEach, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  withScope: vi.fn(),
  setTag: vi.fn(),
  logger: { info: vi.fn() },
  flush: vi.fn(),
  wrap: vi.fn((component) => component),
}));
vi.mock("@sentry/react-native", () => sdk);
vi.mock("@/config/environment", () => ({
  getAppEnvironment: () => "staging",
}));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("EXPO_PUBLIC_SENTRY_DSN", "https://test@example.invalid/1");
  sdk.withScope.mockImplementation((callback) => callback(sdk));
  sdk.flush.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

it("leaves startup and error recovery usable when optional initialization fails", async () => {
  sdk.init.mockImplementation(() => {
    throw new Error("SDK unavailable");
  });
  const monitoring = await import("./sentry");
  expect(() => monitoring.initializeObservability()).not.toThrow();
  monitoring.initializeObservability();
  expect(sdk.init).toHaveBeenCalledTimes(1);
  expect(() =>
    monitoring.captureScreenError(new Error("private"), "root"),
  ).not.toThrow();
  monitoring.captureLocalOperationFailure(
    new Error("private"),
    "synchronization",
  );
  expect(await monitoring.sendMobileObservabilityTest()).toBe(false);
  expect(sdk.captureException).not.toHaveBeenCalled();
  expect(sdk.flush).not.toHaveBeenCalled();
});

it.each(["scope", "tag", "capture"])(
  "isolates %s failure from screen recovery and local publication",
  async (failure) => {
    const monitoring = await import("./sentry");
    monitoring.initializeObservability();
    const fail = () => {
      throw new Error("SDK unavailable");
    };
    if (failure === "scope") sdk.withScope.mockImplementation(fail);
    if (failure === "tag") sdk.setTag.mockImplementation(fail);
    if (failure === "capture") sdk.captureException.mockImplementation(fail);
    expect(() =>
      monitoring.captureScreenError(new Error("private"), "commercial-review"),
    ).not.toThrow();
    expect(() =>
      monitoring.captureLocalOperationFailure(
        new Error("private"),
        "mercalys-publish",
      ),
    ).not.toThrow();
  },
);

it("retains stack-bearing error identity, fixed local diagnostics and existing deduplication", async () => {
  const monitoring = await import("./sentry");
  monitoring.initializeObservability();
  const error = new Error("private document", {
    cause: new Error("private SQL"),
  });
  monitoring.captureScreenError(error, "root");
  expect(sdk.captureException).toHaveBeenLastCalledWith(error);
  expect(error.message).toBe("private document");
  monitoring.captureLocalOperationFailure(
    { code: "SQLITE_BUSY" },
    "mercalys-publish",
  );
  monitoring.captureLocalOperationFailure(
    { code: "SQLITE_BUSY" },
    "mercalys-publish",
  );
  expect(sdk.captureException).toHaveBeenCalledTimes(2);
  expect(sdk.setTag).toHaveBeenCalledWith(
    "local_failure",
    "LOCAL_DATABASE_BUSY",
  );
  expect(sdk.captureException.mock.calls[1]?.[0].message).toBe(
    "mercalys-publish: LOCAL_DATABASE_BUSY",
  );
});

it("keeps the privacy hook and sampling settings on the single initialized provider", async () => {
  const monitoring = await import("./sentry");
  monitoring.initializeObservability();
  monitoring.initializeObservability();
  expect(sdk.init).toHaveBeenCalledTimes(1);
  const options = sdk.init.mock.calls[0]?.[0];
  expect(options).toMatchObject({
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableAutoPerformanceTracing: false,
    tracesSampleRate: 0,
  });
  expect(
    JSON.stringify(
      options.beforeSend({
        exception: { values: [{ type: "Error", value: "private product" }] },
      }),
    ),
  ).not.toContain("private");
  expect(await monitoring.sendMobileObservabilityTest()).toBe(true);
  expect(sdk.flush).toHaveBeenCalledTimes(1);
});

it.each(["logger", "capture", "flush"])(
  "returns a failed manual check instead of an unhandled %s error",
  async (failure) => {
    const monitoring = await import("./sentry");
    monitoring.initializeObservability();
    const fail = () => {
      throw new Error("SDK unavailable");
    };
    if (failure === "logger") sdk.logger.info.mockImplementation(fail);
    if (failure === "capture") sdk.captureException.mockImplementation(fail);
    if (failure === "flush")
      sdk.flush.mockRejectedValue(new Error("SDK unavailable"));
    expect(await monitoring.sendMobileObservabilityTest()).toBe(false);
  },
);

it("does not call the unconfigured provider or claim successful delivery", async () => {
  vi.stubEnv("EXPO_PUBLIC_SENTRY_DSN", "");
  const monitoring = await import("./sentry");
  monitoring.initializeObservability();
  monitoring.captureScreenError(new Error("private"), "root");
  monitoring.captureLocalOperationFailure(
    new Error("private"),
    "synchronization",
  );
  expect(await monitoring.sendMobileObservabilityTest()).toBe(false);
  expect(sdk.init).not.toHaveBeenCalled();
  expect(sdk.withScope).not.toHaveBeenCalled();
  expect(sdk.captureException).not.toHaveBeenCalled();
  expect(sdk.flush).not.toHaveBeenCalled();
});
