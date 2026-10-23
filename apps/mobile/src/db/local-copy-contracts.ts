import { z } from "zod";
import { databaseLocationSchema } from "./database-recovery";

export const recoveryOwnerSchema = z
  .object({
    version: z.literal(1),
    ownerId: z.uuid().nullable(),
    storeIds: z.array(z.uuid()).max(100),
  })
  .strict();
export type RecoveryOwner = z.infer<typeof recoveryOwnerSchema>;
export const copyFileSchema = z
  .object({
    name: z.enum(["fl-copilot.db", "fl-copilot.db-wal", "fl-copilot.db-shm"]),
    sizeBytes: z.number().int().nonnegative(),
    checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();
export const localCopyManifestSchema = z
  .object({
    version: z.literal(1),
    location: databaseLocationSchema,
    createdAt: z.iso.datetime(),
    files: z.array(copyFileSchema).min(1).max(3),
  })
  .strict()
  .refine(
    (v) =>
      v.files[0]?.name === "fl-copilot.db" &&
      new Set(v.files.map((f) => f.name)).size === v.files.length,
  );
export type LocalCopyRef = {
  kind: "backup" | "isolated" | "previous";
  id: string;
  createdAt: string;
  location: z.infer<typeof databaseLocationSchema>;
};
export const preparedLocalCopySchema = z
  .object({
    version: z.literal(1),
    previous: databaseLocationSchema,
    next: databaseLocationSchema,
    ownerId: z.uuid(),
    storeId: z.uuid(),
    deviceId: z.uuid(),
    pendingCount: z.number().int().nonnegative(),
    checksum: copyFileSchema.shape.checksum,
    sizeBytes: copyFileSchema.shape.sizeBytes,
  })
  .strict();
export type PreparedLocalCopy = z.infer<typeof preparedLocalCopySchema>;
export class LocalCopyError extends Error {
  constructor(readonly code: "OWNER" | "CHANGED" | "INVALID" | "UNAVAILABLE") {
    super(
      code === "OWNER"
        ? "Cette copie nécessite une reconnexion avec son compte d’origine et un accès au magasin."
        : code === "CHANGED"
          ? "La copie ou la session a changé. Relisez la liste avant de recommencer."
          : code === "INVALID"
            ? "Cette copie ne peut pas être reprise en sécurité. Elle reste conservée sur cet appareil."
            : "La copie locale n’a pas pu être préparée. Vérifiez l’espace disponible puis réessayez, sans supprimer l’application.",
    );
  }
}
