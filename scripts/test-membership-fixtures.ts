import { randomUUID, createHash } from "node:crypto";
import { needUnitFixture } from "./test-need-unit-fixtures";
import {
  needMembershipId,
  type NeedMembership,
} from "../packages/domain/src/index";
export const membershipDigest = async (s: string) =>
  createHash("sha256").update(s).digest("hex");
export async function membershipFixture() {
  const need = needUnitFixture(),
    product = {
      id: randomUUID(),
      storeId: need.storeId,
      label: "Tomate cerise",
      category: "UNKNOWN" as const,
      nature: "UNKNOWN" as const,
      salesUnit: "UNKNOWN" as const,
      status: "ACTIVE" as const,
      version: 1,
      createdAt: need.createdAt,
      updatedAt: need.updatedAt,
      deletedAt: null,
    };
  const membership: NeedMembership = {
    id: await needMembershipId(
      need.storeId,
      product.id,
      need.id,
      membershipDigest,
    ),
    storeId: need.storeId,
    productId: product.id,
    needUnitId: need.id,
    strength: 0.8,
    confidence: 0.6,
    primary: false,
    source: "MANUAL",
    status: "VALIDATED",
    humanConfirmed: true,
    version: 1,
    createdAt: need.createdAt,
    updatedAt: need.updatedAt,
  };
  return { need, product, membership };
}
