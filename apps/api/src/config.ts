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
});
export type ApiConfig = Omit<
  z.infer<typeof environmentSchema>,
  "MONGODB_URI"
> & {
  MONGODB_URI: string;
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
  return {
    ...result.data,
    MONGODB_URI:
      result.data.MONGODB_URI ??
      "mongodb://127.0.0.1:27017/?directConnection=true",
  };
}
