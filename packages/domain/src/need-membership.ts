import { z } from "zod";
const id = z.string().uuid(),
  timestamp = z.string().datetime();
export const needMembershipSchema = z
  .object({
    id,
    storeId: id,
    productId: id,
    needUnitId: id,
    strength: z.number().finite().min(0).max(1),
    primary: z.boolean(),
    source: z.enum(["MANUAL", "AI_PROPOSED", "LEARNED"]),
    confidence: z.number().finite().min(0).max(1),
    status: z.enum(["PROPOSED", "VALIDATED", "REJECTED"]),
    humanConfirmed: z.boolean(),
    version: z.number().int().positive(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict()
  .superRefine((m, c) => {
    if (m.status !== "PROPOSED" && !m.humanConfirmed)
      c.addIssue({
        code: "custom",
        path: ["humanConfirmed"],
        message: "Cette décision doit être confirmée explicitement.",
      });
  });
export type NeedMembership = z.infer<typeof needMembershipSchema>;
export async function needMembershipId(
  storeId: string,
  productId: string,
  needUnitId: string,
  digest: (text: string) => Promise<string>,
) {
  const raw = (
    await digest(
      JSON.stringify([
        "need-membership-v1",
        storeId.toLowerCase(),
        productId.toLowerCase(),
        needUnitId.toLowerCase(),
      ]),
    )
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(raw))
    throw Error("NEED_MEMBERSHIP_DIGEST_INVALID");
  const s = raw.slice(0, 32).split("");
  s[12] = "8";
  s[16] = (8 + (parseInt(s[16]!, 16) & 3)).toString(16);
  const h = s.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function sameMembershipIdentity(a: NeedMembership, b: NeedMembership) {
  return (
    a.id === b.id &&
    a.storeId === b.storeId &&
    a.productId === b.productId &&
    a.needUnitId === b.needUnitId
  );
}
export function sameMembershipValues(a: NeedMembership, b: NeedMembership) {
  return (
    sameMembershipIdentity(a, b) &&
    a.source === b.source &&
    a.strength === b.strength &&
    a.confidence === b.confidence &&
    a.primary === b.primary &&
    a.status === b.status &&
    a.humanConfirmed === b.humanConfirmed
  );
}
export const membershipBatchToolRequestSchema = z
  .object({
    storeId: id,
    candidates: z
      .array(
        z
          .object({
            productId: id,
            needUnitId: id,
            strength: z.number().finite().min(0).max(1),
            confidence: z.number().finite().min(0).max(1),
            primary: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
