import { randomUUID } from "node:crypto";
import type { NeedUnit } from "../packages/domain/src/index";
export function needUnitFixture(): NeedUnit {
  return {
    id: randomUUID(),
    storeId: randomUUID(),
    code: "APERITIF",
    name: "Apéritif",
    description: "Produits à partager pour l’apéritif",
    status: "ACTIVE",
    createdBy: "USER",
    version: 1,
    createdAt: "2026-10-09T08:00:00.000Z",
    updatedAt: "2026-10-09T08:00:00.000Z",
  };
}
