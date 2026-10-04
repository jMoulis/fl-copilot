import Decimal from "decimal.js";

const DECIMAL_STRING_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export const BusinessDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -1000,
  toExpPos: 1000,
});

export type DecimalString = string & {
  readonly __decimalString: unique symbol;
};
export type MoneyCurrency = "EUR";

export interface ParsedDecimal {
  readonly value: InstanceType<typeof BusinessDecimal>;
  readonly scale: number;
}

export interface Money {
  amount: DecimalString;
  currency: MoneyCurrency;
}

export function isDecimalString(value: string): value is DecimalString {
  return DECIMAL_STRING_PATTERN.test(value) && !isNegativeZero(value);
}

export function parseDecimal(value: string): ParsedDecimal {
  if (!isDecimalString(value)) {
    throw new Error(`Invalid canonical decimal string: ${value}`);
  }
  return {
    value: new BusinessDecimal(value),
    scale: decimalScale(value),
  };
}

export function serializeDecimal(decimal: ParsedDecimal): DecimalString;
export function serializeDecimal(
  decimal: InstanceType<typeof BusinessDecimal>,
  scale: number,
): DecimalString;
export function serializeDecimal(
  decimal: ParsedDecimal | InstanceType<typeof BusinessDecimal>,
  scale?: number,
): DecimalString {
  const resolvedScale = "scale" in decimal ? decimal.scale : scale;
  const value = "scale" in decimal ? decimal.value : decimal;
  if (
    resolvedScale === undefined ||
    !Number.isSafeInteger(resolvedScale) ||
    resolvedScale < 0
  ) {
    throw new Error(`Invalid decimal scale: ${String(resolvedScale)}`);
  }
  return value.toFixed(resolvedScale) as DecimalString;
}

export function normalizeDecimal(value: string): DecimalString {
  const parsed = parseDecimal(value);
  return parsed.value.toFixed() as DecimalString;
}

export function addDecimals(values: readonly string[]): DecimalString {
  const parsed = values.map(parseDecimal);
  const scale = parsed.reduce(
    (maximum, item) => Math.max(maximum, item.scale),
    0,
  );
  const total = parsed.reduce(
    (sum, item) => sum.plus(item.value),
    new BusinessDecimal(0),
  );
  return serializeDecimal(total, scale);
}

export function subtractDecimals(
  minuend: string,
  subtrahend: string,
): DecimalString {
  const left = parseDecimal(minuend);
  const right = parseDecimal(subtrahend);
  return serializeDecimal(
    left.value.minus(right.value),
    Math.max(left.scale, right.scale),
  );
}

export function multiplyDecimals(
  multiplicand: string,
  multiplier: string,
): DecimalString {
  const left = parseDecimal(multiplicand);
  const right = parseDecimal(multiplier);
  return serializeDecimal(
    left.value.times(right.value),
    left.scale + right.scale,
  );
}

export function divideDecimals(
  dividend: string,
  divisor: string,
  scale: number,
): DecimalString {
  const left = parseDecimal(dividend);
  const right = parseDecimal(divisor);
  if (right.value.isZero()) throw new Error("Cannot divide by zero.");
  return serializeDecimal(left.value.dividedBy(right.value), scale);
}

export function toMoney(
  amount: string,
  currency: MoneyCurrency = "EUR",
): Money {
  const parsed = parseDecimal(amount);
  return {
    amount: serializeDecimal(parsed.value, 2),
    currency,
  };
}

export function addMoney(amounts: readonly string[]): Money {
  const total = amounts
    .map(parseDecimal)
    .reduce((sum, item) => sum.plus(item.value), new BusinessDecimal(0));
  return { amount: serializeDecimal(total, 2), currency: "EUR" };
}

export function multiplyToMoney(quantity: string, unitAmount: string): Money {
  const product = parseDecimal(quantity).value.times(
    parseDecimal(unitAmount).value,
  );
  return { amount: serializeDecimal(product, 2), currency: "EUR" };
}

function decimalScale(value: string) {
  const decimalPoint = value.indexOf(".");
  return decimalPoint === -1 ? 0 : value.length - decimalPoint - 1;
}

function isNegativeZero(value: string) {
  return value.startsWith("-") && new BusinessDecimal(value).isZero();
}
