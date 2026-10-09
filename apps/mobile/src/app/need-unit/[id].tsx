import { useCallback, useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { randomUUID } from "expo-crypto";
import {
  needUnitSchema,
  normalizeNeedUnitCode,
  type NeedUnit,
} from "@fl-copilot/domain";
import { useAuth } from "@/auth/auth-provider";
import { useSync } from "@/sync/sync-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { NeedUnitRepository, type LocalNeedUnit } from "@/needs/repository";
import { needUnitError } from "@/needs/presentation";
import {
  AppScreen,
  AppHeader,
  PrimaryButton,
  SecondaryButton,
  InlineAlert,
  SectionCard,
} from "@/components/ui";
export default function NeedUnitScreen() {
  const params = useLocalSearchParams<{ id: string }>(),
    { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync();
  const repo = useMemo(() => new NeedUnitRepository(sqlite), [sqlite]),
    [id] = useState(() => (params.id === "new" ? randomUUID() : params.id)),
    [record, setRecord] = useState<LocalNeedUnit | null | undefined>(
      params.id === "new" ? null : undefined,
    ),
    [name, setName] = useState(""),
    [code, setCode] = useState(""),
    [manualCode, setManualCode] = useState(false),
    [description, setDescription] = useState(""),
    [status, setStatus] = useState<NeedUnit["status"]>("ACTIVE"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [issues, setIssues] = useState<Record<string, string>>({}),
    [message, setMessage] = useState<string>();
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (storeId && params.id !== "new")
        void repo
          .get(storeId, id)
          .then((v) => {
            if (alive) {
              setRecord(v);
              if (v) {
                setName(v.entity.name);
                setCode(v.entity.code);
                setDescription(v.entity.description ?? "");
                setStatus(v.entity.status);
                setMessage(undefined);
                setManualCode(true);
              }
            }
          })
          .catch(() => {
            if (alive) setError("Cette unité ne peut pas être lue.");
          });
      return () => {
        alive = false;
      };
    }, [repo, storeId, id, params.id]),
  );
  async function save() {
    if (!storeId || busy) return;
    setBusy(true);
    setError(undefined);
    setIssues({});
    setMessage(undefined);
    try {
      const now = new Date().toISOString(),
        old = record?.entity,
        version =
          record?.syncState === "ERROR"
            ? (record.remoteVersion ?? 0) + 1
            : (old?.version ?? 0) + 1;
      const parsed = needUnitSchema.safeParse({
        id,
        storeId,
        code: code.trim(),
        name: name.trim(),
        description: description.trim() || null,
        status,
        createdBy: old?.createdBy ?? "USER",
        version,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
      });
      if (!parsed.success) {
        setIssues(
          Object.fromEntries(
            parsed.error.issues.map((i) => [String(i.path[0]), i.message]),
          ),
        );
        throw Error("Vérifiez les champs signalés.");
      }
      await repo.save(parsed.data, { commandId: randomUUID(), deviceId });
      setRecord(await repo.get(storeId, id));
      setMessage("Besoin enregistré sur cet appareil.");
      void syncNow(storeId)
        .then(async () => {
          const v = await repo.get(storeId, id);
          if (v?.entity.version === parsed.data.version) setRecord(v);
        })
        .catch(() => undefined);
    } catch (e) {
      setError(
        e instanceof Error && e.message.startsWith("NEED_UNIT_")
          ? needUnitError(e.message)
          : e instanceof Error
            ? e.message
            : "Enregistrement impossible.",
      );
    } finally {
      setBusy(false);
    }
  }
  const canCode =
    !record || (record.syncState === "ERROR" && record.remoteVersion === null);
  if (!storeId || (record && record.entity.storeId !== storeId))
    return (
      <AppScreen>
        <AppHeader title="Unité de besoin" />
        <SecondaryButton
          label="Retour au catalogue"
          onPress={() => router.replace("/need-units")}
        />
        <Text className="text-muted">
          Cette unité n’est pas disponible dans la session actuelle.
        </Text>
      </AppScreen>
    );
  return (
    <AppScreen>
      <AppHeader
        title={
          params.id === "new" && !record
            ? "Créer un besoin client"
            : "Unité de besoin"
        }
      />
      <SecondaryButton
        label="Retour au catalogue"
        onPress={() => router.replace("/need-units")}
      />
      {record === undefined ? (
        <Text className="text-muted">Lecture locale…</Text>
      ) : params.id !== "new" && record === null ? (
        <Text className="text-muted">
          Cette unité n’existe pas dans le magasin actuel.
        </Text>
      ) : (
        <SectionCard title="Usage du client">
          {record?.syncState === "ERROR" ? (
            <InlineAlert
              title="Correction nécessaire"
              message={needUnitError(record.lastErrorCode ?? undefined)}
            />
          ) : null}
          {record?.syncState === "CONFLICT" ? (
            <>
              <InlineAlert
                title="Deux versions à comparer"
                message="Votre modification est conservée. Choisissez une résolution dans Synchronisation."
              />
              <SecondaryButton
                label="Comparer les versions"
                onPress={() => router.push("/sync-center")}
              />
            </>
          ) : null}
          <Text className="text-ink">Nom du besoin</Text>
          <TextInput
            accessibilityLabel="Nom du besoin client"
            editable={!busy}
            value={name}
            onChangeText={(v) => {
              setMessage(undefined);
              setName(v);
              if (canCode && !manualCode) setCode(normalizeNeedUnitCode(v));
            }}
            className={`rounded-xl border p-3 text-ink ${issues.name ? "border-danger" : "border-line"}`}
          />
          {issues.name ? (
            <Text accessibilityRole="alert" className="text-danger">
              Saisissez un nom de 1 à 120 caractères.
            </Text>
          ) : null}
          <Text className="text-ink">Code interne</Text>
          <TextInput
            accessibilityLabel="Code interne du besoin client"
            editable={canCode && !busy}
            autoCapitalize="characters"
            value={code}
            onChangeText={(v) => {
              setMessage(undefined);
              setManualCode(true);
              setCode(normalizeNeedUnitCode(v));
            }}
            className={`rounded-xl border p-3 text-ink ${issues.code ? "border-danger" : "border-line"}`}
          />
          <Text className="text-muted">
            Ce repère unique est conservé après synchronisation.
          </Text>
          {issues.code ? (
            <Text accessibilityRole="alert" className="text-danger">
              Saisissez un code de 1 à 60 caractères : lettres, chiffres et
              traits bas.
            </Text>
          ) : null}
          <Text className="text-ink">Description facultative</Text>
          <TextInput
            accessibilityLabel="Description du besoin client"
            value={description}
            onChangeText={(v) => {
              setDescription(v);
              setMessage(undefined);
            }}
            editable={!busy}
            multiline
            className={`rounded-xl border p-3 text-ink ${issues.description ? "border-danger" : "border-line"}`}
          />
          {issues.description ? (
            <Text accessibilityRole="alert" className="text-danger">
              Limitez la description à 1 200 caractères.
            </Text>
          ) : null}
          <Text className="text-ink">État</Text>
          <View className="gap-2">
            {(["ACTIVE", "TO_REVIEW", "INACTIVE"] as const).map((s) => (
              <SecondaryButton
                key={s}
                label={`${status === s ? "✓ " : ""}${{ ACTIVE: "Active", TO_REVIEW: "À revoir", INACTIVE: "Désactivée" }[s]}`}
                disabled={busy}
                onPress={() => {
                  setStatus(s);
                  setMessage(undefined);
                }}
              />
            ))}
          </View>
          <Text className="text-muted">
            Désactiver conserve cette unité et son historique.
          </Text>
          <PrimaryButton
            label={busy ? "Enregistrement…" : "Enregistrer le besoin"}
            disabled={busy || !storeId || record?.syncState === "CONFLICT"}
            onPress={() => void save()}
          />
        </SectionCard>
      )}
      {error ? (
        <InlineAlert title="Enregistrement impossible" message={error} />
      ) : null}
      {message ? (
        <Text className="text-muted">
          {message}{" "}
          {record?.syncState === "SYNCED" ? "Synchronisé." : "À synchroniser."}
        </Text>
      ) : null}
    </AppScreen>
  );
}
