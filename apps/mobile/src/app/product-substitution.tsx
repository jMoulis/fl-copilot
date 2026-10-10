import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, TextInput, View, Switch, Alert } from "react-native";
import {
  router,
  useFocusEffect,
  useLocalSearchParams,
  type Href,
} from "expo-router";
import {
  digestStringAsync,
  CryptoDigestAlgorithm,
  randomUUID,
} from "expo-crypto";
import { prepareProductSubstitutionBatch } from "@fl-copilot/substitution-core";
import type { Product, NeedUnit } from "@fl-copilot/domain";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { ProductMasterRepository } from "@/products/product-master-repository";
import { NeedUnitRepository } from "@/needs/repository";
import {
  ProductSubstitutionRepository,
  type LocalProductSubstitution,
} from "@/needs/substitution-repository";
import { substitutionError } from "@/needs/substitution-presentation";
import {
  validateSubstitutionForm,
  substitutionFormValues,
  substitutionState,
  substitutionSyncState,
  substitutionIdentifierLabels,
  type SubstitutionFormValues,
} from "@/needs/substitution-details";
import {
  AppScreen,
  AppHeader,
  SectionCard,
  PrimaryButton,
  SecondaryButton,
  InlineAlert,
} from "@/components/ui";
const digest = (s: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, s);
const blank: SubstitutionFormValues = {
  need: "",
  usage: "",
  price: "",
  packaging: "",
};
export default function SubstitutionEditor() {
  const params = useLocalSearchParams<{ productId?: string; id?: string }>(),
    { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    { sqlite, deviceId } = useLocalDatabase(),
    { syncNow, status: syncStatus } = useSync();
  const repo = useMemo(
    () => new ProductSubstitutionRepository(sqlite, digest),
    [sqlite],
  );
  const scope = `${storeId}:${params.productId}:${params.id ?? "new"}`,
    initialized = useRef<string | undefined>(undefined),
    currentScope = useRef(scope);
  useEffect(() => {
    currentScope.current = scope;
    return () => {
      currentScope.current = "";
    };
  }, [scope]);
  const [formScope, setFormScope] = useState<string>(),
    [data, setData] = useState<{
      scope: string;
      products: Product[];
      needs: NeedUnit[];
      records: LocalProductSubstitution[];
      identifiers: Record<string, string>;
    }>(),
    [base, setBase] = useState<LocalProductSubstitution>(),
    [substituteId, setSubstituteId] = useState(""),
    [needId, setNeedId] = useState(""),
    [search, setSearch] = useState(""),
    [values, setValues] = useState<SubstitutionFormValues>(blank),
    [fieldErrors, setFieldErrors] = useState<
      Partial<Record<keyof SubstitutionFormValues, string>>
    >({}),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [message, setMessage] = useState<string>();
  const read = useCallback(async () => {
    if (!storeId) return undefined;
    const [p, n, records, ids] = await Promise.all([
      new ProductMasterRepository(sqlite).listProducts(storeId),
      new NeedUnitRepository(sqlite).list(storeId),
      repo.list(storeId),
      new ProductMasterRepository(sqlite).listIdentifiersByStore(storeId),
    ]);
    const identifiers = substitutionIdentifierLabels(ids.map((r) => r.entity));
    return {
      identifiers,
      scope,
      products: p.map((r) => r.entity),
      needs: n.map((r) => r.entity),
      records,
    };
  }, [repo, sqlite, storeId, scope]);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void read()
        .then((d) => {
          if (active && d) setData(d);
        })
        .catch(() => {
          if (active && syncStatus !== "syncing")
            setError("Les données locales ne peuvent pas être lues.");
        });
      return () => {
        active = false;
      };
    }, [read, syncStatus]),
  );
  const current = data?.scope === scope ? data : undefined,
    source = current?.products.find((p) => p.id === params.productId),
    record = current?.records.find((r) => r.entity.id === params.id);
  useEffect(() => {
    if (!current || initialized.current === scope) return;
    if (params.id && !record) return;
    initialized.current = scope;
    setFormScope(scope);
    setBase(record);
    setSubstituteId(record?.entity.substituteProductId ?? "");
    setNeedId(record?.entity.needUnitId ?? "");
    setValues(record ? substitutionFormValues(record.entity) : blank);
    setConfirmed(false);
    setFieldErrors({});
    setMessage(undefined);
    setError(undefined);
  }, [current, record, scope, params.id]);
  const validScope =
      formScope === scope &&
      !!storeId &&
      !!source &&
      (!params.id || (!!record && record.entity.sourceProductId === source.id)),
    conflict = record?.syncState === "CONFLICT";
  const changedWhileEditing =
    !!base && !!record && base.entity.version !== record.entity.version;
  const products =
    current?.products.filter(
      (p) =>
        p.id !== source?.id &&
        p.status === "ACTIVE" &&
        !p.deletedAt &&
        (p.label + " " + (current.identifiers[p.id] ?? ""))
          .toLocaleLowerCase("fr-FR")
          .includes(search.toLocaleLowerCase("fr-FR")),
    ) ?? [];
  function change(key: keyof SubstitutionFormValues, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    setConfirmed(false);
    setMessage(undefined);
    setFieldErrors((e) => ({ ...e, [key]: undefined }));
  }
  async function reload() {
    if (busy) return;
    try {
      const d = await read();
      if (d && currentScope.current === scope) {
        initialized.current = undefined;
        setData(d);
      }
    } catch {
      setError("Le rechargement a échoué. Votre brouillon reste disponible.");
    }
  }
  async function save(decision: "PROPOSE" | "VALIDATE" | "REJECT") {
    if (!validScope || !current || !source || !storeId || busy || conflict)
      return;
    if (decision === "VALIDATE" && !confirmed) return;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const latest = await read();
      if (currentScope.current !== scope) return;
      if (!latest) throw Error("Magasin indisponible.");
      const existing = params.id
        ? latest.records.find((r) => r.entity.id === params.id)
        : undefined;
      if (
        params.id &&
        (!existing ||
          !base ||
          existing.entity.id !== base.entity.id ||
          existing.entity.version !== base.entity.version ||
          existing.syncState === "CONFLICT")
      )
        throw Error(
          "Cette relation a changé. Rechargez-la ou comparez les versions avant de confirmer.",
        );
      if (!substituteId || !needId)
        throw Error("Choisissez un remplaçant et le besoin client concerné.");
      if (
        !params.id &&
        latest.records.some(
          (r) =>
            r.entity.sourceProductId === source.id &&
            r.entity.substituteProductId === substituteId &&
            r.entity.needUnitId === needId,
        )
      )
        throw Error(
          "Cette relation existe déjà, y compris si elle a été rejetée. Ouvrez-la depuis la fiche produit pour la revoir explicitement.",
        );
      const validated = validateSubstitutionForm(values);
      setFieldErrors(decision === "REJECT" ? {} : validated.errors);
      if (decision !== "REJECT" && Object.keys(validated.errors).length)
        throw Error("Corrigez les champs indiqués en rouge.");
      const c =
        decision === "REJECT" && existing
          ? {
              need: existing.entity.needCompatibility,
              usage: existing.entity.usageCompatibility,
              price: existing.entity.priceCompatibility,
              packaging: existing.entity.packagingCompatibility,
            }
          : validated.values;
      const result = await prepareProductSubstitutionBatch({
        request: {
          storeId,
          candidates: [
            {
              sourceProductId: source.id,
              substituteProductId: substituteId,
              needUnitId: needId,
              needCompatibility: c.need,
              usageCompatibility: c.usage,
              priceCompatibility: c.price,
              packagingCompatibility: c.packaging,
            },
          ],
        },
        products: latest.products,
        needs: latest.needs,
        existing: latest.records.map((r) => r.entity),
        expectedVersions: Object.fromEntries(
          latest.records
            .filter((r) => r.syncState === "ERROR")
            .map((r) => [r.entity.id, r.remoteVersion]),
        ),
        actor: "USER",
        decision,
        humanConfirmed: decision !== "PROPOSE",
        now: new Date().toISOString(),
        digest,
      });
      if (currentScope.current !== scope) return;
      await repo.saveBatch(result.prepared, {
        deviceId,
        commandIds: result.prepared.map(() => randomUUID()),
      });
      if (currentScope.current !== scope) return;
      const saved = result.prepared[0];
      setConfirmed(false);
      setMessage(
        saved
          ? "Relation enregistrée sur cet appareil. Synchronisation en arrière-plan."
          : "La relation est déjà identique.",
      );
      if (saved) router.replace(`/(tabs)/products/${source.id}` as Href);
      else {
        const d = await read();
        if (d) setData(d);
      }
      void syncNow(storeId).catch(() => undefined);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message.startsWith("PRODUCT_SUBSTITUTION")
            ? substitutionError(e.message)
            : e.message
          : "Enregistrement impossible.",
      );
    } finally {
      setBusy(false);
    }
  }
  const labels: Record<keyof SubstitutionFormValues, string> = {
    need: "Compatibilité avec le besoin (%)",
    usage: "Compatibilité d’usage (%)",
    price: "Compatibilité de prix déclarée (%) — facultatif",
    packaging: "Compatibilité de conditionnement (%) — facultatif",
  };
  return (
    <AppScreen>
      <AppHeader
        title={params.id ? "Revoir une substitution" : "Ajouter un remplaçant"}
        subtitle={source?.label ?? "Lecture des données locales…"}
      />
      <SecondaryButton
        label="Retour à la fiche produit"
        disabled={busy}
        onPress={() =>
          params.productId
            ? router.replace(`/(tabs)/products/${params.productId}` as Href)
            : router.back()
        }
      />
      {!validScope ? (
        <InlineAlert
          title="Relation indisponible"
          message="Ouvrez cet écran depuis une fiche produit du magasin actuel."
        />
      ) : (
        <>
          <SectionCard title="Sens de la relation">
            <Text className="text-ink">
              Le client voulait {source!.label} : quel produit peut répondre au
              même besoin ?
            </Text>
            <Text className="text-muted">
              {current!.identifiers[source!.id] ??
                "Aucun code enregistré pour le produit initial"}
            </Text>
            <Text className="text-muted">
              L’inverse n’est pas créé. Ces déclarations ne sont ni des ventes
              observées ni une action exécutée.
            </Text>
            {record ? (
              <Text className="text-muted">
                {substitutionState(record.entity)} ·{" "}
                {substitutionSyncState(record.syncState)}
              </Text>
            ) : null}
            {params.id ? (
              <>
                <Text className="font-semibold text-ink">
                  {current!.products.find((p) => p.id === substituteId)
                    ?.label ?? "Produit conservé"}
                </Text>
                <Text className="text-muted">
                  {current!.identifiers[substituteId] ??
                    "Aucun code enregistré pour le remplaçant"}
                </Text>
                <Text className="text-muted">
                  Besoin :{" "}
                  {current!.needs.find((n) => n.id === needId)?.name ??
                    "Besoin conservé"}
                </Text>
              </>
            ) : (
              <>
                <TextInput
                  accessibilityLabel="Rechercher un remplaçant"
                  placeholder="Nom, EAN ou code produit"
                  value={search}
                  onChangeText={setSearch}
                  editable={!busy}
                  className="rounded-xl border border-line p-3 text-ink"
                />
                {products.slice(0, 20).map((p) => (
                  <View
                    key={p.id}
                    className="flex-row items-center justify-between gap-2"
                  >
                    <View className="flex-1 gap-1">
                      <Text className="text-ink">{p.label}</Text>
                      <Text className="text-muted">
                        {current!.identifiers[p.id] ??
                          "Aucun code produit enregistré"}
                      </Text>
                    </View>
                    <Switch
                      accessibilityLabel={`Choisir ${p.label} ${current!.identifiers[p.id] ?? ""} comme remplaçant`}
                      disabled={busy}
                      value={substituteId === p.id}
                      onValueChange={(v) => {
                        setSubstituteId(v ? p.id : "");
                        setConfirmed(false);
                        setMessage(undefined);
                      }}
                    />
                  </View>
                ))}
                {products.length > 20 ? (
                  <Text className="text-muted">
                    20 produits affichés sur {products.length}. Précisez la
                    recherche pour trouver votre remplaçant.
                  </Text>
                ) : null}
                {substituteId ? (
                  <Text className="font-semibold text-ink">
                    Remplaçant choisi :{" "}
                    {current!.products.find((p) => p.id === substituteId)
                      ?.label ?? "Produit indisponible"}
                  </Text>
                ) : null}
                {!products.length ? (
                  <Text className="text-muted">
                    Aucun produit actif ne correspond à la recherche.
                  </Text>
                ) : null}
                <Text className="font-semibold text-ink">
                  Besoin client concerné
                </Text>
                {current!.needs
                  .filter((n) => n.status === "ACTIVE")
                  .map((n) => (
                    <View
                      key={n.id}
                      className="flex-row items-center justify-between gap-2"
                    >
                      <Text className="flex-1 text-ink">{n.name}</Text>
                      <Switch
                        accessibilityLabel={`Choisir le besoin ${n.name}`}
                        disabled={busy}
                        value={needId === n.id}
                        onValueChange={(v) => {
                          setNeedId(v ? n.id : "");
                          setConfirmed(false);
                          setMessage(undefined);
                        }}
                      />
                    </View>
                  ))}
                {!current!.needs.some((n) => n.status === "ACTIVE") ? (
                  <>
                    <Text className="text-muted">
                      Créez d’abord un besoin client actif.
                    </Text>
                    <SecondaryButton
                      label="Ouvrir les unités de besoin"
                      disabled={busy}
                      onPress={() => router.push("/need-units" as Href)}
                    />
                  </>
                ) : null}
              </>
            )}
          </SectionCard>
          {conflict ? (
            <>
              <InlineAlert
                title="Conflit à comparer"
                message="Votre version reste conservée. Choisissez une résolution dans Synchronisation."
              />
              <SecondaryButton
                label="Ouvrir Synchronisation"
                disabled={busy}
                onPress={() => router.push("/sync-center")}
              />
            </>
          ) : (
            <SectionCard title="Appréciation de la relation">
              {record?.syncState === "ERROR" ? (
                <InlineAlert
                  title="Synchronisation à reprendre"
                  message={substitutionError(record.lastErrorCode ?? undefined)}
                />
              ) : null}
              {changedWhileEditing ? (
                <InlineAlert
                  title="Relation modifiée"
                  message="Une nouvelle version est disponible. Votre brouillon est conservé ; rechargez avant de confirmer."
                />
              ) : null}
              {(["need", "usage", "price", "packaging"] as const).map((key) => (
                <View key={key} className="gap-1">
                  <Text className="text-ink">{labels[key]}</Text>
                  <TextInput
                    accessibilityLabel={labels[key]}
                    value={values[key]}
                    keyboardType="decimal-pad"
                    placeholder={
                      key === "price" || key === "packaging"
                        ? "Vide si indisponible"
                        : "0 à 100"
                    }
                    editable={!busy}
                    onChangeText={(v) => change(key, v)}
                    className={`rounded-xl border p-3 text-ink ${fieldErrors[key] ? "border-danger" : "border-line"}`}
                  />
                  {fieldErrors[key] ? (
                    <Text accessibilityRole="alert" className="text-danger">
                      {fieldErrors[key]}
                    </Text>
                  ) : null}
                </View>
              ))}
              <Text className="text-muted">
                Le prix et le conditionnement restent vides si vous ne pouvez
                pas les apprécier. Aucun prix, coût d’achat ou score appris
                n’est calculé ici. Ne comparez pas des €/kg et des €/pièce sans
                conversion fiable.
              </Text>
              <View className="flex-row items-center justify-between gap-2">
                <Text className="flex-1 text-ink">
                  Je confirme ce sens de remplacement et les compatibilités
                  déclarées.
                </Text>
                <Switch
                  accessibilityLabel="Confirmer la substitution déclarée"
                  disabled={busy || changedWhileEditing}
                  value={confirmed}
                  onValueChange={setConfirmed}
                />
              </View>
              <PrimaryButton
                label={
                  busy
                    ? "Enregistrement…"
                    : record?.entity.status === "REJECTED"
                      ? "Réactiver et valider explicitement"
                      : "Valider cette relation"
                }
                disabled={
                  busy ||
                  !confirmed ||
                  changedWhileEditing ||
                  !substituteId ||
                  !needId
                }
                onPress={() => void save("VALIDATE")}
              />
              {!record || record.entity.status === "PROPOSED" ? (
                <SecondaryButton
                  label="Conserver comme proposition à examiner"
                  disabled={
                    busy || changedWhileEditing || !substituteId || !needId
                  }
                  onPress={() => void save("PROPOSE")}
                />
              ) : null}
              {record && record.entity.status !== "REJECTED" ? (
                <SecondaryButton
                  label="Rejeter cette relation"
                  disabled={busy || changedWhileEditing}
                  onPress={() =>
                    Alert.alert(
                      "Rejeter cette substitution ?",
                      "La relation et son historique seront conservés. Une proposition IA ne la réactivera pas.",
                      [
                        { text: "Annuler", style: "cancel" },
                        {
                          text: "Rejeter",
                          style: "destructive",
                          onPress: () => void save("REJECT"),
                        },
                      ],
                    )
                  }
                />
              ) : null}
              {params.id ? (
                <SecondaryButton
                  label="Recharger la relation (remplace le brouillon)"
                  disabled={busy}
                  onPress={() =>
                    Alert.alert(
                      "Recharger la relation ?",
                      "Vos modifications non enregistrées seront remplacées par la version locale actuelle.",
                      [
                        { text: "Annuler", style: "cancel" },
                        { text: "Recharger", onPress: () => void reload() },
                      ],
                    )
                  }
                />
              ) : null}
            </SectionCard>
          )}
        </>
      )}
      {error ? (
        <InlineAlert title="Relation non enregistrée" message={error} />
      ) : null}
      {message ? (
        <Text accessibilityRole="alert" className="text-muted">
          {message}
        </Text>
      ) : null}
    </AppScreen>
  );
}
