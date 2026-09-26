import type { ErrorEvent, Stacktrace } from "@sentry/react-native";

function removeSourceContext(stacktrace: Stacktrace | undefined) {
  for (const frame of stacktrace?.frames ?? []) {
    delete frame.pre_context;
    delete frame.context_line;
    delete frame.post_context;
  }
}

export function sanitizeMobileEvent(event: ErrorEvent) {
  // Preserve actionable stack locations while removing source text and identity.
  event.user = undefined;
  event.request = undefined;
  event.extra = undefined;

  for (const exception of event.exception?.values ?? []) {
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
