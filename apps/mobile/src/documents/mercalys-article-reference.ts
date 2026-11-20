import {
  type Product,
  type ProductIdentifier,
  type ProductMatchCatalog,
} from "@fl-copilot/domain";
import { ProductMasterRepository } from "../products/product-master-repository";
import { productMutationExpectedRemoteVersion } from "../products/product-editor-service";
import {
  joinedMutationDatabase,
  type AtomicMutationDatabase,
} from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { rematchMercalysImport } from "./mercalys-import-validation";
import type { MercalysImportValidationSummary } from "./mercalys-import-validation";
import {
  MercalysImportPublicationRepository,
  type PublishMercalysImportInput,
} from "./mercalys-import-publication";

export function isArticleReference(summary: MercalysImportValidationSummary) {
  return summary.parserVersion === "mercalys-article-reference.v1";
}
// Only the known zero-padding representation is equivalent, never arbitrary suffixes.
function canonicalItm(value: string) {
  return /^00000\d{8}$/.test(value) ? value.slice(5) : value;
}
function codes(
  record: MercalysImportValidationSummary["lines"][number]["record"],
) {
  const list: Pick<ProductIdentifier, "type" | "value">[] = [];
  if (record.itm8) {
    list.push({ type: "ITM8", value: record.itm8 });
    if (canonicalItm(record.itm8) !== record.itm8)
      list.push({ type: "ITM8", value: canonicalItm(record.itm8) });
  }
  if (record.ean) list.push({ type: "EAN", value: record.ean });
  return list;
}
function signature(catalog: ProductMatchCatalog) {
  return JSON.stringify({
    products: [...catalog.products].sort((a, b) => a.id.localeCompare(b.id)),
    identifiers: [...catalog.identifiers].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
  });
}
export type ArticleReferencePlan = {
  signature: string;
  products: Product[];
  identifiers: ProductIdentifier[];
  replacedIdentifierIds: string[];
  created: number;
  separated: number;
  retained: number;
  blocked: string[];
  summary: MercalysImportValidationSummary;
};

