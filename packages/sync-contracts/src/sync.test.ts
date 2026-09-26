import { describe, expect, it } from "vitest";
import {
  syncCommandSchema as apiSyncCommandSchema,
  syncPushRequestSchema as apiSyncPushRequestSchema,
} from "../../../apps/api/src/sync/contracts";
import {
  syncCommandSchema as mobileSyncCommandSchema,
  syncPushRequestSchema as mobileSyncPushRequestSchema,
} from "../../../apps/mobile/src/sync/contracts";
import {
  MAX_SYNC_PULL_CHANGES,
  MAX_SYNC_PUSH_COMMANDS,
  bootstrapResponseSchema,
  syncChangeEnvelopeSchema,
  syncCommandResultSchema,
  syncCommandSchema,
  syncPullQuerySchema,
  syncPullResponseSchema,
  syncPushRequestSchema,
  syncPushResponseSchema,
} from "./sync";

const commandId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const storeId = "33333333-3333-4333-8333-333333333333";
const entityId = "44444444-4444-4444-8444-444444444444";
const timestamp = "2026-09-26T19:30:00.000Z";

const command = {
  commandId,
  localSequence: 1,
  type: "PRODUCT_UPSERT",
  entityType: "product",
  entityId,
  expectedRemoteVersion: null,
  createdAt: timestamp,
  payload: { name: "Tomate" },
};

const emptyBootstrapEntities = {
  products: [],
  productIdentifiers: [],
  productAliases: [],
  needUnits: [],
  needMemberships: [],
  productSubstitutions: [],
  salesObservations: [],
  wasteObservations: [],
  commercialOperations: [],
  offers: [],
  marketSignals: [],
  executionInstructions: [],
  storeEvents: [],
  productDailyPerformance: [],
  departmentDailyPerformance: [],
  recommendations: [],
  decisions: [],
  actionExecutions: [],
};

describe("shared synchronization contracts", () => {
  it("exposes the same schema instances to the API and mobile app", () => {
    expect(apiSyncCommandSchema).toBe(syncCommandSchema);
    expect(mobileSyncCommandSchema).toBe(syncCommandSchema);
    expect(apiSyncPushRequestSchema).toBe(syncPushRequestSchema);
    expect(mobileSyncPushRequestSchema).toBe(syncPushRequestSchema);
  });

  it("accepts a valid push request and enforces protocol and batch limits", () => {
    expect(
      syncPushRequestSchema.parse({
        syncProtocolVersion: 1,
        appVersion: "0.1.0",
        deviceId,
        storeId,
        commands: [command],
      }),
    ).toMatchObject({ commands: [{ commandId, localSequence: 1 }] });

    expect(
      syncPushRequestSchema.safeParse({
        syncProtocolVersion: 2,
        appVersion: "0.1.0",
        deviceId,
        storeId,
        commands: [],
      }).success,
    ).toBe(false);
    expect(
      syncPushRequestSchema.safeParse({
        syncProtocolVersion: 1,
        appVersion: "0.1.0",
        deviceId,
        storeId,
        commands: Array.from(
          { length: MAX_SYNC_PUSH_COMMANDS + 1 },
          (_, index) => ({ ...command, localSequence: index + 1 }),
        ),
      }).success,
    ).toBe(false);
  });

  it("validates every command result status and the push response", () => {
    const statuses = [
      "APPLIED",
      "ALREADY_APPLIED",
      "CONFLICT",
      "REJECTED",
      "RETRYABLE_ERROR",
    ] as const;
    const results = statuses.map((status) =>
      syncCommandResultSchema.parse({
        commandId,
        status,
        entityType: "product",
        entityId,
        remoteVersion: 2,
      }),
    );

    expect(
      syncPushResponseSchema.parse({ results, serverTime: timestamp }).results,
    ).toHaveLength(statuses.length);
  });

  it("validates pull changes and the complete bootstrap envelope", () => {
    expect(syncPullQuerySchema.parse({})).toEqual({
      limit: MAX_SYNC_PULL_CHANGES,
    });
    expect(syncPullQuerySchema.parse({ limit: "25" })).toEqual({ limit: 25 });
    expect(() =>
      syncPullQuerySchema.parse({ limit: MAX_SYNC_PULL_CHANGES + 1 }),
    ).toThrow();

    const change = syncChangeEnvelopeSchema.parse({
      sequence: "42",
      entityType: "product",
      entityId,
      operation: "UPSERT",
      entityVersion: 2,
      entity: { id: entityId, name: "Tomate" },
      changedAt: timestamp,
    });

    expect(
      syncPullResponseSchema.parse({
        changes: [change],
        nextCursor: "opaque-cursor",
        hasMore: false,
        serverTime: timestamp,
      }).changes,
    ).toEqual([change]);

    expect(
      bootstrapResponseSchema.parse({
        protocolVersion: 1,
        store: { id: storeId, name: "Magasin pilote" },
        snapshotRevision: "revision-1",
        cursor: "opaque-cursor",
        historyPolicy: { rawObservationDays: 90 },
        entities: emptyBootstrapEntities,
        serverTime: timestamp,
      }).entities,
    ).toEqual(emptyBootstrapEntities);
  });
});
