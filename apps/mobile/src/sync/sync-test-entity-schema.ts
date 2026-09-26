import { z } from "zod";

export const synchronizedTestEntitySchema = z.object({
  id: z.string().uuid(),
  storeId: z.string().uuid(),
  label: z.string().trim().min(1),
  remoteVersion: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