/** Read-only preview. New identities are fixed here and reused by the atomic commit. */
export function planArticleReference(
  summary: MercalysImportValidationSummary,
  catalog: ProductMatchCatalog & { conflictedProductIds?: readonly string[] },
  storeId: string,
  generateId: () => string,
  timestamp: string,
): ArticleReferencePlan {
  if (!isArticleReference(summary)) throw Error("ARTICLE_REFERENCE_REQUIRED");
  const plan: ArticleReferencePlan = {
    signature: signature(catalog),
    products: [],
    identifiers: [],
    replacedIdentifierIds: [],
    created: 0,
    separated: 0,
    retained: 0,
    blocked: [],
    summary,
  };
  const sourceOwners = new Map<string, Set<number>>();
  for (const line of summary.lines)
    for (const code of codes(line.record)) {
      const key = `${code.type}:${code.value}`;
      const owners = sourceOwners.get(key) ?? new Set<number>();
      owners.add(line.record.sourceIndex);
      sourceOwners.set(key, owners);
    }
  const blockedIndexes = new Set<number>();
  for (const line of summary.lines) {
    if (summary.publishedSourceIndexes?.includes(line.record.sourceIndex))
      continue;
    const block = () => {
      plan.blocked.push(line.record.rawLabel);
      blockedIndexes.add(line.record.sourceIndex);
    };
    const record = line.record,
      identifiers = codes(record);
    if (!record.itm8 || !record.ean || !record.purchasePrice?.reference) {
      block();
      continue;
    }
    if (
      identifiers.some(
        (c) => (sourceOwners.get(`${c.type}:${c.value}`)?.size ?? 0) > 1,
      )
    ) {
      block();
      continue;
    }
    const existing = catalog.identifiers.filter(
      (c) =>
        !c.deletedAt &&
        identifiers.some((i) => i.type === c.type && i.value === c.value),
    );
    const owners = [...new Set(existing.map((c) => c.productId))];
    const previousProducts = catalog.products.filter((p) =>
      owners.includes(p.id),
    );
    const old = owners.length === 1 ? previousProducts[0] : undefined;
    if (
      previousProducts.some(
        (p) =>
          p.status !== "ACTIVE" ||
          p.deletedAt ||
          catalog.conflictedProductIds?.includes(p.id),
      )
    ) {
      block();
      continue;
    }
    const otherItm =
      old &&
      catalog.identifiers.some(
        (i) =>
          i.productId === old.id &&
          !i.deletedAt &&
          i.type === "ITM8" &&
          canonicalItm(i.value) !== canonicalItm(record.itm8!),
      );
    const productId = old && !otherItm ? old.id : generateId();
    if (productId !== old?.id) {
      plan.created++;
      if (existing.length) plan.separated++;
      plan.products.push({
        id: productId,
        storeId,
        label: record.rawLabel,
        category:
          previousProducts.length &&
          new Set(previousProducts.map((p) => p.category)).size === 1
            ? previousProducts[0]!.category
            : "UNKNOWN",
        nature: "UNKNOWN",
        salesUnit: "UNKNOWN",
        packaging: null,
        familyId: null,
        subfamilyId: null,
        status: "ACTIVE",
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      });
    } else {
      plan.retained++;
      if (old && old.label !== record.rawLabel)
        plan.products.push({
          ...old,
          label: record.rawLabel,
          version: old.version + 1,
          updatedAt: timestamp,
        });
    }
    for (const code of identifiers) {
      const same = existing.find(
        (i) =>
          i.type === code.type &&
          i.value === code.value &&
          i.productId === productId,
      );
      if (same?.status === "VALIDATED") continue;
      const replaced = existing.filter(
        (i) =>
          i.type === code.type && i.value === code.value && i.id !== same?.id,
      );
      plan.replacedIdentifierIds.push(...replaced.map((i) => i.id));
      plan.identifiers.push({
        id: same?.id ?? generateId(),
        storeId,
        productId,
        ...code,
        source: "MERCALYS",
        status: "VALIDATED",
        version: (same?.version ?? 0) + 1,
        createdAt: same?.createdAt ?? timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      });
    }
  }
  const projected = {
    ...catalog,
    products: [
      ...catalog.products.filter(
        (p) => !plan.products.some((n) => n.id === p.id),
      ),
      ...plan.products,
    ],
    identifiers: [
      ...catalog.identifiers.filter(
        (i) =>
          !plan.replacedIdentifierIds.includes(i.id) &&
          !plan.identifiers.some((n) => n.id === i.id),
      ),
      ...plan.identifiers,
    ],
  };
  plan.summary = rematchMercalysImport(summary, storeId, projected);
  plan.summary.lines = plan.summary.lines.map((l) =>
    blockedIndexes.has(l.record.sourceIndex)
      ? { ...l, match: { ...l.match, state: "REVIEW", matchedProductId: null } }
      : l,
  );
  if (summary.publishedSourceIndexes?.length) {
    plan.summary.lines = plan.summary.lines.map((l) =>
      summary.publishedSourceIndexes!.includes(l.record.sourceIndex)
        ? summary.lines.find(
            (old) => old.record.sourceIndex === l.record.sourceIndex,
          )!
        : l,
    );
    plan.summary.publishedSourceIndexes = summary.publishedSourceIndexes;
    plan.summary.readyCount = plan.summary.lines.filter(
      (l) => l.match.state === "AUTO_MATCH",
    ).length;
    plan.summary.productReviewCount =
      plan.summary.lines.length - plan.summary.readyCount;
  }
  plan.summary.readyCount = plan.summary.lines.filter(
    (l) => l.match.state === "AUTO_MATCH",
  ).length;
  plan.summary.productReviewCount =
    plan.summary.lines.length - plan.summary.readyCount;
  return plan;
}

