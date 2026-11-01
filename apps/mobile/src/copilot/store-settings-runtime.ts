import {
  settingsSaveRequestSchema,
  settingsSaveAuthoritySchema,
  settingsSaveResultSchema,
  storeContextSettingsSchema,
  ProductClassificationError,
  type SettingsSaveAuthority,
} from "@fl-copilot/domain";
import { StoreContextRepository } from "../store/context-repository";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import {
  runReviewedStoreOperation,
  joinedProductToolDatabase,
} from "./product-tool-transaction";
/** Store context only; no geolocation, provider request or OS permission changes. */
export class CopilotStoreSettingsRuntime {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private generateId: () => string,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async execute(
    raw: unknown,
    rawAuthority: SettingsSaveAuthority,
    signal?: AbortSignal,
  ) {
    const parsed = settingsSaveRequestSchema.safeParse(raw),
      authority = settingsSaveAuthoritySchema.safeParse(rawAuthority);
    if (!parsed.success) throw new ProductClassificationError("INVALID_INPUT");
    if (!authority.success) throw new ProductClassificationError("FORBIDDEN");
    const request = parsed.data,
      { canManageStoreSettings, ...scope } = authority.data;
    return runReviewedStoreOperation(
      this.db,
      request,
      { ...scope, canExecute: canManageStoreSettings },
      settingsSaveResultSchema,
      async (tx, ctx) => {
        const repo = new StoreContextRepository(joinedProductToolDatabase(tx)),
          input = request.input,
          before = await repo.get(ctx.storeId);
        if (before && before.entity.storeId !== ctx.storeId)
          throw new ProductClassificationError("FORBIDDEN");
        if (before && ["ERROR", "CONFLICT"].includes(before.syncState))
          throw new ProductClassificationError("SYNC_CONFLICT");
        if ((before?.entity.version ?? null) !== input.expectedVersion)
          throw new ProductClassificationError("VERSION_CONFLICT");
        if (
          before?.entity.locationMode === "POINT" &&
          input.location === "KEEP" &&
          (before.entity.city !== input.city ||
            before.entity.postalCode !== input.postalCode)
        )
          throw new ProductClassificationError(
            "STORE_LOCATION_REVIEW_REQUIRED",
          );
        const locationMode =
            input.location === "CITY"
              ? ("CITY" as const)
              : (before?.entity.locationMode ?? ("CITY" as const)),
          position = locationMode === "POINT" ? before!.entity.position : null,
          appliedAt = this.now(),
          common = {
            operationId: request.operationId,
            schemaVersion: 1 as const,
            tool: request.tool,
            status: "COMPLETED" as const,
            userMessageId: ctx.userMessageId,
            appliedAt,
            before: before?.entity ?? null,
          };
        if (
          before &&
          before.entity.city === input.city &&
          before.entity.postalCode === input.postalCode &&
          before.entity.schoolZone === input.schoolZone &&
          before.entity.locationMode === locationMode
        )
          return {
            ...common,
            after: before.entity,
            commandId: null,
            syncState: before.syncState,
            message:
              "Cette configuration est déjà enregistrée. Aucun changement supplémentaire.",
          };
        const after = storeContextSettingsSchema.parse({
            id: ctx.storeId,
            storeId: ctx.storeId,
            city: input.city,
            postalCode: input.postalCode,
            country: "FR",
            timezone: "Europe/Paris",
            schoolZone: input.schoolZone,
            ...(before?.entity.merchandising !== undefined
              ? { merchandising: before.entity.merchandising }
              : {}),
            locationMode,
            position,
            version: (before?.entity.version ?? 0) + 1,
            createdAt: before?.entity.createdAt ?? appliedAt,
            updatedAt: appliedAt,
          }),
          commandId = this.generateId();
        await repo.save(after, { commandId, deviceId: ctx.deviceId });
        return {
          ...common,
          after,
          commandId,
          syncState: "PENDING" as const,
          message:
            "Configuration enregistrée localement. Le contexte météo/calendrier devra être actualisé pour ces paramètres ; aucune nouvelle position n’a été capturée.",
        };
      },
      signal,
    );
  }
}
