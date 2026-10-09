import { useCallback, useMemo, useState } from "react";
import { Text, TextInput, View, Switch } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  digestStringAsync,
  CryptoDigestAlgorithm,
  randomUUID,
} from "expo-crypto";
import { prepareNeedMembershipBatch } from "@fl-copilot/substitution-core";
import type { NeedUnit, Product } from "@fl-copilot/domain";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { NeedUnitRepository } from "@/needs/repository";
import { NeedMembershipRepository } from "@/needs/membership-repository";
import {
  membershipSummary,
  membershipError,
} from "@/needs/membership-presentation";
import { ProductMasterRepository } from "@/products/product-master-repository";
import {
  AppScreen,
  AppHeader,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
  InlineAlert,
} from "@/components/ui";
const digest = (s: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, s);
function percent(s: string) {
  if (!/^\d+(?:[.,]\d+)?$/.test(s.trim()))
    throw Error("Saisissez un pourcentage explicite entre 0 et 100.");
  const n = Number(s.replace(",", "."));
  if (n < 0 || n > 100) throw Error("Saisissez un pourcentage entre 0 et 100.");
  return n / 100;
}
export default function MembershipEditor() {
  const params = useLocalSearchParams<{
      needUnitId?: string;
      productId?: string;
    }>(),
    { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync();
  const repo = useMemo(
    () => new NeedMembershipRepository(sqlite, digest),
    [sqlite],
  );
  const [products, setProducts] = useState<Product[]>([]),
    [needs, setNeeds] = useState<NeedUnit[]>([]),
    [records, setRecords] = useState<
      Awaited<ReturnType<NeedMembershipRepository["list"]>>
    >([]),
    [selected, setSelected] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [strength, setStrength] = useState(""),
    [confidence, setConfidence] = useState(""),
    [primary, setPrimary] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [message, setMessage] = useState<string>();
  const load = useCallback(async () => {
    if (!storeId) return;
    const [p, n, m] = await Promise.all([
      new ProductMasterRepository(sqlite).listProducts(storeId),
      new NeedUnitRepository(sqlite).list(storeId),
      repo.list(storeId),
    ]);
    setProducts(p.map((r) => r.entity));
    setNeeds(n.map((r) => r.entity));
    setRecords(m);
  }, [repo, sqlite, storeId]);
  useFocusEffect(
    useCallback(() => {
      void load().catch(() =>
        setError("Les données locales ne peuvent pas être chargées."),
      );
    }, [load]),
  );
  const fixedNeed = needs.find(
      (n) => n.id === params.needUnitId && n.storeId === storeId,
    ),
    fixedProduct = products.find(
      (p) => p.id === params.productId && p.storeId === storeId,
    ),
    validScope =
      !!storeId &&
      !!params.needUnitId !== !!params.productId &&
      !!(fixedNeed || fixedProduct);
  const targets = (
    fixedNeed
      ? products
          .filter((p) => p.status === "ACTIVE")
          .map((p) => ({ id: p.id, label: p.label }))
      : needs
          .filter((n) => n.status === "ACTIVE")
          .map((n) => ({ id: n.id, label: n.name }))
  ).filter((t) =>
    t.label
      .toLocaleLowerCase("fr-FR")
      .includes(search.toLocaleLowerCase("fr-FR")),
  );
  const current = records.filter(
    (r) =>
      r.entity.storeId === storeId &&
      (!params.needUnitId || r.entity.needUnitId === params.needUnitId) &&
      (!params.productId || r.entity.productId === params.productId),
  );
  async function save() {
    if (!storeId || !validScope || busy || !confirmed) return;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      if (!selected.length)
        throw Error("Choisissez au moins un produit ou un besoin.");
      const s = percent(strength),
        c = percent(confidence),
        existing = records.map((r) => r.entity),
        expected = Object.fromEntries(
          records
            .filter((r) => r.syncState === "ERROR")
            .map((r) => [r.entity.id, r.remoteVersion]),
        );
      const result = await prepareNeedMembershipBatch({
        request: {
          storeId,
          candidates: selected.map((id) => ({
            productId: fixedNeed ? id : fixedProduct!.id,
            needUnitId: fixedNeed ? fixedNeed.id : id,
            strength: s,
            confidence: c,
            primary,
          })),
        },
        products,
        needs,
        existing,
        expectedVersions: expected,
        actor: "USER",
        decision: "VALIDATE",
        humanConfirmed: confirmed,
        now: new Date().toISOString(),
        digest,
      });
      await repo.saveBatch(result.prepared, {
        deviceId,
        commandIds: result.prepared.map(() => randomUUID()),
      });
      await load();
      setSelected([]);
      setConfirmed(false);
      setMessage(
        `${result.prepared.length} association(s) enregistrée(s) localement${result.skipped.length ? ` · ${result.skipped.length} déjà identique(s)` : ""}.`,
      );
      void syncNow(storeId)
        .then(load)
        .catch(() => undefined);
    } catch (e) {
      setError(
        e instanceof Error && e.message.startsWith("NEED_MEMBERSHIP")
          ? membershipError(e.message)
          : e instanceof Error
            ? e.message
            : "Enregistrement impossible.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function reject(row: (typeof records)[number]) {
    if (busy || !storeId) return;
    setBusy(true);
    setError(undefined);
    try {
      await repo.save(
        {
          ...row.entity,
          status: "REJECTED",
          humanConfirmed: true,
          version:
            row.syncState === "ERROR"
              ? (row.remoteVersion ?? 0) + 1
              : row.entity.version + 1,
          updatedAt: new Date().toISOString(),
        },
        { deviceId, commandId: randomUUID() },
      );
      await load();
      void syncNow(storeId)
        .then(load)
        .catch(() => undefined);
    } catch (e) {
      setError(
        e instanceof Error ? membershipError(e.message) : "Retrait impossible.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <AppScreen>
      <AppHeader
        title="Associer produits et besoins"
        subtitle={
          fixedNeed?.name ??
          fixedProduct?.label ??
          "Lecture des données locales…"
        }
      />
      <SecondaryButton label="Retour" onPress={() => router.back()} />
      {!validScope ? (
        <InlineAlert
          title="Sélection indisponible"
          message="Ouvrez cet écran depuis un besoin ou un produit du magasin actuel."
        />
      ) : (
        <>
          <SectionCard title="Préparer une sélection">
            <Text className="text-muted">
              Choisissez plusieurs éléments puis confirmez leur association en
              une fois. Seuls les éléments cochés seront modifiés.
            </Text>
            <TextInput
              accessibilityLabel="Rechercher dans la sélection"
              placeholder="Rechercher"
              value={search}
              onChangeText={setSearch}
              editable={!busy}
              className="rounded-xl border border-line p-3 text-ink"
            />
            {targets.map((t) => (
              <View
                key={t.id}
                className="flex-row items-center justify-between gap-2"
              >
                <Text className="flex-1 text-ink">{t.label}</Text>
                <Switch
                  accessibilityLabel={`Choisir ${t.label}`}
                  value={selected.includes(t.id)}
                  disabled={busy}
                  onValueChange={(v) => {
                    if (v && selected.length >= 100) {
                      setError(
                        "Un lot peut contenir au maximum 100 associations. Réduisez la sélection.",
                      );
                      return;
                    }
                    setSelected((old) =>
                      v ? [...old, t.id] : old.filter((id) => id !== t.id),
                    );
                    setConfirmed(false);
                    setMessage(undefined);
                  }}
                />
              </View>
            ))}
            <Text className="text-muted">{selected.length} sélection(s)</Text>
          </SectionCard>
          <SectionCard title="Votre appréciation">
            <Text className="text-ink">Compatibilité avec le besoin (%)</Text>
            <TextInput
              accessibilityLabel="Compatibilité déclarée en pourcentage"
              placeholder="0 à 100"
              keyboardType="decimal-pad"
              value={strength}
              editable={!busy}
              onChangeText={(v) => {
                setStrength(v);
                setConfirmed(false);
              }}
              className="rounded-xl border border-line p-3 text-ink"
            />
            <Text className="text-ink">Certitude sur ce classement (%)</Text>
            <TextInput
              accessibilityLabel="Certitude déclarée en pourcentage"
              placeholder="0 à 100"
              keyboardType="decimal-pad"
              value={confidence}
              editable={!busy}
              onChangeText={(v) => {
                setConfidence(v);
                setConfirmed(false);
              }}
              className="rounded-xl border border-line p-3 text-ink"
            />
            <Text className="text-muted">
              Ces niveaux expriment votre appréciation pour la sélection. Ils ne
              mesurent pas un effet sur les ventes ou une preuve de
              substitution.
            </Text>
            <View className="flex-row items-center justify-between">
              <Text className="flex-1 text-ink">
                Marquer comme usage principal
              </Text>
              <Switch
                accessibilityLabel="Usage principal"
                value={primary}
                disabled={busy}
                onValueChange={(v) => {
                  setPrimary(v);
                  setConfirmed(false);
                }}
              />
            </View>
            <View className="flex-row items-center justify-between">
              <Text className="flex-1 text-ink">
                Je confirme que ces éléments répondent au besoin et que les
                niveaux choisis correspondent à mon appréciation.
              </Text>
              <Switch
                accessibilityLabel="Confirmer les associations sélectionnées"
                value={confirmed}
                disabled={busy}
                onValueChange={setConfirmed}
              />
            </View>
            <PrimaryButton
              label={
                busy
                  ? "Enregistrement…"
                  : `Enregistrer ${selected.length} association(s)`
              }
              disabled={busy || !confirmed || !selected.length}
              onPress={() => void save()}
            />
          </SectionCard>
          <SectionCard title="Associations enregistrées">
            {current.length ? (
              current.map((r) => (
                <View key={r.entity.id} className="gap-2">
                  <Text className="font-semibold text-ink">
                    {fixedNeed
                      ? (products.find((p) => p.id === r.entity.productId)
                          ?.label ?? "Produit conservé")
                      : (needs.find((n) => n.id === r.entity.needUnitId)
                          ?.name ?? "Besoin conservé")}
                  </Text>
                  <Text className="text-muted">
                    {membershipSummary(r.entity)} ·{" "}
                    {r.syncState === "SYNCED"
                      ? "Synchronisée"
                      : r.syncState === "CONFLICT"
                        ? "Conflit à comparer"
                        : r.syncState === "ERROR"
                          ? "Envoi à reprendre"
                          : "À synchroniser"}
                  </Text>
                  {r.syncState === "ERROR" ? (
                    <Text className="text-danger">
                      {membershipError(r.lastErrorCode ?? undefined)}
                    </Text>
                  ) : null}
                  {r.syncState === "CONFLICT" ? (
                    <SecondaryButton
                      label="Comparer dans Synchronisation"
                      onPress={() => router.push("/sync-center")}
                    />
                  ) : (
                    <SecondaryButton
                      label="Retirer / rejeter cette association"
                      disabled={busy || r.entity.status === "REJECTED"}
                      onPress={() => void reject(r)}
                    />
                  )}
                </View>
              ))
            ) : (
              <Text className="text-muted">
                Aucune association pour cette sélection.
              </Text>
            )}
          </SectionCard>
        </>
      )}
      {error ? (
        <InlineAlert title="Association impossible" message={error} />
      ) : null}
      {message ? <Text className="text-muted">{message}</Text> : null}
    </AppScreen>
  );
}
