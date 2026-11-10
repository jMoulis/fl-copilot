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
let initialized = false;

const technicalCode = (value: unknown) =>
  typeof value === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(value)
    ? value
    : undefined;
const requestReference = (value: unknown) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
    ? value
    : undefined;
function removeFramePayload(stack: Sentry.Stacktrace | undefined) {
  for (const frame of stack?.frames ?? []) {
    delete frame.pre_context;
    delete frame.context_line;
    delete frame.post_context;
    delete frame.vars;
  }
}
/** Preserve technical locations and the generated reference, never thrown source prose. */
export function sanitizeApiEvent(event: Sentry.ErrorEvent) {
  const code = technicalCode(event.tags?.error_code) ?? "API_ERROR";
  const method = technicalCode(event.tags?.http_method);
  const reason = technicalCode(event.tags?.error_reason);
  const reference = requestReference(event.tags?.request_id);
  event.tags = { error_code: code };
  if (method) event.tags.http_method = method;
  if (reason) event.tags.error_reason = reason;
  if (reference) event.tags.request_id = reference;
  event.message = code;
  event.user = undefined;
  event.request = undefined;
  event.extra = undefined;
  event.server_name = undefined;
  for (const exception of event.exception?.values ?? []) {
    exception.value = code;
    if (
      ![
        "Error",
        "TypeError",
        "RangeError",
        "SyntaxError",
        "AggregateError",
        "ZodError",
        "MongoError",
        "MongoServerError",
        "AbortError",
      ].includes(exception.type ?? "")
    )
      exception.type = "Error";
    if (exception.mechanism) delete exception.mechanism.data;
    removeFramePayload(exception.stacktrace);
  }
  for (const thread of event.threads?.values ?? [])
    removeFramePayload(thread.stacktrace);
  event.breadcrumbs = event.breadcrumbs?.map(
    ({ category, level, timestamp, type }) => ({
      category,
      level,
      timestamp,
      type,
    }),
  );
  return event;
}

if (enabled) {
  try {
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
      beforeSend: sanitizeApiEvent,
    });
    initialized = true;
  } catch {
    /* An optional monitoring channel cannot prevent the API from starting. */
  }
}

type SafeLogAttributes = Record<string, boolean | number | string>;

export function logRemoteEvent(
  level: "error" | "info",
  message: string,
  attributes: SafeLogAttributes,
) {
  if (!initialized) return;
  try {
    Sentry.logger[level](message, attributes);
  } catch {
    /* Monitoring never changes the request's outcome. */
  }
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
  if (!initialized) return;
  try {
    Sentry.withScope((scope) => {
      scope.setTag("error_code", technicalCode(context.code) ?? "API_ERROR");
      scope.setTag("http_method", technicalCode(context.method) ?? "UNKNOWN");
      scope.setTag(
        "error_reason",
        context.reason ?? copilotStreamFailureReason(error),
      );
      const reference = requestReference(context.requestId);
      if (reference) scope.setTag("request_id", reference);
      Sentry.captureException(error);
    });
  } catch {
    /* Keep the original safe API response even when the SDK itself fails. */
  }
}

export async function flushObservability(timeout = 2_000) {
  if (!enabled) return true;
  if (!initialized) return false;
  try {
    return await Sentry.flush(timeout);
  } catch {
    return false;
  }
}
