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
