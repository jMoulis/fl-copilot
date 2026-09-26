import * as Sentry from "@sentry/react-native";
import { getAppEnvironment } from "@/config/environment";
import { sanitizeMobileEvent } from "./sanitize-event";

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

export async function sendMobileObservabilityTest() {
  Sentry.logger.info("Mobile observability test", {
    environment: getAppEnvironment(),
    source: "manual-test",
  });
  Sentry.captureException(new Error("M0-T10 mobile monitoring test error"));
  return Sentry.flush();
}

export const withSentry = Sentry.wrap;
