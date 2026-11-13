import { SegmentedControl } from "../components/dashboard";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, TextInput, Switch, View } from "react-native";
import { router } from "expo-router";
import { randomUUID } from "expo-crypto";
import { ApiClient } from "@fl-copilot/api-client";
import {
  storeTransportsSchema,
  type NearbyTransportResult,
} from "@fl-copilot/domain";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import { getApiBaseUrl } from "../config/environment";
import {
  StoreContextRepository,
  type LocalStoreContext,
} from "../store/context-repository";
import { useUnsavedForm } from "../components/use-unsaved-form";
import {
  AppScreen,
  AppHeader,
  SectionCard,
  PrimaryButton,
  SecondaryButton,
  InlineAlert,
} from "../components/ui";
export default function StoreTransportsScreen() {
  const { session } = useAuth();
  const store = session?.stores[0];
  return store ? (
    <TransportEditor
      key={`${store.storeId}:${session!.user.id}:${store.role}`}
      storeId={store.storeId}
      canManage={store.role === "MANAGER"}
    />
  ) : (
    <AppScreen>
      <Text className="text-muted">Connecte-toi à ton magasin.</Text>
    </AppScreen>
  );
}
function TransportEditor({
  storeId,
  canManage,
}: {
  storeId: string;
  canManage: boolean;
}) {
  const { sqlite, deviceId } = useLocalDatabase(),
    { withAccessToken } = useAuth(),
    { syncNow, lastSyncedAt } = useSync();
  const repo = useMemo(() => new StoreContextRepository(sqlite), [sqlite]),
    api = useMemo(() => new ApiClient(getApiBaseUrl()), []);
  const [saved, setSaved] = useState<LocalStoreContext | null>(),
    [address, setAddress] = useState(""),
    [radius, setRadius] = useState("800"),
    [mode, setMode] = useState<"ADDRESS" | "STORE_GPS">("ADDRESS"),
    [result, setResult] = useState<NearbyTransportResult>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [notice, setNotice] = useState<string>();
  const alive = useRef(true),
    generation = useRef(0),
    locked = useRef(false),
    baseline = useRef<string | undefined>(undefined),
    dirtyRef = useRef(false);
  const serial = JSON.stringify([
    address,
    radius,
    mode,
    result?.location ?? null,
    result?.lines ?? [],
    result?.retrievedAt ?? null,
  ]);
  const dirty =
    saved !== undefined &&
    baseline.current !== undefined &&
    serial !== baseline.current;
  dirtyRef.current = dirty;
  useUnsavedForm(dirty, busy);
  const hydrate = useCallback(
    (row: LocalStoreContext | null) => {
      const p = row?.entity.transports;
      const next = p
        ? {
            storeId,
            retrievedAt: p.detectedAt,
            partial: p.partial,
            location: p.location,
            lines: p.lines,
            candidates: [],
          }
        : undefined;
      const nextMode =
        p?.location.source ?? (row?.entity.position ? "STORE_GPS" : "ADDRESS");
      setSaved(row);
      setAddress(p?.address ?? "");
      setRadius(String(p?.radiusMetres ?? 800));
      setMode(nextMode);
      setResult(next);
      baseline.current = JSON.stringify([
        p?.address ?? "",
        String(p?.radiusMetres ?? 800),
        nextMode,
        next?.location ?? null,
        next?.lines ?? [],
        next?.retrievedAt ?? null,
      ]);
    },
    [storeId],
  );
  useEffect(() => {
    alive.current = true;
    let current = true;
    void repo
      .get(storeId)
      .then((row) => {
        if (current && alive.current && !dirtyRef.current && !locked.current)
          hydrate(row);
      })
      .catch(() => {
        if (current) setError("Les réglages locaux ne peuvent pas être lus.");
      });
    return () => {
      current = false;
    };
  }, [repo, storeId, lastSyncedAt, hydrate]);
  useEffect(
    () => () => {
      alive.current = false;
      generation.current++;
    },
    [],
  );
  function change(update: () => void) {
    generation.current++;
    setResult(undefined);
    setNotice(undefined);
    setError(undefined);
    update();
  }
  async function search(candidateId?: string) {
    if (!canManage || locked.current || !saved) return;
    const radiusMetres = Number(radius);
    if (
      !Number.isInteger(radiusMetres) ||
      radiusMetres < 200 ||
      radiusMetres > 2000
    ) {
      setError("Choisis un rayon entre 200 et 2 000 mètres.");
      return;
    }
    if (mode === "STORE_GPS" && !saved.entity.position) {
      setError(
        "Enregistre d’abord la position précise depuis Mon magasin, ou utilise une adresse.",
      );
      return;
    }
    const id = ++generation.current;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const point =
        mode === "STORE_GPS"
          ? {
              latitude: saved.entity.position!.latitude,
              longitude: saved.entity.position!.longitude,
            }
          : null;
      const next = await withAccessToken((token) =>
        api.nearbyTransports(token, storeId, {
          address: mode === "ADDRESS" ? address.trim() : null,
          postalCode: saved.entity.postalCode,
          point,
          radiusMetres,
          ...(candidateId ? { candidateId } : {}),
        }),
      );
      if (!alive.current || id !== generation.current) return;
      if (next.storeId !== storeId) throw Error("Portée invalide");
      setResult(next);
    } catch (e) {
      if (alive.current && id === generation.current)
        setError(
          e instanceof Error
            ? e.message
            : "La recherche est indisponible. Ta sélection enregistrée reste conservée.",
        );
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function save() {
    if (!canManage || locked.current || !saved || !result?.location) return;
    const parsed = storeTransportsSchema.safeParse({
      city: saved.entity.city,
      postalCode: saved.entity.postalCode,
      address: mode === "ADDRESS" ? address.trim() : null,
      location: result.location,
      radiusMetres: Number(radius),
      lines: result.lines,
      detectedAt: result.retrievedAt,
      partial: result.partial,
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? "Vérifie les lignes choisies.",
      );
      return;
    }
    locked.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await repo.save(
        {
          ...saved.entity,
          transports: parsed.data,
          version:
            (saved.syncState === "ERROR"
              ? (saved.remoteVersion ?? 0)
              : saved.entity.version) + 1,
          updatedAt: new Date().toISOString(),
        },
        { commandId: randomUUID(), deviceId },
        saved.entity,
      );
      const next = await repo.get(storeId);
      if (!alive.current) return;
      hydrate(next);
      setNotice(
        "Sélection enregistrée sur cet appareil. Elle sera transmise à ton magasin lors de la synchronisation.",
      );
      void syncNow(storeId).catch(() => undefined);
    } catch {
      if (alive.current)
        setError(
          "Les réglages ont changé ou sont en conflit. Ta saisie est conservée ; relis les réglages du magasin avant de recommencer.",
        );
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const disabled = !canManage || busy || !saved,
    selected = result?.lines.filter((l) => l.enabled).length ?? 0;
  return (
    <AppScreen>
      <AppHeader
        title="Transports à proximité"
        subtitle="Les lignes utiles autour de ton magasin."
      />
      <SecondaryButton
        label="Retour au magasin"
        onPress={() => router.back()}
      />
      {error ? <InlineAlert title="Transports" message={error} /> : null}
      {notice ? <InlineAlert title="Magasin" message={notice} /> : null}
      {!saved ? (
        <Text className="text-muted">
          {saved === undefined
            ? "Lecture des réglages…"
            : "Enregistre d’abord la commune et le code postal dans Mon magasin."}
        </Text>
      ) : (
        <>
          <SectionCard title="Point de départ">
            <Text className="text-sm text-muted">
              {(
                {
                  SYNCED: "Synchronisé",
                  PENDING: "À synchroniser",
                  CONFLICT: "Conflit à résoudre",
                  ERROR: "Envoi refusé · réglages locaux conservés",
                } as Record<string, string>
              )[saved.syncState] ?? saved.syncState}
            </Text>
            <Text className="text-muted">
              {saved.entity.city} · {saved.entity.postalCode}. Cette
              localisation reste fixe ; aucun suivi de tes déplacements.
            </Text>
            <SegmentedControl
              label="Localisation des transports du magasin"
              value={mode}
              onChange={(v) => change(() => setMode(v as typeof mode))}
              options={[
                { value: "ADDRESS", label: "Adresse" },
                { value: "STORE_GPS", label: "Position enregistrée" },
              ]}
              disabled={disabled}
            />
            {mode === "ADDRESS" ? (
              <TextInput
                accessibilityLabel="Adresse du magasin"
                value={address}
                onChangeText={(v) => change(() => setAddress(v))}
                editable={!disabled}
                maxLength={240}
                placeholder="Numéro et nom de rue"
                className="rounded-xl border border-line p-3 text-ink"
              />
            ) : (
              <Text className="text-muted">
                {saved.entity.position
                  ? "La position précise enregistrée dans Mon magasin sera utilisée."
                  : "Aucune position précise enregistrée. Utilise une adresse ou relève la position depuis Mon magasin."}
              </Text>
            )}
            <Text className="text-muted">
              Rayon autour du magasin, à vol d’oiseau
            </Text>
            <TextInput
              accessibilityLabel="Rayon de recherche en mètres"
              value={radius}
              onChangeText={(v) => change(() => setRadius(v))}
              keyboardType="number-pad"
              editable={!disabled}
              maxLength={4}
              className="rounded-xl border border-line p-3 text-ink"
            />
            <Text className="text-sm text-muted">
              De 200 à 2 000 mètres. 800 m est proposé par défaut.
            </Text>
            <SecondaryButton
              label={busy ? "Recherche…" : "Rechercher les arrêts et lignes"}
              disabled={
                disabled ||
                (mode === "ADDRESS" && !address.trim()) ||
                (mode === "STORE_GPS" && !saved.entity.position)
              }
              onPress={() => void search()}
            />
          </SectionCard>
          {result && !result.location ? (
            <SectionCard title="Choisis l’adresse du magasin">
              {result.candidates.length ? (
                result.candidates.map((c) => (
                  <SecondaryButton
                    key={c.id}
                    label={c.label}
                    disabled={busy || !canManage}
                    onPress={() => void search(c.id)}
                  />
                ))
              ) : (
                <Text className="text-muted">
                  Aucune adresse suffisamment précise n’a été retrouvée. Ajoute
                  le numéro et le nom de rue ; le centre de la commune ne sera
                  pas utilisé.
                </Text>
              )}
            </SectionCard>
          ) : null}
          {result?.location ? (
            <SectionCard title="Lignes détectées">
              <Text className="text-ink">{result.location.label}</Text>
              <Text className="text-muted">
                {selected} ligne{selected > 1 ? "s" : ""} suivie
                {selected > 1 ? "s" : ""} · maximum 16. L’arrêt le plus proche
                est indiqué pour chaque ligne.
              </Text>
              {result.partial ? (
                <Text className="text-warning">
                  La liste est partielle. Réduis le rayon pour affiner les
                  résultats.
                </Text>
              ) : null}
              {!result.lines.length ? (
                <Text className="text-muted">
                  Aucune ligne retrouvée dans ce rayon.
                </Text>
              ) : null}
              {result.lines.map((line) => (
                <View
                  key={line.id}
                  className="flex-row items-center gap-3 border-b border-line py-3"
                >
                  <View className="flex-1 gap-1">
                    <Text className="font-semibold text-ink">
                      {line.mode} {line.name}
                    </Text>
                    <Text className="text-muted">
                      {line.stopName} · {line.distanceMetres} m
                    </Text>
                  </View>
                  <Switch
                    accessibilityLabel={`Suivre ${line.mode} ${line.name}`}
                    value={line.enabled}
                    disabled={disabled || (!line.enabled && selected >= 16)}
                    onValueChange={(enabled) =>
                      setResult((previous) => {
                        if (
                          !previous ||
                          (enabled &&
                            previous.lines.filter((l) => l.enabled).length >=
                              16)
                        )
                          return previous;
                        return {
                          ...previous,
                          lines: previous.lines.map((l) =>
                            l.id === line.id ? { ...l, enabled } : l,
                          ),
                        };
                      })
                    }
                  />
                </View>
              ))}
              <Text className="text-sm text-muted">
                Source : Île-de-France Mobilités. La proximité d’une ligne ne
                prouve pas son effet sur la fréquentation du magasin.
              </Text>
              <PrimaryButton
                label={busy ? "En cours…" : "Enregistrer la sélection"}
                disabled={disabled || !dirty || saved.syncState === "CONFLICT"}
                onPress={() => void save()}
              />
            </SectionCard>
          ) : null}
          {dirty ? (
            <Text className="text-warning">Modifications non enregistrées</Text>
          ) : null}
          {saved.syncState === "CONFLICT" ? (
            <SecondaryButton
              label="Résoudre le conflit dans Synchronisation"
              onPress={() => router.push("/sync-center")}
            />
          ) : null}
          <Text className="text-sm text-muted">
            La clé PRIM reste privée sur le serveur. Après synchronisation, le
            Journal utilise les lignes enregistrées ; aucun appel IA n’est
            nécessaire pour récupérer le trafic.
          </Text>
        </>
      )}
    </AppScreen>
  );
}
