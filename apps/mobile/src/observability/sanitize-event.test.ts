import type { ErrorEvent } from "@sentry/react-native";
import { describe, expect, it } from "vitest";
import { sanitizeMobileEvent } from "./sanitize-event";

describe("mobile Sentry event sanitization", () => {
  it("removes identity, payloads, breadcrumb content and source context", () => {
    const event: ErrorEvent = {
      type: undefined,
      user: { email: "manager@example.com", ip_address: "192.0.2.1" },
      request: { data: { secret: true }, headers: { authorization: "token" } },
      extra: { document: "raw content" },
      breadcrumbs: [
        {
          category: "http",
          level: "info",
          message: "sensitive message",
          data: { url: "https://example.com/private" },
          timestamp: 1,
          type: "http",
        },
      ],
      exception: {
        values: [
          {
            type: "Error",
            value: "safe diagnostic",
            stacktrace: {
              frames: [
                {
                  filename: "src/example.ts",
                  lineno: 12,
                  pre_context: ["private before"],
                  context_line: "private current line",
                  post_context: ["private after"],
                },
              ],
            },
          },
        ],
      },
    };

    expect(sanitizeMobileEvent(event)).toMatchObject({
      breadcrumbs: [
        { category: "http", level: "info", timestamp: 1, type: "http" },
      ],
      exception: {
        values: [
          {
            stacktrace: {
              frames: [{ filename: "src/example.ts", lineno: 12 }],
            },
          },
        ],
      },
    });
    expect(event.user).toBeUndefined();
    expect(event.request).toBeUndefined();
    expect(event.extra).toBeUndefined();
    expect(event.breadcrumbs?.[0]).not.toHaveProperty("message");
    expect(event.breadcrumbs?.[0]).not.toHaveProperty("data");
    expect(
      event.exception?.values?.[0]?.stacktrace?.frames?.[0],
    ).not.toHaveProperty("context_line");
  });
});

it("removes exception/cause prose, frame variables and unknown tags while retaining diagnostic locations", () => {
  const event: ErrorEvent = {
    type: undefined,
    message: "private document",
    tags: { route: "root", arbitrary: "private product" },
    exception: {
      values: [
        {
          type: "TypeError",
          value: "private filename",
          mechanism: {
            type: "generic",
            handled: true,
            data: { sql: "private SQL" },
          },
          stacktrace: {
            frames: [
              {
                filename: "app.js",
                lineno: 42,
                colno: 3,
                vars: { source: "private source" },
              },
            ],
          },
        },
        { type: "private customer", value: "private cause" },
      ],
    },
    threads: {
      values: [
        {
          stacktrace: {
            frames: [
              {
                filename: "native.mm",
                lineno: 9,
                vars: { token: "private token" },
              },
            ],
          },
        },
      ],
    },
  };
  const sanitized = sanitizeMobileEvent(event);
  expect(JSON.stringify(sanitized)).not.toContain("private");
  expect(sanitized.tags).toEqual({
    route: "root",
    local_failure: "MOBILE_SCREEN_ERROR",
  });
  expect(sanitized.exception?.values?.[0]).toMatchObject({
    type: "TypeError",
    value: "MOBILE_SCREEN_ERROR",
    stacktrace: { frames: [{ filename: "app.js", lineno: 42, colno: 3 }] },
  });
  expect(sanitized.exception?.values?.[1]?.type).toBe("Error");
});

it("preserves only known local failure and phase tags, with automatic native failure classification", () => {
  expect(
    sanitizeMobileEvent({
      type: undefined,
      tags: {
        local_operation: "mercalys-publish",
        local_failure: "LOCAL_DATABASE_FULL",
        route: "private route",
      },
    }).tags,
  ).toEqual({
    local_operation: "mercalys-publish",
    local_failure: "LOCAL_DATABASE_FULL",
  });
  const native: ErrorEvent = {
    type: undefined,
    exception: {
      values: [
        {
          type: "Error",
          value:
            "SQLiteErrorException: Error code 5: database is locked private SQL",
        },
      ],
    },
  };
  expect(sanitizeMobileEvent(native).message).toBe("LOCAL_DATABASE_BUSY");
  expect(JSON.stringify(native)).not.toContain("private");
});
