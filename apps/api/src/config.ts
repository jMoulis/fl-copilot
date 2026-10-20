import { z } from "zod";
import { emailIntakeReceivingDomainSchema } from "@fl-copilot/sync-contracts";
const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  INNGEST_EVENT_KEY: z.string().trim().min(1).optional(),
  INNGEST_SIGNING_KEY: z.string().trim().min(1).optional(),
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().trim().min(1).optional(),
  SENTRY_TEST_ROUTE_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  MONGODB_URI: z
    .string()
    .regex(/^mongodb(?:\+srv)?:\/\//, "must be a MongoDB connection URI")
    .optional(),
  MONGODB_DATABASE: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .default("fl_copilot"),
  MONGODB_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  AUTH_TOKEN_SECRET: z.string().min(32).optional(),
  AUTH_CODE_PEPPER: z.string().min(32).optional(),
  AUTH_DEVELOPMENT_CODE: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  RESEND_API_KEY: z.string().trim().startsWith("re_").min(11).optional(),
  RESEND_RECEIVING_DOMAIN: emailIntakeReceivingDomainSchema.optional(),
  RESEND_RECEIVING_WEBHOOK_SECRET: z
    .string()
    .startsWith("whsec_")
    .min(20)
    .optional(),
  AUTH_EMAIL_FROM: z.string().trim().email().optional(),
  OPENAI_API_KEY: z.string().trim().startsWith("sk-").min(20).optional(),
  AI_GATEWAY_API_KEY: z.string().trim().min(20).optional(),
  VERCEL_OIDC_TOKEN: z.string().trim().min(20).optional(),
  COMMERCIAL_PDF_AI_MODEL: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+\/[a-zA-Z0-9._-]+$/)
    .default("openai/gpt-6.1-sol"),
  COPILOT_AI_MODEL: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/)
    .optional(),
  COPILOT_AI_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(180000)
    .default(90000),
  COPILOT_AI_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(128)
    .max(16000)
    .default(4000),
  COPILOT_AI_MAX_INPUT_BYTES: z.coerce
    .number()
    .int()
    .min(4096)
    .max(1048576)
    .default(524288),
  WASTE_RECEIPT_VISION_MODEL: z.string().trim().min(1).default("gpt-5.6-luna"),
  WASTE_RECEIPT_ARITHMETIC_TOLERANCE_EUR: z
    .string()
    .regex(/^\d+(?:\.\d{1,2})?$/)
    .default("0.01"),
  AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(3600)
    .default(900),
  AUTH_REFRESH_TOKEN_TTL_DAYS: z.coerce
    .number()
    .int()
    .min(1)
    .max(365)
    .default(30),
  AUTH_CHALLENGE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(1800)
    .default(600),
});
export type ApiConfig = Omit<
  z.infer<typeof environmentSchema>,
  "MONGODB_URI" | "AUTH_TOKEN_SECRET" | "AUTH_CODE_PEPPER"
> & {
  MONGODB_URI: string;
  AUTH_TOKEN_SECRET: string;
  AUTH_CODE_PEPPER: string;
};
export function parseEnvironment(
  env: Record<string, string | undefined>,
): ApiConfig {
  const result = environmentSchema.safeParse({
    ...env,
    NODE_ENV: env.VERCEL_ENV === "production" ? "production" : env.NODE_ENV,
  });
  if (!result.success) {
    // Report names only: never print configuration values or credentials.
    throw new Error(
      `Invalid environment: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  }
  if (
    (result.data.RESEND_RECEIVING_DOMAIN ||
      result.data.RESEND_RECEIVING_WEBHOOK_SECRET) &&
    (!result.data.RESEND_API_KEY ||
      !result.data.RESEND_RECEIVING_DOMAIN ||
      !result.data.RESEND_RECEIVING_WEBHOOK_SECRET)
  )
    throw new Error(
      "Invalid environment: RESEND_API_KEY, RESEND_RECEIVING_DOMAIN, RESEND_RECEIVING_WEBHOOK_SECRET",
    );
  if (result.data.NODE_ENV === "production" && !result.data.MONGODB_URI) {
    throw new Error("Invalid environment: MONGODB_URI");
  }
  if (
    result.data.NODE_ENV === "production" &&
    (!result.data.AUTH_TOKEN_SECRET || !result.data.AUTH_CODE_PEPPER)
  ) {
    throw new Error("Invalid environment: AUTH_TOKEN_SECRET, AUTH_CODE_PEPPER");
  }
  if (
    result.data.NODE_ENV === "production" &&
    (!result.data.RESEND_API_KEY || !result.data.AUTH_EMAIL_FROM)
  ) {
    throw new Error("Invalid environment: RESEND_API_KEY, AUTH_EMAIL_FROM");
  }
  if (
    result.data.NODE_ENV === "production" &&
    !result.data.OPENAI_API_KEY &&
    !result.data.AI_GATEWAY_API_KEY &&
    !result.data.VERCEL_OIDC_TOKEN &&
    env.VERCEL !== "1"
  ) {
    throw new Error(
      "Invalid environment: OPENAI_API_KEY, AI_GATEWAY_API_KEY, VERCEL_OIDC_TOKEN",
    );
  }
  if (
    result.data.NODE_ENV === "production" &&
    result.data.AUTH_DEVELOPMENT_CODE
  ) {
    throw new Error("Invalid environment: AUTH_DEVELOPMENT_CODE");
  }
  if (
    result.data.NODE_ENV === "production" &&
    result.data.SENTRY_TEST_ROUTE_ENABLED
  ) {
    throw new Error("Invalid environment: SENTRY_TEST_ROUTE_ENABLED");
  }
  return {
    ...result.data,
    MONGODB_URI:
      result.data.MONGODB_URI ??
      "mongodb://127.0.0.1:27017/?directConnection=true",
    AUTH_TOKEN_SECRET:
      result.data.AUTH_TOKEN_SECRET ??
      "local-access-token-secret-change-before-production",
    AUTH_CODE_PEPPER:
      result.data.AUTH_CODE_PEPPER ??
      "local-auth-code-pepper-change-before-production",
  };
}
