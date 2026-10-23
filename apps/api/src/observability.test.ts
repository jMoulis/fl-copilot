import { expect, it } from "vitest";
import { MongoError } from "mongodb";
import { z } from "zod";
import { copilotStreamFailureReason } from "./observability";

it.each([
  [new Error("ANSWER_TEXT_TOO_LARGE"), "ANSWER_TEXT_TOO_LARGE"],
  [new Error("COPILOT_REPLY_COMMIT_FAILED"), "COPILOT_REPLY_COMMIT_FAILED"],
  [new MongoError("private database details"), "DATABASE"],
  [z.string().safeParse({ private: "content" }).error!, "VALIDATION"],
  [new TypeError("private content"), "TYPE_ERROR"],
  [new RangeError("private content"), "RANGE_ERROR"],
  [new Error("ANSWER_TEXT_TOO_LARGE: private content"), "UNEXPECTED"],
  [{ name: "ZodError", message: "private content" }, "UNEXPECTED"],
  ["private provider body", "UNEXPECTED"],
  [null, "UNEXPECTED"],
])(
  "classifies only a fixed technical reason without retaining thrown content (%#)",
  (error, expected) => {
    expect(copilotStreamFailureReason(error)).toBe(expected);
  },
);