/** Catalogue writes, dated prices, immutable source and Outbox are one transaction. */
export async function publishArticleReference(
  database: OutboxDatabase & AtomicMutationDatabase,
  input: PublishMercalysImportInput,
  plan: ArticleReferencePlan,
  context: {
    deviceId: string;
    generateId(): string;
    now(): string;
    assertCurrentScope(): void;
    sourceDocumentId?: string;
  },
) {
  let result:
    | Awaited<ReturnType<MercalysImportPublicationRepository["publish"]>>
    | Awaited<ReturnType<MercalysImportPublicationRepository["resume"]>>
    | undefined;
  await database.withExclusiveTransactionAsync(async (tx) => {
    context.assertCurrentScope();
    if (plan.summary.errorCount) throw Error("ARTICLE_REFERENCE_INVALID");
    const joined = joinedMutationDatabase(tx),
      repo = new ProductMasterRepository(joined);
    const [products, identifiers] = await Promise.all([
      repo.listProducts(input.storeId),
      repo.listIdentifiersByStore(input.storeId),
    ]);
    if (
      signature({
        products: products.map((r) => r.entity),
        identifiers: identifiers.map((r) => r.entity),
        aliases: [],
      }) !== plan.signature
    )
      throw Error("ARTICLE_REFERENCE_PREVIEW_CHANGED");
    const latest = await tx.getFirstAsync<{ date: string | null }>(
      "SELECT MAX(business_period_start) date FROM source_documents WHERE store_id=? AND parser_version='mercalys-article-reference.v1' AND local_processing_status='PUBLISHED' AND deleted_at IS NULL",
      input.storeId,
    );
    if (
      latest?.date &&
      latest.date > input.summary.businessPeriodStart &&
      (plan.replacedIdentifierIds.length ||
        plan.products.some((p) =>
          products.some((old) => old.entity.id === p.id),
        ))
    )
      throw Error("ARTICLE_REFERENCE_OLDER_THAN_CURRENT");
    const involved = new Set([
      ...plan.summary.lines.flatMap((l) =>
        l.match.state === "AUTO_MATCH" && l.match.matchedProductId
          ? [l.match.matchedProductId]
          : [],
      ),
      ...plan.products.map((p) => p.id),
      ...plan.identifiers.map((i) => i.productId),
      ...identifiers
        .filter((i) => plan.replacedIdentifierIds.includes(i.entity.id))
        .map((i) => i.entity.productId),
    ]);
    const conflicts = await tx.getAllAsync<{
      entity_type: string;
      entity_id: string;
    }>(
      "SELECT entity_type,entity_id FROM sync_conflicts WHERE store_id=? AND status='OPEN'",
      input.storeId,
    );
    if (
      conflicts.some((c) =>
        c.entity_type === "product"
          ? involved.has(c.entity_id)
          : c.entity_type === "product_identifier" &&
            identifiers.some(
              (i) =>
                i.entity.id === c.entity_id && involved.has(i.entity.productId),
            ),
      )
    )
      throw Error("ARTICLE_REFERENCE_CONFLICT");
    for (const product of plan.products) {
      const existing = products.find((r) => r.entity.id === product.id);
      await repo.upsertProduct(product, {
        deviceId: context.deviceId,
        commandId: context.generateId(),
        expectedRemoteVersion: productMutationExpectedRemoteVersion(existing),
      });
    }
    for (const id of new Set(plan.replacedIdentifierIds)) {
      const old = identifiers.find((r) => r.entity.id === id)!;
      await repo.delete(
        "product_identifier",
        id,
        input.storeId,
        context.now(),
        {
          deviceId: context.deviceId,
          commandId: context.generateId(),
          expectedRemoteVersion: productMutationExpectedRemoteVersion(old),
        },
      );
    }
    for (const identifier of plan.identifiers) {
      const existing = identifiers.find((r) => r.entity.id === identifier.id);
      await repo.upsertIdentifier(identifier, {
        deviceId: context.deviceId,
        commandId: context.generateId(),
        expectedRemoteVersion: productMutationExpectedRemoteVersion(existing),
      });
    }
    const publication = new MercalysImportPublicationRepository(
      joined,
      context.generateId,
      context.now,
    );
    result = context.sourceDocumentId
      ? await publication.resume({
          storeId: input.storeId,
          sourceDocumentId: context.sourceDocumentId,
          checksum: input.checksum,
          summary: plan.summary,
        })
      : await publication.publish({ ...input, summary: plan.summary });
    context.assertCurrentScope();
  });
  return result!;
}
