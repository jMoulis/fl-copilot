import * as Sentry from "@sentry/node";
import { MongoError } from "mongodb";
import { ZodError } from "zod";

const copilotFailureReasons = [
  "ANSWER_TEXT_TOO_LARGE",
  "INVALID_ANSWER_TEMPLATE",
  "AMBIGUOUS_ANSWER_EVIDENCE",
  "UNKNOWN_ANSWER_EVIDENCE",
  "COPILOT_REPLY_SCOPE_INVALID",
  "COPILOT_REPLY_CONTEXT_INVALID",
  "COPILOT_REPLY_EVIDENCE_INVALID",
  "COPILOT_REPLY_COMMIT_FAILED",
  "COPILOT_FACT_CONTEXT_TRANSACTION_REQUIRED",
  "COPILOT_FACT_CONTEXT_SOURCE_INVALID",
  "COPILOT_FACT_CONTEXT_IDENTITY_CONFLICT",
] as const;
type CopilotFailureReason =
  | (typeof copilotFailureReasons)[number]
  | "VALIDATION"
  | "DATABASE"
  | "TYPE_ERROR"
  | "RANGE_ERROR"
  | "UNEXPECTED";

/** Never log a thrown message, schema input/path, database detail or provider body. */
export function copilotStreamFailureReason(
  error: unknown,
): CopilotFailureReason {
  if (error instanceof ZodError) return "VALIDATION";
  if (error instanceof MongoError) return "DATABASE";
  if (error instanceof TypeError) return "TYPE_ERROR";
  if (error instanceof RangeError) return "RANGE_ERROR";
  return (
    copilotFailureReasons.find(
      (reason) => error instanceof Error && error.message === reason,
    ) ?? "UNEXPECTED"
  );
}

const dsn = process.env.SENTRY_DSN?.trim();
const enabled = Boolean(dsn);

if (enabled) {
  Sentry.init({
    dsn,
    environment:
      process.env.VERCEL_ENV ??
      process.env.SENTRY_ENVIRONMENT ??
      process.env.NODE_ENV,
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
  context: {
    code: string;
    method: string;
    requestId: string;
    reason?: CopilotFailureReason;
  },
) {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    scope.setTag("error_code", context.code);
    scope.setTag("http_method", context.method);
    if (context.reason) scope.setTag("error_reason", context.reason);
    scope.setExtra("requestId", context.requestId);
    Sentry.captureException(error);
  });
}

export async function flushObservability(timeout = 2_000) {
  if (!enabled) return true;
  return Sentry.flush(timeout);
}
