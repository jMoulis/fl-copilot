import { useAuth } from "@/auth/auth-provider";
import { ProductMasterRepository } from "@/products/product-master-repository";
import type { Product } from "@fl-copilot/domain";
import { useEffect, useMemo, useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import {
  digestStringAsync,
  CryptoDigestAlgorithm,
  randomUUID,
} from "expo-crypto";
import { commercialOfferChoiceSchema } from "@fl-copilot/sync-contracts";
import type { SyncConflict } from "@/sync/conflict-repository";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { SectionCard, SecondaryButton, InlineAlert } from "@/components/ui";
import {
  CommercialChoiceRepository,
  type LocalCommercialChoice,
} from "./offer-choice-repository";
import {
  commercialChoiceSummary,
  commercialChoiceError,
} from "./choice-presentation";
export function CommercialChoiceConflict({
  conflict,
}: {
  conflict: SyncConflict;
}) {
  const { session } = useAuth();
  const allowedStore = session?.stores[0]?.storeId === conflict.storeId;
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync();
  const repository = useMemo(
    () =>
      new CommercialChoiceRepository(sqlite, (text) =>
        digestStringAsync(CryptoDigestAlgorithm.SHA256, text),
      ),
    [sqlite],
  );
  const [products, setProducts] = useState<Product[]>([]);
  const [local, setLocal] = useState<LocalCommercialChoice | null>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  useEffect(() => {
    if (!allowedStore) return;
    let active = true;
    void new ProductMasterRepository(sqlite)
      .listProducts(conflict.storeId)
      .then((rows) => {
        if (active) setProducts(rows.map((r) => r.entity));
      })
      .catch(() => undefined);
    void repository
      .get(conflict.storeId, conflict.entityId)
      .then((row) => {
        if (active) setLocal(row);
      })
      .catch(() => {
        if (active) setError("Le choix local ne peut pas être lu.");
      });

    return () => {
      active = false;
    };
  }, [repository, conflict.storeId, conflict.entityId, sqlite, allowedStore]);
  const remote = commercialOfferChoiceSchema.safeParse(conflict.remotePayload);
  async function resolve(useLocal: boolean) {
    if (!allowedStore) return;
    setBusy(true);
    setError(undefined);
    try {
      await repository.resolve(conflict.id, useLocal, {
        commandId: randomUUID(),
        deviceId,
      });
      void syncNow(conflict.storeId).catch(() => undefined);
      router.back();
    } catch (reason) {
      setError(
        commercialChoiceError(
          reason instanceof Error ? reason.message : undefined,
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  if (!allowedStore)
    return (
      <InlineAlert
        title="Magasin différent"
        message="Ouvrez ce conflit depuis le magasin auquel ce choix appartient."
      />
    );
  return (
    <>
      <SectionCard title="Mon choix local actuel">
        <Text className="text-base text-ink">
          {local
            ? `${commercialChoiceSummary(local.entity)}\nProduit associé : ${products.find((p) => p.id === local.entity.productId)?.label ?? "Fiche indisponible"}`
            : "Lecture du choix local…"}
        </Text>
      </SectionCard>
      <SectionCard title="Choix synchronisé">
        <Text className="text-base text-ink">
          {remote.success
            ? `${commercialChoiceSummary(remote.data)}\nProduit associé : ${products.find((p) => p.id === remote.data.productId)?.label ?? "Fiche indisponible"}`
            : "Aucun choix distant disponible."}
        </Text>
      </SectionCard>
      {local &&
      remote.success &&
      local.entity.productId !== remote.data.productId ? (
        <>
          <InlineAlert
            title="Produits différents"
            message="Les deux choix désignent des fiches produit différentes. Consultez-les avant de décider."
          />
          <SecondaryButton
            label="Ouvrir mon produit associé"
            onPress={() =>
              local && router.push(`/products/${local.entity.productId}`)
            }
          />
          <SecondaryButton
            label="Ouvrir le produit du choix synchronisé"
            onPress={() =>
              remote.success &&
              router.push(`/products/${remote.data.productId}`)
            }
          />
        </>
      ) : null}
      <Text className="text-sm text-muted">
        Les deux versions et les modifications locales restent dans
        l’historique. Aucune n’est retenue automatiquement.
      </Text>
      {error ? (
        <InlineAlert title="Résolution impossible" message={error} />
      ) : null}
      <SecondaryButton
        label="Conserver mon choix local"
        disabled={busy || !local}
        onPress={() => void resolve(true)}
      />
      {remote.success ? (
        <SecondaryButton
          label="Adopter le choix synchronisé"
          disabled={busy || !local}
          onPress={() => void resolve(false)}
        />
      ) : null}
    </>
  );
}
