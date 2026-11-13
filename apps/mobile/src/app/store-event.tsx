import Ionicons from "@expo/vector-icons/Ionicons";
import { EventSeverity } from "@/needs/event-severity";
import { journalColors as c } from "@/journal/journal-theme";
import { journalDateLabel } from "@/journal/journal-presentation";
import { returnToProduct } from "../products/product-navigation";
import { calendarDate, tradingToday } from "../dates/calendar";
import { EvidenceView } from "@/needs/evidence-view";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
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
  stockoutObservationMoments,
  storeEventObservationNote,
  type StockoutObservationMoment,
} from "@/needs/store-event-presentation";
import { substitutionIdentifierLabels } from "@/needs/substitution-details";
import {
  AppScreen,
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
  const params = useLocalSearchParams<{
      productId?: string;
      id?: string;
      date?: string;
    }>(),
    { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    { sqlite, deviceId } = useLocalDatabase(),
    { syncNow, status: syncStatus } = useSync(),
    repo = useMemo(() => new StoreProductEventRepository(sqlite), [sqlite]);
  const captureDate =
    typeof params.date === "string" &&
    calendarDate(params.date) &&
    params.date <= tradingToday()
      ? params.date
      : undefined;
  const scope = `${storeId}:${params.productId ?? "select"}:${params.id ?? "new"}:${captureDate ?? "now"}`,
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
    [observationMoment, setObservationMoment] =
      useState<StockoutObservationMoment>(),
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
      comment?: string;
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
    setObservationMoment(undefined);
    setStart(
      captureDate && captureDate !== tradingToday()
        ? { date: captureDate, time: "" }
        : nowInput(),
    );
    setEnd(nowInput());
    setFinished(false);
    setIssues({});
    setError(undefined);
  }, [current, formScope, scope, params.productId, captureDate]);
  function clear() {
    setIssues({});
    setError(undefined);
  }
  async function save() {
    if (busyRef.current || !storeId || !current || formScope !== scope) return;
    const problems: typeof issues = {};
    const observationNote = storeEventObservationNote(
      type,
      observationMoment,
      comment,
    );
    if (!params.id && observationNote && observationNote.length > 1200)
      problems.comment =
        "Raccourcissez la note : 1 200 caractères maximum, moment du constat compris.";
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
      problems.start =
        e instanceof Error ? e.message : "Vérifiez la date du constat.";
    }
    if (params.id || finished)
      try {
        endedAt = selectStoreEventTime(end.date, end.time, end.occurrence);
      } catch (e) {
        problems.end = e instanceof Error ? e.message : "Vérifiez la fin.";
      }
    const at = new Date().toISOString();
    if (startedAt && Date.parse(startedAt) > Date.parse(at))
      problems.start = "La date doit correspondre à un constat déjà fait.";
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
            comment: observationNote,
            clientCapturedAt: at,
          },
        });
        await repo.create(storeId, payload, {
          commandId: randomUUID(),
          deviceId,
        });
      }
      void syncNow(storeId).catch(() => undefined);
      if (currentScope.current === scope) {
        if (captureDate && router.canGoBack()) router.back();
        else if (source) returnToProduct(router, source.id);
        else router.replace("/store-events");
      }
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
    <AppScreen
      keyboardAware
      backgroundColor={c.canvas}
      contentContainerStyle={{ gap: 16, padding: 20, paddingTop: 0 }}
    >
      <View style={styles.nav}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retour"
          disabled={busy}
          onPress={() => {
            if (router.canGoBack()) router.back();
            else if (source) returnToProduct(router, source.id);
            else router.replace("/today");
          }}
          style={styles.back}
        >
          <Ionicons name="arrow-back" size={19} color={c.mint} />
          <Text style={{ color: c.mint, fontWeight: "600" }}>Retour</Text>
        </Pressable>
        <Text style={{ color: c.muted, fontSize: 13 }}>
          {captureDate ? "Journal" : "Observation magasin"}
        </Text>
      </View>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={styles.title}>
          {params.id ? "Clôturer le signalement" : "Signaler"}
        </Text>
        <Text
          style={{ color: c.muted, fontSize: 13, textTransform: "capitalize" }}
        >
          {journalDateLabel(captureDate ?? tradingToday())}
        </Text>
      </View>
      {!current || formScope !== scope ? (
        <Text className="text-muted">Lecture des données locales…</Text>
      ) : params.id && !record ? (
        <InlineAlert
          title="Signalement indisponible"
          message="Ce signalement n’existe pas dans le magasin actuel."
        />
      ) : (
        <>
          <View style={{ gap: 7 }}>
            <Text style={styles.label}>Produit concerné</Text>
            {source ? (
              <View style={styles.chosen}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.label}>{source.label}</Text>
                  <Text style={styles.muted}>
                    {current.identifiers[source.id] ?? "Aucun code enregistré"}
                  </Text>
                </View>
                {!params.productId && !params.id ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Changer de produit"
                    disabled={busy}
                    onPress={() => {
                      setProductId("");
                      setSearch("");
                      clear();
                    }}
                    style={styles.back}
                  >
                    <Ionicons
                      name="close-circle-outline"
                      size={22}
                      color={c.mint}
                    />
                  </Pressable>
                ) : null}
              </View>
            ) : params.productId || params.id ? (
              <Text style={styles.muted}>Produit indisponible</Text>
            ) : (
              <>
                <View style={styles.search}>
                  <Ionicons name="search-outline" size={20} color={c.muted} />
                  <TextInput
                    accessibilityLabel="Rechercher le produit à signaler"
                    placeholder="Rechercher un produit"
                    placeholderTextColor={c.muted}
                    value={search}
                    editable={!busy}
                    onChangeText={setSearch}
                    style={styles.searchInput}
                  />
                </View>
                {search.trim() ? (
                  <View style={styles.matches}>
                    {matches.slice(0, 6).map((p) => (
                      <Pressable
                        key={p.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Choisir ${p.label} ${current.identifiers[p.id] ?? ""}`}
                        disabled={busy}
                        onPress={() => {
                          setProductId(p.id);
                          setSearch("");
                          clear();
                        }}
                        style={styles.match}
                      >
                        <Text style={styles.label}>{p.label}</Text>
                        <Text style={styles.muted}>
                          {current.identifiers[p.id] ?? "Aucun code enregistré"}
                        </Text>
                      </Pressable>
                    ))}
                    {!matches.length ? (
                      <Text style={styles.muted}>
                        Aucun produit trouvé. Essaie un autre nom ou code.
                      </Text>
                    ) : null}
                    {matches.length > 6 ? (
                      <Text style={styles.muted}>
                        6 produits sur {matches.length}. Précise ta recherche.
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </>
            )}
            {issues.product ? (
              <Text accessibilityRole="alert" className="text-critical">
                {issues.product}
              </Text>
            ) : null}
          </View>
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
              <View style={{ gap: 7 }}>
                <Text style={styles.label}>Type de signalement</Text>
                <View
                  accessibilityRole="radiogroup"
                  accessibilityLabel="Type de signalement"
                  style={styles.types}
                >
                  {eventTypes.map(({ value, icon }) => (
                    <Pressable
                      key={value}
                      accessibilityRole="radio"
                      accessibilityLabel={`Signaler : ${storeEventLabels[value]}`}
                      accessibilityState={{
                        checked: type === value,
                        disabled: busy,
                      }}
                      disabled={busy}
                      onPress={() => {
                        setType(value);
                        clear();
                      }}
                      className="active:opacity-70"
                      style={[
                        styles.type,
                        {
                          borderColor: type === value ? c.mint : c.line,
                          backgroundColor:
                            type === value ? "#233B2C" : "transparent",
                          opacity: 1,
                        },
                      ]}
                    >
                      <Ionicons
                        name={icon}
                        size={16}
                        color={type === value ? c.mint : c.muted}
                      />
                      <Text
                        style={[
                          styles.typeLabel,
                          type === value && { color: c.mint },
                        ]}
                      >
                        {storeEventLabels[value]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {issues.type ? (
                  <Text accessibilityRole="alert" className="text-critical">
                    {issues.type}
                  </Text>
                ) : null}
              </View>
              {type === "OUT_OF_STOCK" ? (
                <View style={{ gap: 10 }}>
                  <Text style={styles.label}>
                    Moment du constat · facultatif
                  </Text>
                  <View style={styles.types}>
                    {(
                      Object.entries(stockoutObservationMoments) as [
                        StockoutObservationMoment,
                        string,
                      ][]
                    ).map(([value, label]) => (
                      <Pressable
                        key={value}
                        accessibilityRole="button"
                        accessibilityLabel={label}
                        accessibilityState={{
                          selected: observationMoment === value,
                          disabled: busy,
                        }}
                        disabled={busy}
                        onPress={() => {
                          setObservationMoment(
                            observationMoment === value ? undefined : value,
                          );
                          clear();
                        }}
                        style={[
                          styles.type,
                          {
                            borderColor:
                              observationMoment === value ? c.mint : c.line,
                            backgroundColor:
                              observationMoment === value
                                ? "#233B2C"
                                : "transparent",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.typeLabel,
                            observationMoment === value && { color: c.mint },
                          ]}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
              <EventSeverity
                value={severity}
                disabled={busy}
                onChange={(v) => {
                  setSeverity(v);
                  clear();
                }}
              />
              <StoreEventTimeField
                compact
                label={type === "OUT_OF_STOCK" ? "Rupture constatée" : "Début"}
                value={start}
                onChange={(v) => {
                  setStart(v);
                  clear();
                }}
                disabled={busy}
                issue={issues.start}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  finished ? "Retirer la date de fin" : "Ajouter une fin"
                }
                accessibilityState={{ expanded: finished, disabled: busy }}
                disabled={busy}
                onPress={() => {
                  setFinished((v) => !v);
                  clear();
                }}
                style={styles.back}
              >
                <Ionicons
                  name={finished ? "remove" : "add"}
                  size={18}
                  color={c.mint}
                />
                <Text style={styles.linkLabel}>
                  {finished ? "Retirer la fin" : "Ajouter une fin"}
                </Text>
              </Pressable>
              {finished ? (
                <StoreEventTimeField
                  compact
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
              <View style={{ gap: 7 }}>
                <View style={{ flexDirection: "row", gap: 9 }}>
                  <Text style={styles.label}>Note</Text>
                  <Text style={styles.muted}>Facultative</Text>
                </View>
                <TextInput
                  accessibilityLabel="Note du signalement, facultative"
                  placeholder="Que constates-tu en rayon ?"
                  placeholderTextColor={c.muted}
                  value={comment}
                  onChangeText={(v) => {
                    setComment(v);
                    clear();
                  }}
                  maxLength={1200}
                  multiline
                  editable={!busy}
                  style={styles.note}
                />
                {issues.comment ? (
                  <Text accessibilityRole="alert" className="text-critical">
                    {issues.comment}
                  </Text>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  busy ? "Enregistrement…" : "Enregistrer le signalement"
                }
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={() => void save()}
                className="active:opacity-70"
                style={[styles.submit, { opacity: busy ? 0.5 : 1 }]}
              >
                <Ionicons name="checkmark" size={20} color={c.canvas} />
                <Text style={styles.submitLabel}>
                  {busy ? "Enregistrement…" : "Enregistrer le signalement"}
                </Text>
              </Pressable>
              <Text style={styles.muted}>
                Enregistré sur cet appareil, même hors connexion. Heures du
                magasin (Europe/Paris).
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

const eventTypes: {
  value: StoreProductEvent["type"];
  icon: React.ComponentProps<typeof Ionicons>["name"];
}[] = [
  { value: "OUT_OF_STOCK", icon: "ban-outline" },
  { value: "LOW_STOCK", icon: "layers-outline" },
  { value: "QUALITY_ISSUE", icon: "leaf-outline" },
  { value: "TENSION", icon: "pulse-outline" },
  { value: "PRICE_INCREASE", icon: "trending-up-outline" },
  { value: "SUPPLIER_SHORTAGE", icon: "cube-outline" },
];
const styles = StyleSheet.create({
  nav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 52,
    borderBottomWidth: 1,
    borderColor: c.line,
  },
  back: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 44 },
  title: { color: c.ink, fontSize: 28, fontWeight: "700" },
  label: { color: c.ink, fontSize: 14, fontWeight: "600" },
  muted: { color: c.muted, fontSize: 12, lineHeight: 17 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    color: c.ink,
    fontSize: 16,
    paddingVertical: 8,
  },
  chosen: {
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.surface,
    borderRadius: 10,
    padding: 10,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  matches: {
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 10,
    backgroundColor: c.surface,
    padding: 8,
    gap: 4,
  },
  match: { minHeight: 44, justifyContent: "center", padding: 6, gap: 3 },
  types: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  type: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexGrow: 1,
    flexBasis: "47%",
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 9,
    padding: 8,
  },
  typeLabel: { fontSize: 12, color: c.ink, fontWeight: "500", flexShrink: 1 },
  linkLabel: { color: c.mint, fontSize: 13, fontWeight: "600" },
  note: {
    color: c.ink,
    fontSize: 16,
    textAlignVertical: "top",
    minHeight: 64,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.surface,
    borderRadius: 10,
    padding: 10,
  },
  submit: {
    backgroundColor: c.mint,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    minHeight: 48,
    padding: 10,
    borderRadius: 12,
  },
  submitLabel: { color: c.canvas, fontWeight: "700", fontSize: 14 },
});
