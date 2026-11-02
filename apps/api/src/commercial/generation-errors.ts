import {
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  APICallError,
} from "ai";
export class CommercialAiPermanentError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CommercialAiPermanentError";
  }
}
export function classifyCommercialGenerationError(error: unknown) {
  if (
    NoObjectGeneratedError.isInstance(error) &&
    error.finishReason === "length"
  )
    return new CommercialAiPermanentError("COMMERCIAL_AI_OUTPUT_TOKEN_LIMIT");
  if (
    NoObjectGeneratedError.isInstance(error) ||
    NoOutputGeneratedError.isInstance(error)
  )
    return new CommercialAiPermanentError("COMMERCIAL_AI_OUTPUT_INVALID");
  if (
    APICallError.isInstance(error) &&
    error.statusCode &&
    [400, 401, 402, 403, 404].includes(error.statusCode)
  )
    return new CommercialAiPermanentError(
      "COMMERCIAL_AI_CONFIGURATION_REQUIRED",
    );
  return null;
}
