import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN?.trim();
const enabled = Boolean(dsn);

if (enabled) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: 0,
    enableRuntimeChannelInjection: false,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    beforeSend(event) {
      // Request bodies, source files and user identity are intentionally excluded.
      event.user = undefined;
      event.request = undefined;
      event.extra = undefined;
      event.server_name = undefined;
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

type SafeLogAttributes = Record<string, boolean | number | string>;

export function logRemoteEvent(
  level: "error" | "info",
  message: string,
  attributes: SafeLogAttributes,
) {
  if (!enabled) return;
  Sentry.logger[level](message, attributes);
}

export function captureApiError(
  error: unknown,
  context: { code: string; method: string; requestId: string },
) {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    scope.setTag("error_code", context.code);
    scope.setTag("http_method", context.method);
    scope.setExtra("requestId", context.requestId);
    Sentry.captureException(error);
  });
}

export async function flushObservability(timeout = 2_000) {
  if (!enabled) return true;
  return Sentry.flush(timeout);
}
