# M3 shared analytics and Aujourd’hui

Date: 2026-10-04.

## Scope

The active increment starts with M3-T01 from `docs/specs/IMPLEMENTATION_PLAN.md`: canonical decimal parsing, serialization and deterministic arithmetic shared by the mobile and remote analytics runtimes.

## Implemented

- `@fl-copilot/analytics-core` owns the runtime-neutral decimal utilities and uses `decimal.js` with fixed precision, half-up rounding and non-exponential serialization.
- Canonical decimal input rejects exponent notation, leading plus signs, ambiguous leading zeroes, non-finite values and negative zero.
- Parsing records the source scale so a decimal such as `0.580` round-trips without becoming `0.58` unless normalization is explicitly requested.
- Addition and subtraction retain the maximum input scale; multiplication retains the combined scale; division requires an explicit output scale.
- EUR helpers serialize amounts with two decimal places and use deterministic half-up rounding for conversion, addition and quantity-by-unit-price multiplication.

## Verification evidence

| Check                 | Result                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Decimal round-trip    | `0.580`, `4.88`, `172.45`, zero and signed values retain their exact serialized scale                                     |
| Floating-point safety | `0.1 + 0.2` serializes as `0.3`                                                                                           |
| Exact arithmetic      | Addition, subtraction, multiplication and scale-bounded division pass unit coverage                                       |
| Money                 | EUR conversion, addition and quantity-by-unit-price multiplication serialize with two decimal places and half-up rounding |
| Invalid values        | Exponents, partial decimals, leading zeroes, non-finite values and negative zero fail closed                              |

## Next work

1. Complete the repository-wide validation for M3-T01 and merge it.
2. Implement M3-T02: the initial KPI registry, missing-versus-zero semantics and unit compatibility in `@fl-copilot/analytics-core`.
