import { EvidenceView } from "@/needs/evidence-view";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, TextInput, View, Switch } from "react-native";
import {
  router,
  useFocusEffect,
  useLocalSearchParams,
  type Href,
} from "expo-router";
import { randomUUID } from "expo-crypto";
import {
  storeEventLabels,
  storeEventTimeParts,
  selectStoreEventTime,
  createStoreEventPayloadSchema,
  type StoreProductEvent,
  type Product,
} from "@fl-copilot/domain";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { ProductMasterRepository } from "@/products/product-master-repository";
import {
  StoreProductEventRepository,
  type LocalStoreProductEvent,
} from "@/needs/store-event-repository";
import {
  StoreEventTimeField,
  type StoreEventTimeInput,
} from "@/needs/store-event-time-field";
import {
  storeEventError,
  storeEventSummary,
} from "@/needs/store-event-presentation";
import { substitutionIdentifierLabels } from "@/needs/substitution-details";
import {
  AppScreen,
  AppHeader,
  SectionCard,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui";
function nowInput(): StoreEventTimeInput {
  const instant = new Date(
    Math.floor(Date.now() / 60000) * 60000,
  ).toISOString();
  return { ...storeEventTimeParts(instant), occurrence: instant };
}
export default function StoreEventEditor() {
  const params = useLocalSearchParams<{ productId?: string; id?: string }>(),
    { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    { sqlite, deviceId } = useLocalDatabase(),
    { syncNow, status: syncStatus } = useSync(),
    repo = useMemo(() => new StoreProductEventRepository(sqlite), [sqlite]);
  const scope = `${storeId}:${params.productId ?? "select"}:${params.id ?? "new"}`,
    currentScope = useRef(scope),
    busyRef = useRef(false);
  useEffect(() => {
    currentScope.current = scope;
    return () => {
      currentScope.current = "";
    };
  }, [scope]);
  const [data, setData] = useState<{
      scope: string;
      products: Product[];
      identifiers: Record<string, string>;
      record: LocalStoreProductEvent | null;
    }>(),
    [formScope, setFormScope] = useState<string>(),
    [eventId, setEventId] = useState(() => randomUUID()),
    [productId, setProductId] = useState(params.productId ?? ""),
    [search, setSearch] = useState(""),
    [type, setType] = useState<StoreProductEvent["type"]>(),
    [severity, setSeverity] = useState<StoreProductEvent["severity"]>(null),
    [comment, setComment] = useState(""),
    [start, setStart] = useState<StoreEventTimeInput>(nowInput),
    [end, setEnd] = useState<StoreEventTimeInput>(nowInput),
    [finished, setFinished] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [issues, setIssues] = useState<{
      product?: string;
      type?: string;
      start?: string;
      end?: string;
    }>({});
  const read = useCallback(async () => {
    if (!storeId) return;
    const products = new ProductMasterRepository(sqlite);
    const [p, ids, record] = await Promise.all([
      products.listProducts(storeId),
      products.listIdentifiersByStore(storeId),
      params.id ? repo.get(storeId, params.id) : Promise.resolve(null),
    ]);
    return {
      scope,
      products: p.map((r) => r.entity),
      identifiers: substitutionIdentifierLabels(ids.map((r) => r.entity)),
      record,
    };
  }, [sqlite, repo, storeId, scope, params.id]);
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
    record = current?.record,
    source = current?.products.find(
      (p) => p.id === (record?.entity.productId ?? productId),
    );
  useEffect(() => {
    if (!current || formScope === scope) return;
    setFormScope(scope);
    setEventId(randomUUID());
    setProductId(params.productId ?? "");
    setType(undefined);
    setSeverity(null);
    setComment("");
    setStart(nowInput());
    setEnd(nowInput());
    setFinished(false);
    setIssues({});
    setError(undefined);
  }, [current, formScope, scope, params.productId]);
  function clear() {
    setIssues({});
    setError(undefined);
  }
  async function save() {
    if (busyRef.current || !storeId || !current || formScope !== scope) return;
    const problems: typeof issues = {};
    if (!params.id && !source)
      problems.product = "Choisissez le produit concerné.";
    if (!params.id && !type)
      problems.type = "Choisissez le type de signalement.";
    let startedAt: string | undefined, endedAt: string | undefined;
    try {
      startedAt = params.id
        ? record?.entity.startedAt
        : selectStoreEventTime(start.date, start.time, start.occurrence);
    } catch (e) {
      problems.start = e instanceof Error ? e.message : "Vérifiez le début.";
    }
    if (params.id || finished)
      try {
        endedAt = selectStoreEventTime(end.date, end.time, end.occurrence);
      } catch (e) {
        problems.end = e instanceof Error ? e.message : "Vérifiez la fin.";
      }
    const at = new Date().toISOString();
    if (startedAt && Date.parse(startedAt) > Date.parse(at))
      problems.start =
        "Le début doit correspondre à une observation déjà faite.";
    if (
      endedAt &&
      startedAt &&
      (Date.parse(endedAt) < Date.parse(startedAt) ||
        Date.parse(endedAt) > Date.parse(at))
    )
      problems.end =
        "La fin doit être après le début, sans être dans le futur.";
    setIssues(problems);
    if (Object.keys(problems).length) return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      if (currentScope.current !== scope) return;
      if (params.id) {
        if (!record) throw Error("STORE_EVENT_MISSING");
        await repo.close(storeId, record.entity.id, endedAt!, {
          commandId: randomUUID(),
          deviceId,
          capturedAt: at,
        });
      } else {
        const payload = createStoreEventPayloadSchema.parse({
          event: {
            id: eventId,
            productId: source!.id,
            type,
            startedAt,
            endedAt: endedAt ?? null,
            severity,
            comment: comment.trim() || null,
            clientCapturedAt: at,
          },
        });
        await repo.create(storeId, payload, {
          commandId: randomUUID(),
          deviceId,
        });
      }
      void syncNow(storeId).catch(() => undefined);
      if (currentScope.current === scope)
        router.replace(
          source ? (`/(tabs)/products/${source.id}` as Href) : "/store-events",
        );
    } catch (e) {
      if (currentScope.current === scope)
        setError(
          e instanceof Error
            ? e.message.startsWith("STORE_EVENT")
              ? storeEventError(e.message)
              : "Vérifiez les informations du signalement."
            : "Enregistrement impossible.",
        );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const matches =
    current?.products.filter((p) =>
      (p.label + " " + (current.identifiers[p.id] ?? ""))
        .toLocaleLowerCase("fr-FR")
        .includes(search.toLocaleLowerCase("fr-FR")),
    ) ?? [];
  return (
    <AppScreen>
      <AppHeader
        title={params.id ? "Clôturer le signalement" : "Signaler"}
        subtitle="Une observation magasin, distincte d’une instruction commerciale."
      />
      <SecondaryButton
        label={source ? "Retour à la fiche produit" : "Retour"}
        disabled={busy}
        onPress={() =>
          source
            ? router.replace(`/(tabs)/products/${source.id}` as Href)
            : router.back()
        }
      />
      {!current || formScope !== scope ? (
        <Text className="text-muted">Lecture des données locales…</Text>
      ) : params.id && !record ? (
        <InlineAlert
          title="Signalement indisponible"
          message="Ce signalement n’existe pas dans le magasin actuel."
        />
      ) : (
        <>
          <SectionCard title="Produit concerné">
            {params.productId || params.id ? (
              <>
                <Text className="font-semibold text-ink">
                  {source?.label ?? "Produit indisponible"}
                </Text>
                {source ? (
                  <Text className="text-muted">
                    {current.identifiers[source.id] ??
                      "Aucun code produit enregistré"}
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                <TextInput
                  accessibilityLabel="Rechercher le produit à signaler"
                  placeholder="Nom, EAN ou code produit"
                  value={search}
                  editable={!busy}
                  onChangeText={setSearch}
                  className="rounded-xl border border-line p-3 text-ink"
                />
                {matches.slice(0, 20).map((p) => (
                  <View
                    key={p.id}
                    className="flex-row items-center justify-between gap-2"
                  >
                    <View className="flex-1">
                      <Text className="text-ink">{p.label}</Text>
                      <Text className="text-muted">
                        {current.identifiers[p.id] ?? "Aucun code enregistré"}
                      </Text>
                    </View>
                    <Switch
                      accessibilityLabel={`Signaler ${p.label} ${current.identifiers[p.id] ?? ""}`}
                      value={productId === p.id}
                      disabled={busy}
                      onValueChange={(v) => {
                        setProductId(v ? p.id : "");
                        clear();
                      }}
                    />
                  </View>
                ))}
                {matches.length > 20 ? (
                  <Text className="text-muted">
                    20 produits affichés sur {matches.length}. Précisez la
                    recherche.
                  </Text>
                ) : null}
                {source ? (
                  <Text className="font-semibold text-ink">
                    Produit choisi : {source.label}
                  </Text>
                ) : null}
              </>
            )}
            {issues.product ? (
              <Text accessibilityRole="alert" className="text-danger">
                {issues.product}
              </Text>
            ) : null}
          </SectionCard>
          {record ? (
            <>
              <SecondaryButton
                label="Trouver un remplaçant"
                onPress={() =>
                  router.push({
                    pathname: "/substitutes",
                    params: { productId: record.entity.productId },
                  } as Href)
                }
              />
              <SectionCard title="Observation conservée">
                <Text className="text-ink">
                  {storeEventSummary(record.entity)}
                </Text>
              </SectionCard>
              {record.syncState === "CONFLICT" ? (
                <>
                  <InlineAlert
                    title="Clôtures à comparer"
                    message="Votre observation est conservée. Comparez les deux versions avant toute nouvelle clôture."
                  />
                  <SecondaryButton
                    label="Ouvrir Synchronisation"
                    onPress={() => router.push("/sync-center")}
                  />
                </>
              ) : record.entity.status === "CLOSED" ? (
                <InlineAlert
                  title="Signalement terminé"
                  message="La date de fin est conservée dans l’historique."
                />
              ) : record.entity.source !== "USER" ? (
                <InlineAlert
                  title="Source documentaire"
                  message="Une instruction commerciale n’est pas un incident magasin à clôturer."
                />
              ) : (
                <>
                  <StoreEventTimeField
                    label="Fin"
                    value={end}
                    onChange={(v) => {
                      setEnd(v);
                      clear();
                    }}
                    disabled={busy}
                    issue={issues.end}
                  />
                  <PrimaryButton
                    label={
                      busy
                        ? "Enregistrement…"
                        : "Confirmer la fin du signalement"
                    }
                    disabled={busy}
                    onPress={() => void save()}
                  />
                </>
              )}
            </>
          ) : (
            <>
              <SectionCard title="Type de signalement">
                {Object.entries(storeEventLabels).map(([key, label]) => (
                  <View
                    key={key}
                    className="flex-row items-center justify-between"
                  >
                    <Text className="flex-1 text-ink">{label}</Text>
                    <Switch
                      accessibilityLabel={`Signaler : ${label}`}
                      disabled={busy}
                      value={type === key}
                      onValueChange={(v) => {
                        setType(
                          v ? (key as StoreProductEvent["type"]) : undefined,
                        );
                        clear();
                      }}
                    />
                  </View>
                ))}
                {issues.type ? (
                  <Text accessibilityRole="alert" className="text-danger">
                    {issues.type}
                  </Text>
                ) : null}
              </SectionCard>
              <SectionCard title="Quand ?">
                <StoreEventTimeField
                  label="Début"
                  value={start}
                  onChange={(v) => {
                    setStart(v);
                    clear();
                  }}
                  disabled={busy}
                  issue={issues.start}
                />
                <View className="flex-row items-center justify-between">
                  <Text className="flex-1 text-ink">
                    Le problème est déjà terminé
                  </Text>
                  <Switch
                    accessibilityLabel="Le problème est déjà terminé"
                    disabled={busy}
                    value={finished}
                    onValueChange={(v) => {
                      setFinished(v);
                      clear();
                    }}
                  />
                </View>
                {finished ? (
                  <StoreEventTimeField
                    label="Fin"
                    value={end}
                    onChange={(v) => {
                      setEnd(v);
                      clear();
                    }}
                    disabled={busy}
                    issue={issues.end}
                  />
                ) : null}
              </SectionCard>
              <SectionCard title="Précisions facultatives">
                {([null, "LOW", "MEDIUM", "HIGH"] as const).map((level) => (
                  <View
                    key={level ?? "none"}
                    className="flex-row items-center justify-between"
                  >
                    <Text className="flex-1 text-ink">
                      Gravité :{" "}
                      {level === null
                        ? "non précisée"
                        : { LOW: "faible", MEDIUM: "moyenne", HIGH: "élevée" }[
                            level
                          ]}
                    </Text>
                    <Switch
                      accessibilityLabel={`Gravité ${level ?? "non précisée"}`}
                      value={severity === level}
                      disabled={busy}
                      onValueChange={(v) => {
                        setSeverity(v ? level : null);
                        clear();
                      }}
                    />
                  </View>
                ))}
                <TextInput
                  accessibilityLabel="Note du signalement, facultative"
                  placeholder="Une précision utile pour le rayon"
                  value={comment}
                  onChangeText={(v) => {
                    setComment(v);
                    clear();
                  }}
                  maxLength={1200}
                  multiline
                  editable={!busy}
                  className="rounded-xl border border-line p-3 text-ink"
                />
              </SectionCard>
              <PrimaryButton
                label={busy ? "Enregistrement…" : "Enregistrer le signalement"}
                disabled={busy}
                onPress={() => void save()}
              />
              <Text className="text-muted">
                Enregistré sur cet appareil, même hors connexion. Aucun stock,
                chiffre de vente ou score appris n’est calculé à partir de ce
                seul signalement.
              </Text>
            </>
          )}
        </>
      )}
      {record ? <EvidenceView eventId={record.entity.id} /> : null}
      {error ? (
        <InlineAlert title="Signalement non enregistré" message={error} />
      ) : null}
    </AppScreen>
  );
}
