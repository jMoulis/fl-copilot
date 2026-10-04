import {
  buildDepartmentDailyPerformance,
  buildProductDailyPerformance,
  serializeDepartmentDailyPerformance,
  serializeProductDailyPerformance,
  type DepartmentDailyPerformance,
  type ProductDailyPerformance,
} from "@fl-copilot/analytics-core";
import { productDailyGoldenFixture } from "@fl-copilot/test-fixtures";
import { describe, expect, it } from "vitest";
import {
  RemoteAnalyticsConfirmationService,
  type RemoteAnalyticsRepository,
  type RemoteProductDateScope,
} from "../src/analytics/remote-confirmation.js";

const fixedNow = productDailyGoldenFixture.computedAt;
const storeId = productDailyGoldenFixture.product.storeId;
const productId = productDailyGoldenFixture.product.id;
const businessDate = productDailyGoldenFixture.businessDate;

class MemoryRemoteAnalyticsRepository implements RemoteAnalyticsRepository {
  readonly savedProducts = new Map<string, ProductDailyPerformance>();
  readonly savedDepartments = new Map<string, DepartmentDailyPerformance>();
  loadCount = 0;

  async loadProductDay(
    requestedStoreId: string,
    scope: RemoteProductDateScope,
  ) {
    this.loadCount += 1;
    if (
      requestedStoreId !== storeId ||
      scope.productId !== productId ||
      scope.businessDate !== businessDate
    ) {
      throw new Error("REMOTE_ANALYTICS_FIXTURE_NOT_FOUND");
    }
    return {
      product: productDailyGoldenFixture.product,
      salesObservations: productDailyGoldenFixture.salesObservations,
      wasteObservations: productDailyGoldenFixture.wasteObservations,
      commercialOperationIds: productDailyGoldenFixture.commercialOperationIds,
      merchandisingPlanIds: productDailyGoldenFixture.merchandisingPlanIds,
      contextEventIds: productDailyGoldenFixture.contextEventIds,
      marketSignalIds: productDailyGoldenFixture.marketSignalIds,
      storeProductEventIds: productDailyGoldenFixture.storeProductEventIds,
      weatherRecordId: productDailyGoldenFixture.weatherRecordId,
    };
  }

  async saveProductDay(performance: ProductDailyPerformance) {
    this.savedProducts.set(
      `${performance.productId}:${performance.date}`,
      performance,
    );
  }

  async loadProductDays(requestedStoreId: string, requestedDate: string) {
    return [...this.savedProducts.values()].filter(
      (performance) =>
        performance.storeId === requestedStoreId &&
        performance.date === requestedDate,
    );
  }

  async saveDepartmentDay(performance: DepartmentDailyPerformance) {
    this.savedDepartments.set(performance.date, performance);
  }
}

describe("remote analytics confirmation", () => {
  it("serializes exactly like the mobile-compatible analytics core", async () => {
    const repository = new MemoryRemoteAnalyticsRepository();
    const service = new RemoteAnalyticsConfirmationService(
      repository,
      () => fixedNow,
    );

    const confirmation = await service.confirm(storeId, [
      { productId, businessDate },
      { productId, businessDate },
    ]);
    const localProduct = buildProductDailyPerformance(
      productDailyGoldenFixture,
    );
    const localDepartment = buildDepartmentDailyPerformance({
      storeId,
      businessDate,
      productPerformances: [localProduct],
      computedAt: fixedNow,
    });

    expect(repository.loadCount).toBe(1);
    expect(confirmation.products).toHaveLength(1);
    expect(confirmation.departments).toHaveLength(1);
    expect(serializeProductDailyPerformance(confirmation.products[0]!)).toBe(
      serializeProductDailyPerformance(localProduct),
    );
    expect(
      serializeDepartmentDailyPerformance(confirmation.departments[0]!),
    ).toBe(serializeDepartmentDailyPerformance(localDepartment));
  });

  it("rejects an empty or malformed confirmation perimeter", async () => {
    const service = new RemoteAnalyticsConfirmationService(
      new MemoryRemoteAnalyticsRepository(),
      () => fixedNow,
    );

    await expect(service.confirm(storeId, [])).rejects.toThrow(
      "At least one product/date scope is required.",
    );
    await expect(
      service.confirm(storeId, [{ productId, businessDate: "26/09/2026" }]),
    ).rejects.toThrow("Invalid remote analytics scope.");
  });
});
