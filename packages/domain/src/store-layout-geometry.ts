import { z } from "zod";
const target = z.union([z.uuid(), z.literal("room")]);
export const storeLayoutGeometryIssueSchema = z.strictObject({
  code: z.enum([
    "INVENTORY_EMPTY",
    "MISSING_GEOMETRY",
    "REFERENCE_UNCONFIRMED",
    "OUT_OF_BOUNDS",
    "OUTSIDE_ASSEMBLY",
    "COLLISION",
    "VERTICAL_FIT_UNKNOWN",
    "CLEARANCE_EXCEEDED",
    "CLEARANCE_INCONSISTENT",
    "HOST_POSITION_UNCONFIRMED",
    "ENVELOPE_OVERLAP",
  ]),
  severity: z.enum(["BLOCKING", "MISSING", "NOTICE"]),
  targets: z.array(target).min(1).max(2),
  message: z.string().min(1).max(500),
});
/** Derived, bounded preflight. Not a persisted plan, allocation, load/stability or regulatory approval. */
export const storeLayoutGeometrySchema = z.strictObject({
  schemaVersion: z.literal(1),
  authority: z.literal("PROVISIONAL"),
  scope: z.literal("FOOTPRINTS_AND_CLEARANCE"),
  status: z.enum(["BLOCKED", "INCOMPLETE", "CHECKED"]),
  counts: z.strictObject({
    assemblies: z.number().int().min(0).max(32),
    fixed: z.number().int().min(0).max(128),
    tg: z.number().int().min(0).max(128),
    mobiles: z.number().int().min(0).max(128),
    furniture: z.number().int().min(0).max(128),
    located: z.number().int().min(0).max(128),
  }),
  footprints: z
    .array(
      z.strictObject({
        id: z.uuid(),
        kind: z.enum(["ASSEMBLY", "FIXED", "TG", "MOBILE"]),
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        width: z.number().int().positive(),
        depth: z.number().int().positive(),
      }),
    )
    .max(160),
  issues: z.array(storeLayoutGeometryIssueSchema).max(12000),
});
export type StoreLayoutGeometry = z.infer<typeof storeLayoutGeometrySchema>;
export type StoreLayoutGeometryIssue = z.infer<
  typeof storeLayoutGeometryIssueSchema
>;
