import { expect, it } from "vitest";
import {
  localOperationFailureCode,
  localOperationFailureMessage,
} from "./local-operation-failure";

it.each([
  [
    {
      message:
        "FunctionCallException finalizeAsync → SQLiteErrorException: Error code 5: database is locked",
    },
    "LOCAL_DATABASE_BUSY",
  ],
  [{ code: 6 }, "LOCAL_DATABASE_BUSY"],
  [{ code: "SQLITE_BUSY_SNAPSHOT" }, "LOCAL_DATABASE_BUSY"],
  [{ cause: { code: 13 } }, "LOCAL_DATABASE_FULL"],
  [{ code: 11 }, "LOCAL_DATABASE_CORRUPT"],
  [{ code: "SQLITE_NOTADB" }, "LOCAL_DATABASE_CORRUPT"],
  [{ code: 266 }, "LOCAL_DATABASE_IO"],
  [
    { code: "ENOENT", message: "secret file:///private/customer.xlsx" },
    "LOCAL_FILE_MISSING",
  ],
  [
    { name: "ZodError", message: "private product payload" },
    "LOCAL_DATA_INVALID",
  ],
  [new SyntaxError("private source JSON"), "LOCAL_DATA_INVALID"],
] as const)(
  "classifies native storage failures without returning their payload: %s",
  (error, code) => {
    expect(localOperationFailureCode(error)).toBe(code);
    expect(localOperationFailureMessage(code)).toBeTruthy();
    expect(localOperationFailureMessage(code)).not.toMatch(
      /secret|customer|payload|file:\/\//,
    );
  },
);
it("leaves quota/network/unknown errors distinct from SQLite failures and bounds cyclic causes", () => {
  const cycle: { cause?: unknown } = {};
  cycle.cause = cycle;
  for (const reason of [
    cycle,
    null,
    "database is locked",
    { status: 429 },
    new Error("Inngest quota exceeded"),
  ])
    expect(localOperationFailureCode(reason)).toBeUndefined();
  expect(localOperationFailureMessage("UNKNOWN")).toBeUndefined();
});
