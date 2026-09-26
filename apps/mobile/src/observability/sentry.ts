import * as Sentry from "@sentry/react-native";
import { getAppEnvironment } from "@/config/environment";

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
    beforeSend(event) {
      // Keep diagnostics, but never send identity, request payloads or breadcrumb data.
      event.user = undefined;
      event.request = undefined;
      event.extra = undefined;
      event.breadcrumbs = event.breadcrumbs?.map(
        ({ category, level, timestamp, type }) => ({
          category,
          level,
          timestamp,
          type,
        }),
      );
      return event;
    },
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
