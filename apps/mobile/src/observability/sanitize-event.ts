import type { ErrorEvent, Stacktrace } from "@sentry/react-native";
import { localOperationFailureCode } from "./local-operation-failure";

const localFailureCodes = new Set([
  "LOCAL_DATABASE_BUSY",
  "LOCAL_DATABASE_FULL",
  "LOCAL_DATABASE_CORRUPT",
  "LOCAL_DATABASE_IO",
  "LOCAL_FILE_MISSING",
  "LOCAL_DATA_INVALID",
  "LOCAL_OPERATION_FAILED",
]);

function removeSourceContext(stacktrace: Stacktrace | undefined) {
  for (const frame of stacktrace?.frames ?? []) {
    delete frame.pre_context;
    delete frame.context_line;
    delete frame.post_context;
    delete frame.vars;
  }
}

export function sanitizeMobileEvent(event: ErrorEvent) {
  const taggedCode = event.tags?.local_failure;
  const code =
    typeof taggedCode === "string" && localFailureCodes.has(taggedCode)
      ? taggedCode
      : (event.exception?.values
          ?.map(({ type, value }) =>
            localOperationFailureCode({ name: type, message: value }),
          )
          .find(Boolean) ?? "MOBILE_SCREEN_ERROR");
  const route = event.tags?.route;
  const phase = event.tags?.local_operation;
  event.tags = { local_failure: code };
  if (route === "root" || route === "commercial-review")
    event.tags.route = route;
  if (
    typeof phase === "string" &&
    [
      "mercalys-prepare",
      "mercalys-publish",
      "mercalys-repair",
      "synchronization",
    ].includes(phase)
  )
    event.tags.local_operation = phase;
  event.message = code;
  // Preserve actionable stack locations while removing source text and identity.
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
        "AbortError",
      ].includes(exception.type ?? "")
    )
      exception.type = "Error";
    if (exception.mechanism) delete exception.mechanism.data;
    removeSourceContext(exception.stacktrace);
  }
  for (const thread of event.threads?.values ?? []) {
    removeSourceContext(thread.stacktrace);
  }

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
