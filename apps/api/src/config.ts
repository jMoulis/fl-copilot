import { z } from "zod";
const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
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
  AUTH_EMAIL_FROM: z.string().trim().email().optional(),
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
  const result = environmentSchema.safeParse(env);
  if (!result.success) {
    // Report names only: never print configuration values or credentials.
    throw new Error(
      `Invalid environment: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  }
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
    result.data.AUTH_DEVELOPMENT_CODE
  ) {
    throw new Error("Invalid environment: AUTH_DEVELOPMENT_CODE");
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
