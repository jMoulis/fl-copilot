import { randomUUID } from "node:crypto";
import {
  membershipFixture,
  membershipDigest,
} from "./test-membership-fixtures";
import {
  productSubstitutionId,
  type ProductSubstitution,
} from "../packages/domain/src/index";
export const substitutionDigest = membershipDigest;
export async function substitutionFixture() {
  const f = await membershipFixture(),
    substitute = { ...f.product, id: randomUUID(), label: "Tomate ronde" };
  const substitution: ProductSubstitution = {
    id: await productSubstitutionId(
      f.need.storeId,
      f.product.id,
      substitute.id,
      f.need.id,
      substitutionDigest,
    ),
    storeId: f.need.storeId,
    sourceProductId: f.product.id,
    substituteProductId: substitute.id,
    needUnitId: f.need.id,
    needCompatibility: 0.8,
    usageCompatibility: 0.7,
    priceCompatibility: null,
    packagingCompatibility: null,
    observedSubstitution: null,
    relationshipScore: null,
    confidence: null,
    evidenceCount: 0,
    lastEvidenceAt: null,
    source: "MANUAL",
    status: "VALIDATED",
    humanConfirmed: true,
    version: 1,
    createdAt: f.need.createdAt,
    updatedAt: f.need.updatedAt,
  };
  return { need: f.need, product: f.product, substitute, substitution };
}
