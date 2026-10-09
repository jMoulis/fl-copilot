import { captureStorePosition } from "@/store/position";
import { useCallback, useMemo, useState } from "react";
import { Text, TextInput, Switch, View } from "react-native";
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
} from "@/components/ui";
import {
  StoreContextRepository,
  type LocalStoreContext,
} from "@/store/context-repository";
import { storeContextError } from "@/store/context-presentation";
const nativeLocation = !!requireOptionalNativeModule("ExpoLocation");
export default function StoreSettingsScreen() {
  const { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync();
  const repo = useMemo(() => new StoreContextRepository(sqlite), [sqlite]);
  const [saved, setSaved] = useState<LocalStoreContext | null>(),
    [city, setCity] = useState("Asnières-sur-Seine"),
    [postalCode, setPostalCode] = useState("92600"),
    [schoolZone, setZone] = useState<StoreContextSettings["schoolZone"]>("C"),
    [pointMode, setPointMode] = useState(false),
    [position, setPosition] = useState<StoreContextSettings["position"]>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [notice, setNotice] = useState<string>(),
    [issues, setIssues] = useState<Record<string, string>>({});
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (storeId)
        void repo
          .get(storeId)
          .then((s) => {
            if (active) {
              setSaved(s);
              if (s) {
                setCity(s.entity.city);
                setPostalCode(s.entity.postalCode);
                setZone(s.entity.schoolZone);
                setPointMode(s.entity.locationMode === "POINT");
                setPosition(s.entity.position);
              }
            }
          })
          .catch(() => {
            if (active)
              setError("Les réglages du magasin ne peuvent pas être lus.");
          });
      return () => {
        active = false;
      };
    }, [repo, storeId]),
  );
  function changeTown(value: string, field: "city" | "postalCode") {
    if (field === "city") setCity(value);
    else setPostalCode(value);
    setPosition(null);
    setZone(null);
  }
  async function locate() {
    if (busy) return;
    setError(undefined);
    if (!nativeLocation) {
      setError(
        "Installez le nouveau build iPhone pour relever la position. La saisie par commune reste disponible.",
      );
      return;
    }
    setBusy(true);
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
      setBusy(false);
    }
  }
  async function save() {
    if (!storeId || busy || saved === undefined) return;
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
        version:
          (saved?.syncState === "ERROR"
            ? (saved.remoteVersion ?? 0)
            : (saved?.entity.version ?? 0)) + 1,
        createdAt: saved?.entity.createdAt ?? now,
        updatedAt: now,
      });
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const i of parsed.error.issues)
        fields[String(i.path[0])] = i.message;
      setIssues(fields);
      return;
    }
    setBusy(true);
    try {
      await repo.save(parsed.data, { commandId: randomUUID(), deviceId });
      setSaved(await repo.get(storeId));
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
      setBusy(false);
    }
  }
  return (
    <AppScreen>
      <AppHeader
        title="Mon magasin"
        subtitle="Localisation et contexte de préparation de la semaine."
      />
      <SecondaryButton label="Retour à Plus" onPress={() => router.back()} />
      {error ? (
        <InlineAlert title="Réglages à vérifier" message={error} />
      ) : null}
      {notice ? <InlineAlert title="Magasin" message={notice} /> : null}
      <SectionCard title={session?.stores[0]?.name ?? "Magasin pilote"}>
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
      <SectionCard title="Commune du magasin">
        <TextInput
          accessibilityLabel="Commune du magasin"
          value={city}
          editable={!busy}
          onChangeText={(v) => changeTown(v, "city")}
          maxLength={120}
          className={`rounded-xl border p-3 text-ink ${issues.city ? "border-danger" : "border-line"}`}
        />
        {issues.city ? (
          <Text className="text-danger" accessibilityRole="alert">
            {issues.city}
          </Text>
        ) : null}
        <TextInput
          accessibilityLabel="Code postal"
          value={postalCode}
          editable={!busy}
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
            disabled={busy}
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
              label={busy ? "Relevé…" : "Relever ma position au magasin"}
              disabled={busy}
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
          Zone du magasin, à confirmer. La zone C est proposée pour
          Asnières-sur-Seine.
        </Text>
        {(["A", "B", "C", null] as const).map((zone) => (
          <SecondaryButton
            key={zone ?? "unknown"}
            label={`${schoolZone === zone ? "✓ " : ""}${zone ? `Zone ${zone}` : "Zone non précisée"}`}
            disabled={busy}
            onPress={() => setZone(zone)}
          />
        ))}
      </SectionCard>
      <SectionCard title="Contexte météo">
        <Text className="text-muted">
          Fournisseur retenu : MET Norway. Les prévisions, jours fériés et
          vacances seront ajoutés dans la prochaine étape. Ces réglages ne
          changent pas les offres, les plans ni les résultats du rayon.
        </Text>
      </SectionCard>
      <PrimaryButton
        label={busy ? "Enregistrement…" : "Enregistrer les réglages du magasin"}
        disabled={
          busy || saved === undefined || saved?.syncState === "CONFLICT"
        }
        onPress={() => void save()}
      />
    </AppScreen>
  );
}
