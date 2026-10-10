import { useCallback, useMemo, useRef, useState } from "react";
import { Text, TextInput, View, Switch } from "react-native";
import { router, useFocusEffect, type Href } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { ProductMasterRepository } from "@/products/product-master-repository";
import {
  StoreProductEventRepository,
  type LocalStoreProductEvent,
} from "./store-event-repository";
import {
  storeEventSummary,
  storeEventError,
  storeEventSyncState,
} from "./store-event-presentation";

import { SectionCard, SecondaryButton, InlineAlert } from "@/components/ui";
export function StoreEventsView({
  productId,
  compact = false,
}: {
  productId?: string;
  compact?: boolean;
}) {
  const { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    { sqlite, deviceId } = useLocalDatabase(),
    { syncNow, status: syncStatus } = useSync(),
    repo = useMemo(() => new StoreProductEventRepository(sqlite), [sqlite]),
    scope = `${storeId}:${productId ?? "all"}`,
    busyRef = useRef(false);
  const [data, setData] = useState<{
      scope: string;
      rows: LocalStoreProductEvent[];
      labels: Record<string, string>;
    }>(),
    [closed, setClosed] = useState(false),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (storeId)
        void Promise.all([
          repo.list(storeId),
          new ProductMasterRepository(sqlite).listProducts(storeId),
        ])
          .then(([rows, products]) => {
            if (active) {
              setData({
                scope,
                rows: rows.filter(
                  (r) => !productId || r.entity.productId === productId,
                ),
                labels: Object.fromEntries(
                  products.map((r) => [r.entity.id, r.entity.label]),
                ),
              });
              setError(undefined);
            }
          })
          .catch(() => {
            if (active && syncStatus !== "syncing")
              setError("Les signalements locaux ne peuvent pas être lus.");
          });
      return () => {
        active = false;
      };
    }, [repo, sqlite, storeId, productId, scope, syncStatus]),
  );
  const current = data?.scope === scope ? data : undefined,
    all =
      current?.rows.filter(
        (r) =>
          (closed || r.entity.status !== "CLOSED") &&
          (current.labels[r.entity.productId] ?? "Produit conservé")
            .toLocaleLowerCase("fr-FR")
            .includes(search.toLocaleLowerCase("fr-FR")),
      ) ?? [],
    visible = compact ? all.slice(0, 3) : all;
  async function retry(row: LocalStoreProductEvent) {
    if (!storeId || row.entity.storeId !== storeId || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await repo.retry(storeId, row.entity.id, {
        commandId: randomUUID(),
        closeCommandId: randomUUID(),
        deviceId,
        capturedAt: new Date().toISOString(),
      });
      const rows = await repo.list(storeId);
      setData((old) =>
        old?.scope === scope
          ? {
              ...old,
              rows: rows.filter(
                (r) => !productId || r.entity.productId === productId,
              ),
            }
          : old,
      );
      void syncNow(storeId).catch(() => undefined);
    } catch (e) {
      setError(storeEventError(e instanceof Error ? e.message : undefined));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <SectionCard title="Signalements magasin">
      {!compact ? (
        <TextInput
          accessibilityLabel="Rechercher les signalements par produit"
          placeholder="Rechercher un produit"
          value={search}
          onChangeText={setSearch}
          className="rounded-xl border border-line p-3 text-ink"
        />
      ) : null}
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 text-ink">
          Afficher aussi les signalements terminés
        </Text>
        <Switch
          accessibilityLabel="Afficher les signalements terminés"
          value={closed}
          onValueChange={setClosed}
        />
      </View>
      {!current ? (
        <Text className="text-muted">Lecture des signalements locaux…</Text>
      ) : visible.length ? (
        visible.map((r) => (
          <View
            key={r.entity.id}
            className="gap-2 rounded-xl border border-line p-3"
          >
            <Text className="font-semibold text-ink">
              {current.labels[r.entity.productId] ?? "Produit conservé"}
            </Text>
            <Text className="text-muted">{storeEventSummary(r.entity)}</Text>
            <Text className="text-muted">
              {storeEventSyncState(r.syncState)}
            </Text>
            {r.syncState === "CONFLICT" ? (
              <SecondaryButton
                label="Comparer les versions"
                onPress={() => router.push("/sync-center")}
              />
            ) : (
              <>
                {r.syncState === "ERROR" ? (
                  <>
                    <InlineAlert
                      title="Synchronisation à reprendre"
                      message={storeEventError(r.lastErrorCode ?? undefined)}
                    />
                    <SecondaryButton
                      label="Reprendre l’envoi du signalement"
                      disabled={busy}
                      onPress={() => void retry(r)}
                    />
                  </>
                ) : null}
                {r.entity.status !== "CLOSED" && r.entity.source === "USER" ? (
                  <SecondaryButton
                    label={
                      r.entity.type === "OUT_OF_STOCK"
                        ? "Rupture terminée"
                        : "Clôturer ce signalement"
                    }
                    disabled={busy}
                    onPress={() =>
                      router.push({
                        pathname: "/store-event",
                        params: {
                          id: r.entity.id,
                          productId: r.entity.productId,
                        },
                      } as Href)
                    }
                  />
                ) : null}
              </>
            )}
          </View>
        ))
      ) : (
        <Text className="text-muted">
          {closed
            ? "Aucun signalement enregistré pour cette sélection."
            : "Aucun signalement en cours pour cette sélection."}
        </Text>
      )}
      {compact ? (
        <SecondaryButton
          label={`Voir l’historique${all.length > 3 ? ` (${all.length} dans cette sélection)` : ""}`}
          onPress={() =>
            router.push({
              pathname: "/store-events",
              params: { ...(productId ? { productId } : {}) },
            } as Href)
          }
        />
      ) : null}
      <Text className="text-muted">
        Une observation terrain ne modifie pas les ventes, la casse ou les
        scores de substitution.
      </Text>
      {error ? (
        <InlineAlert title="Signalements indisponibles" message={error} />
      ) : null}
    </SectionCard>
  );
}
