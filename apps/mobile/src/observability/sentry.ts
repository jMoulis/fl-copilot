import * as Sentry from "@sentry/react-native";
import { getAppEnvironment } from "@/config/environment";
import { sanitizeMobileEvent } from "./sanitize-event";
import { localOperationFailureCode } from "./local-operation-failure";

let initialized = false;

export function initializeObservability() {
  if (initialized) return;
  initialized = true;

  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: getAppEnvironment(),
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableLogs: true,
    enableAutoPerformanceTracing: false,
    tracesSampleRate: 0,
    beforeSend: sanitizeMobileEvent,
  });
}

export function captureScreenError(error: unknown, route: string) {
  Sentry.withScope((scope) => {
    scope.setTag("route", route);
    Sentry.captureException(error);
  });
}

const localReports = new Map<string, number>();
export function captureLocalOperationFailure(
  reason: unknown,
  phase:
    | "mercalys-prepare"
    | "mercalys-publish"
    | "mercalys-repair"
    | "synchronization",
) {
  // Native/Zod messages may contain file paths, SQL or product/source values.
  // Report the fixed category and phase, never the raw exception or its cause.
  const code = localOperationFailureCode(reason) ?? "LOCAL_OPERATION_FAILED";
  const key = `${phase}:${code}`,
    now = Date.now();
  if (now - (localReports.get(key) ?? 0) < 30_000) return;
  localReports.set(key, now);
  try {
    Sentry.withScope((scope) => {
      scope.setTag("local_operation", phase);
      scope.setTag("local_failure", code);
      Sentry.captureException(new Error(`${phase}: ${code}`));
    });
  } catch {
    /* Monitoring must never change a local transaction's outcome. */
  }
}

export async function sendMobileObservabilityTest() {
  Sentry.logger.info("Mobile observability test", {
    environment: getAppEnvironment(),
    source: "manual-test",
  });
  Sentry.captureException(new Error("M0-T10 mobile monitoring test error"));
  return Sentry.flush();
}

export const withSentry = Sentry.wrap;
