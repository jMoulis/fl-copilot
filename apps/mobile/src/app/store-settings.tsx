import { MerchandisingEditor } from "@/store/merchandising-editor";
import {
  merchandisingDraft,
  merchandisingValue,
  type MerchandisingDraft,
} from "@/store/merchandising-draft";
import { useUnsavedForm } from "@/components/use-unsaved-form";
import { captureStorePosition } from "@/store/position";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Platform,
  Text,
  TextInput,
  Switch,
  View,
  Pressable,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { randomUUID } from "expo-crypto";
import { requireOptionalNativeModule } from "expo-modules-core";
import {
  storeContextSettingsSchema,
  type StoreContextSettings,
} from "@fl-copilot/sync-contracts";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import {
  AppScreen,
  AppHeader,
  SectionCard,
  SecondaryButton,
  PrimaryButton,
  InlineAlert,
  MenuRow,
} from "@/components/ui";
import {
  StoreContextRepository,
  type LocalStoreContext,
} from "@/store/context-repository";
import { storeContextError } from "@/store/context-presentation";
const nativeLocation = !!requireOptionalNativeModule("ExpoLocation");
export default function StoreSettingsScreen() {
  const { session } = useAuth(),
    store = session?.stores[0];
  return store && session ? (
    <StoreSettingsEditor
      key={`${store.storeId}:${session.user.id}:${store.role}`}
      storeId={store.storeId}
      storeName={store.name}
      canManage={store.role === "MANAGER"}
    />
  ) : (
    <AppScreen>
      <AppHeader title="Mon magasin" />
      <InlineAlert
        title="Magasin indisponible"
        message="Connectez-vous à votre magasin pour accéder à ses réglages."
      />
    </AppScreen>
  );
}
function StoreSettingsEditor({
  storeId,
  storeName,
  canManage,
}: {
  storeId: string;
  storeName: string;
  canManage: boolean;
}) {
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync();
  const repo = useMemo(() => new StoreContextRepository(sqlite), [sqlite]);
  const [saved, setSaved] = useState<LocalStoreContext | null>(),
    [city, setCity] = useState("Asnières-sur-Seine"),
    [postalCode, setPostalCode] = useState("92600"),
    [schoolZone, setZone] = useState<StoreContextSettings["schoolZone"]>("C"),
    [pointMode, setPointMode] = useState(false),
    [position, setPosition] = useState<StoreContextSettings["position"]>(null),
    [activity, setActivity] = useState<"SAVE" | "LOCATION" | "READ" | null>(
      null,
    ),
    [error, setError] = useState<string>(),
    [notice, setNotice] = useState<string>(),
    [issues, setIssues] = useState<Record<string, string>>({});
  const [merchandising, setMerchandising] = useState<MerchandisingDraft>();
  const busy = activity !== null;
  const baseline = useRef<string | undefined>(undefined);
  const readGeneration = useRef(0);
  const draft = JSON.stringify([
    city,
    postalCode,
    schoolZone,
    pointMode,
    position,
    merchandising,
  ]);
  const dirty =
    saved !== undefined &&
    baseline.current !== undefined &&
    draft !== baseline.current;
  const dirtyRef = useRef(dirty),
    busyRef = useRef(busy);
  dirtyRef.current = dirty;
  busyRef.current = busy;
  useUnsavedForm(dirty, busy);
  const hydrate = useCallback((s: LocalStoreContext | null) => {
    const c = s?.entity;
    const values = {
      city: c?.city ?? "Asnières-sur-Seine",
      postalCode: c?.postalCode ?? "92600",
      schoolZone: c?.schoolZone ?? (c ? null : ("C" as const)),
      pointMode: c?.locationMode === "POINT",
      position: c?.position ?? null,
      merchandising: merchandisingDraft(c?.merchandising),
    };
    baseline.current = JSON.stringify([
      values.city,
      values.postalCode,
      values.schoolZone,
      values.pointMode,
      values.position,
      values.merchandising,
    ]);
    dirtyRef.current = false;
    setSaved(s);
    setCity(values.city);
    setPostalCode(values.postalCode);
    setZone(values.schoolZone);
    setPointMode(values.pointMode);
    setPosition(values.position);
    setMerchandising(values.merchandising);
  }, []);
  const load = useCallback(
    async (replace = false, active: () => boolean = () => true) => {
      const generation = ++readGeneration.current;
      try {
        const s = await repo.get(storeId);
        if (
          generation !== readGeneration.current ||
          !active() ||
          (!replace && (busyRef.current || dirtyRef.current))
        )
          return;
        hydrate(s);
        setError(undefined);
        setIssues({});
        setNotice(undefined);
      } catch {
        if (generation === readGeneration.current && active())
          setError(
            "Les réglages du magasin ne peuvent pas être lus. Votre saisie reste conservée.",
          );
      }
    },
    [repo, storeId, hydrate],
  );
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void load(false, () => active);
      return () => {
        active = false;
      };
    }, [load]),
  );
  async function performReload() {
    if (busyRef.current) return;
    busyRef.current = true;
    setActivity("READ");
    try {
      await load(true);
    } finally {
      busyRef.current = false;
      setActivity(null);
    }
  }
  function reload() {
    if (busy) return;
    if (!dirty) {
      void performReload();
      return;
    }
    const message =
      "Vos modifications non enregistrées seront perdues. Les réglages enregistrés seront relus.";
    if (Platform.OS === "web") {
      if (window.confirm(message)) void performReload();
      return;
    }
    Alert.alert("Abandonner la saisie ?", message, [
      { text: "Continuer la saisie", style: "cancel" },
      {
        text: "Abandonner et relire",
        style: "destructive",
        onPress: () => void performReload(),
      },
    ]);
  }
  function changeTown(value: string, field: "city" | "postalCode") {
    dirtyRef.current = true;
    if (field === "city") setCity(value);
    else setPostalCode(value);
    setPosition(null);
    setZone(null);
  }
  async function locate() {
    if (!canManage || busyRef.current) return;
    setError(undefined);
    if (!nativeLocation) {
      setError(
        "La localisation native n’est pas disponible dans cette version. La saisie par commune reste disponible.",
      );
      return;
    }
    busyRef.current = true;
    setActivity("LOCATION");
    try {
      const Location = await import("expo-location");
      setPosition(
        await captureStorePosition({
          requestPermission: async () =>
            (await Location.requestForegroundPermissionsAsync()).granted,
          servicesEnabled: () => Location.hasServicesEnabledAsync(),
          readPosition: async () =>
            (
              await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
              })
            ).coords,
          now: () => new Date().toISOString(),
        }),
      );
      setNotice(
        "Position relevée. Vérifiez que vous êtes au magasin, puis enregistrez les réglages.",
      );
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "";
      setError(
        code === "LOCATION_DENIED"
          ? "La localisation n’est pas autorisée. La saisie par commune reste disponible."
          : code === "LOCATION_DISABLED"
            ? "Activez la localisation du téléphone ou utilisez la commune."
            : code === "LOCATION_TIMEOUT"
              ? "Le relevé prend trop de temps. Réessayez ou utilisez la commune du magasin."
              : "La position n’a pas pu être relevée. Réessayez ou utilisez la commune du magasin.",
      );
    } finally {
      busyRef.current = false;
      setActivity(null);
    }
  }
  async function save() {
    if (!storeId || !canManage || busyRef.current || saved === undefined)
      return;
    setError(undefined);
    setIssues({});
    const now = new Date().toISOString(),
      parsed = storeContextSettingsSchema.safeParse({
        id: storeId,
        storeId,
        city,
        postalCode,
        country: "FR",
        timezone: "Europe/Paris",
        schoolZone,
        locationMode: pointMode ? "POINT" : "CITY",
        position: pointMode ? position : null,
        ...(merchandising === undefined
          ? {}
          : { merchandising: merchandisingValue(merchandising) }),
        version:
          (saved?.syncState === "ERROR"
            ? (saved.remoteVersion ?? 0)
            : (saved?.entity.version ?? 0)) + 1,
        createdAt: saved?.entity.createdAt ?? now,
        updatedAt: now,
      });
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0]);
        fields[field] =
          field === "merchandising"
            ? issue.code === "custom"
              ? issue.message
              : "Vérifie le nombre de TG (de 0 à 128), les noms et les repères des emplacements."
            : ((
                {
                  city: "Saisissez la commune du magasin.",
                  postalCode:
                    "Saisissez un code postal français à cinq chiffres.",
                  position:
                    "Relevez la position du magasin ou utilisez la localisation par commune.",
                } as Record<string, string>
              )[field] ?? "Vérifiez ce réglage avant de l’enregistrer.");
      }
      setIssues(fields);
      return;
    }
    ++readGeneration.current;
    busyRef.current = true;
    setActivity("SAVE");
    try {
      await repo.save(
        parsed.data,
        { commandId: randomUUID(), deviceId },
        saved?.entity ?? null,
      );
      const stored = await repo.get(storeId);
      if (!stored) throw Error("STORE_CONTEXT_CHANGED");
      hydrate(stored);
      setNotice("Réglages enregistrés sur cet appareil.");
      void syncNow(storeId)
        .then(async () => {
          const latest = await repo.get(storeId);
          if (latest?.entity.version === parsed.data.version) setSaved(latest);
          else if (latest)
            setError(
              "Les réglages ont changé pendant la synchronisation. Votre saisie reste visible ; rouvrez Magasin avant de les modifier.",
            );
        })
        .catch(() => undefined);
    } catch (e) {
      setError(storeContextError(e instanceof Error ? e.message : undefined));
    } finally {
      busyRef.current = false;
      setActivity(null);
    }
  }
  return (
    <AppScreen>
      <AppHeader
        title="Mon magasin"
        subtitle="Localisation et contexte de préparation de la semaine."
      />
      <SecondaryButton label="Retour" onPress={() => router.back()} />
      <MenuRow
        title="Plan et mobilier"
        description="Consulter les îlots, les TG et leurs surfaces de vente."
        icon="map-outline"
        onPress={() => router.push("/store-layout")}
      />
      {error ? (
        <>
          <InlineAlert title="Réglages à vérifier" message={error} />
          <SecondaryButton
            label={
              dirty
                ? "Relire les réglages et abandonner ma saisie…"
                : "Relire les réglages"
            }
            disabled={busy}
            onPress={reload}
          />
        </>
      ) : null}
      {notice ? <InlineAlert title="Magasin" message={notice} /> : null}
      <SectionCard title={storeName}>
        <Text className="text-muted">
          {saved
            ? ((
                {
                  SYNCED: "Synchronisé",
                  PENDING: "À synchroniser",
                  CONFLICT: "Conflit à résoudre",
                  ERROR: "Envoi refusé : réglages locaux conservés",
                } as Record<string, string>
              )[saved.syncState] ?? saved.syncState)
            : saved === undefined
              ? "Lecture des réglages…"
              : "Proposition pour le magasin pilote, à confirmer par Enregistrer"}
        </Text>
        {saved?.syncState === "CONFLICT" ? (
          <SecondaryButton
            label="Comparer dans Synchronisation"
            onPress={() => router.push("/sync-center")}
          />
        ) : null}
      </SectionCard>
      {dirty ? (
        <Text accessibilityLiveRegion="polite" className="text-warning">
          Modifications non enregistrées
        </Text>
      ) : null}
      <MerchandisingEditor
        value={merchandising}
        onChange={(next) => {
          dirtyRef.current = true;
          setMerchandising(next);
        }}
        disabled={!canManage || busy || saved === undefined}
        issue={issues.merchandising}
      />
      <SectionCard title="Commune du magasin">
        <Text className="text-muted">Commune</Text>
        <TextInput
          accessibilityLabel="Commune du magasin"
          value={city}
          editable={canManage && !busy && saved !== undefined}
          onChangeText={(v) => changeTown(v, "city")}
          maxLength={120}
          className={`rounded-xl border p-3 text-ink ${issues.city ? "border-danger" : "border-line"}`}
        />
        {issues.city ? (
          <Text className="text-danger" accessibilityRole="alert">
            {issues.city}
          </Text>
        ) : null}
        <Text className="text-muted">Code postal</Text>
        <TextInput
          accessibilityLabel="Code postal"
          value={postalCode}
          editable={canManage && !busy && saved !== undefined}
          onChangeText={(v) => changeTown(v, "postalCode")}
          keyboardType="number-pad"
          maxLength={5}
          className={`rounded-xl border p-3 text-ink ${issues.postalCode ? "border-danger" : "border-line"}`}
        />
        {issues.postalCode ? (
          <Text className="text-danger" accessibilityRole="alert">
            {issues.postalCode}
          </Text>
        ) : null}
        <Text className="text-sm text-muted">
          France · fuseau Europe/Paris. La commune sert de référence lorsque la
          position précise n’est pas utilisée.
        </Text>
      </SectionCard>
      <SectionCard title="Position pour la météo">
        <View className="flex-row items-center justify-between gap-3">
          <Text className="flex-1 text-ink">
            Utiliser une position précise enregistrée pour le magasin
          </Text>
          <Switch
            accessibilityLabel="Utiliser une position précise du magasin"
            value={pointMode}
            disabled={!canManage || busy || saved === undefined}
            onValueChange={(value) => {
              setPointMode(value);
              if (!value) setPosition(null);
            }}
          />
        </View>
        <Text className="text-sm text-muted">
          Le téléphone relève la position uniquement quand vous appuyez sur le
          bouton. Faites-le au magasin ; cette position restera fixe si vous
          vous déplacez ensuite. Aucun suivi en arrière-plan.
        </Text>
        {pointMode ? (
          <>
            <SecondaryButton
              label={
                activity === "LOCATION"
                  ? "Relevé…"
                  : "Relever ma position au magasin"
              }
              disabled={!canManage || busy || saved === undefined}
              onPress={() => void locate()}
            />
            <Text className="text-ink">
              {position
                ? `${position.latitude} · ${position.longitude} · relevée le ${new Date(position.capturedAt).toLocaleString("fr-FR")}`
                : "Position non relevée"}
            </Text>
            {issues.position ? (
              <Text className="text-danger" accessibilityRole="alert">
                {issues.position}
              </Text>
            ) : null}
          </>
        ) : null}
      </SectionCard>
      <SectionCard title="Vacances scolaires">
        <Text className="text-sm text-muted">
          Choisissez la zone du magasin. Elle n’est pas déduite de la position
          du téléphone.
        </Text>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Zone de vacances scolaires"
          className="flex-row flex-wrap gap-2"
        >
          {(["A", "B", "C", null] as const).map((zone) => (
            <Pressable
              key={zone ?? "unknown"}
              accessibilityRole="radio"
              accessibilityLabel={zone ? `Zone ${zone}` : "Zone non précisée"}
              accessibilityState={{
                checked: schoolZone === zone,
                disabled: busy || saved === undefined,
              }}
              aria-checked={schoolZone === zone}
              aria-disabled={!canManage || busy || saved === undefined}
              disabled={!canManage || busy || saved === undefined}
              onPress={() => setZone(zone)}
              className={`min-h-12 items-center justify-center rounded-xl border px-4 py-3 ${schoolZone === zone ? "border-forest bg-forest-soft" : "border-line bg-surface"}`}
            >
              <Text className="text-ink">
                {zone ? `Zone ${zone}` : "Non précisée"}
              </Text>
            </Pressable>
          ))}
        </View>
      </SectionCard>
      <SectionCard title="Contexte météo">
        <Text className="text-muted">
          La météo MET Norway et les calendriers officiels sont disponibles dans
          Ma semaine, après synchronisation des réglages. Ces réglages ne
          changent pas les offres, les plans ni les résultats du rayon.
        </Text>
      </SectionCard>
      <PrimaryButton
        label={
          activity === "SAVE"
            ? "Enregistrement…"
            : activity === "READ"
              ? "Lecture…"
              : activity === "LOCATION"
                ? "Relevé…"
                : "Enregistrer les réglages du magasin"
        }
        disabled={
          !canManage ||
          busy ||
          saved === undefined ||
          saved?.syncState === "CONFLICT"
        }
        onPress={() => void save()}
      />
    </AppScreen>
  );
}
