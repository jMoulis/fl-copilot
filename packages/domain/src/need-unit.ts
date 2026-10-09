import { z } from "zod";
export function normalizeNeedUnitCode(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
    .replace(/_+$/, "");
}
export const needUnitSchema = z
  .object({
    id: z.string().uuid(),
    storeId: z.string().uuid(),
    code: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(
        /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/,
        "Utilisez des lettres majuscules, chiffres et traits bas.",
      ),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1200).nullable(),
    status: z.enum(["ACTIVE", "TO_REVIEW", "INACTIVE"]),
    createdBy: z.enum(["USER", "AI", "SYSTEM"]),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type NeedUnit = z.infer<typeof needUnitSchema>;
