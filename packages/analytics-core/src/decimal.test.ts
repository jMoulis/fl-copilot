import { describe, expect, it } from "vitest";
import {
  addDecimals,
  addMoney,
  divideDecimals,
  isDecimalString,
  multiplyDecimals,
  multiplyToMoney,
  normalizeDecimal,
  parseDecimal,
  serializeDecimal,
  subtractDecimals,
  toMoney,
} from "./decimal";

describe("canonical decimal utilities", () => {
  it.each(["0.580", "4.88", "172.45", "0", "-12.30"])(
    "round-trips %s without losing its decimal scale",
    (input) => {
      expect(serializeDecimal(parseDecimal(input))).toBe(input);
    },
  );

  it("rejects non-canonical or unsafe decimal forms", () => {
    for (const input of [
      "",
      "+1",
      "01.2",
      ".5",
      "1.",
      "1e3",
      "NaN",
      "Infinity",
      "-0",
      "-0.00",
    ]) {
      expect(isDecimalString(input)).toBe(false);
      expect(() => parseDecimal(input)).toThrow(
        "Invalid canonical decimal string",
      );
    }
  });

  it("normalizes scale only when explicitly requested", () => {
    expect(normalizeDecimal("0.580")).toBe("0.58");
    expect(normalizeDecimal("46.00")).toBe("46");
  });

  it("calculates exactly without binary floating-point drift", () => {
    expect(addDecimals(["0.1", "0.2"])).toBe("0.3");
    expect(addDecimals(["0.580", "4.88"])).toBe("5.460");
    expect(subtractDecimals("10.00", "4.88")).toBe("5.12");
    expect(multiplyDecimals("0.580", "4.88")).toBe("2.83040");
    expect(divideDecimals("1", "3", 4)).toBe("0.3333");
  });

  it("rejects division by zero", () => {
    expect(() => divideDecimals("1", "0", 2)).toThrow("Cannot divide by zero");
  });

  it("serializes EUR calculations at two decimals with half-up rounding", () => {
    expect(toMoney("46")).toEqual({ amount: "46.00", currency: "EUR" });
    expect(toMoney("4.885")).toEqual({ amount: "4.89", currency: "EUR" });
    expect(addMoney(["0.10", "0.20", "4.585"])).toEqual({
      amount: "4.89",
      currency: "EUR",
    });
    expect(multiplyToMoney("0.580", "4.88")).toEqual({
      amount: "2.83",
      currency: "EUR",
    });
  });
});
