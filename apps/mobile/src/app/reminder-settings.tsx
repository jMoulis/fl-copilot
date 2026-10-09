import { useCallback, useMemo, useState } from "react";
import { Linking, Switch, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import {
  randomUUID,
  digestStringAsync,
  CryptoDigestAlgorithm,
} from "expo-crypto";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import {
  ReminderRepository,
  subscribeReminderSnapshots,
} from "@/reminders/repository";
import { useReminders } from "@/reminders/provider";
import {
  requestReminderPermission,
  notificationModule,
} from "@/reminders/native";
import {
  AppScreen,
  AppHeader,
  SectionCard,
  SecondaryButton,
  InlineAlert,
} from "@/components/ui";
import { formatFrenchCalendarDate } from "@/dates/calendar";
import { reminderStatusLabel } from "@/reminders/presentation";
export default function ReminderSettings() {
  const { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    { sqlite } = useLocalDatabase(),
    { refresh, error: runtimeError, available } = useReminders();
  const repo = useMemo(
    () =>
      new ReminderRepository(sqlite, (s) =>
        digestStringAsync(CryptoDigestAlgorithm.SHA256, s),
      ),
    [sqlite],
  );
  const [enabled, setEnabled] = useState(false),
    [rows, setRows] = useState<Awaited<ReturnType<ReminderRepository["list"]>>>(
      [],
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [message, setMessage] = useState<string>();
  const load = useCallback(async () => {
    if (storeId) {
      setEnabled(await repo.preferences(storeId));
      setRows(await repo.list(storeId));
    }
  }, [repo, storeId]);
  useFocusEffect(
    useCallback(() => {
      const read = () =>
        void load().catch(() =>
          setError("Les réglages locaux ne peuvent pas être lus."),
        );
      read();
      return subscribeReminderSnapshots(read);
    }, [load]),
  );
  async function toggle(value: boolean) {
    if (!storeId || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (value && !(await requestReminderPermission()))
        throw Error(
          "Notifications refusées. Autorisez-les dans les réglages du téléphone, puis activez les rappels.",
        );
      await repo.setEnabled(
        storeId,
        value,
        randomUUID(),
        new Date().toISOString(),
      );
      await refresh();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Réglage impossible.");
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    if (!storeId || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (!(await requestReminderPermission()))
        throw Error(
          "Autorisez les notifications dans les réglages du téléphone.",
        );
      const n = await notificationModule();
      if (!n) throw Error("Installez le nouveau build.");
      await n.scheduleNotificationAsync({
        identifier: `fl-reminder-test-${storeId}`,
        content: {
          title: "Test de rappel",
          body: "Votre rappel local fonctionne. Vous pouvez laisser le téléphone hors connexion.",
          sound: "default",
          data: { kind: "COMMERCIAL_REMINDER_TEST", storeId },
        },
        trigger: {
          type: n.SchedulableTriggerInputTypes.DATE,
          date: new Date(Date.now() + 60000),
          channelId: "commercial-reminders",
        },
      });
      setMessage(
        "Rappel de test programmé dans une minute. Verrouillez le téléphone, éventuellement en mode avion.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test indisponible.");
    } finally {
      setBusy(false);
    }
  }
  if (!storeId)
    return (
      <AppScreen>
        <AppHeader title="Rappels" />
        <SecondaryButton
          label="Se connecter"
          onPress={() => router.replace("/login")}
        />
      </AppScreen>
    );
  return (
    <AppScreen>
      <AppHeader
        title="Rappels sur ce téléphone"
        subtitle="Des rappels locaux, même hors connexion."
      />
      <SecondaryButton label="Retour à Plus" onPress={() => router.back()} />
      <SectionCard title="Notifications commerciales">
        <View className="flex-row items-center justify-between gap-3">
          <Text className="flex-1 text-base text-ink">
            Activer les rappels choisis pour mes opérations
          </Text>
          <Switch
            accessibilityLabel="Activer les rappels commerciaux sur ce téléphone"
            value={enabled}
            disabled={busy || !available}
            onValueChange={(v) => void toggle(v)}
          />
        </View>
        <Text className="text-muted">
          Choisissez chaque rappel depuis une opération de votre plan
          synchronisé. Les réglages et horaires sont propres à ce téléphone et
          ne se synchronisent pas entre appareils.
        </Text>
        <Text className="text-muted">
          La date et l’heure utilisent le fuseau du magasin : Europe/Paris. Le
          système du téléphone peut retarder ou masquer une alerte selon ses
          réglages.
        </Text>
        {!available ? (
          <InlineAlert
            title="Build à mettre à jour"
            message="Cette version n’inclut pas encore le module natif des notifications. Le plan reste accessible."
          />
        ) : null}
        <SecondaryButton
          label="Ouvrir les réglages du téléphone"
          onPress={() =>
            void Linking.openSettings().catch(() =>
              setError(
                "Les réglages du téléphone ne peuvent pas être ouverts.",
              ),
            )
          }
        />
        <SecondaryButton
          label="Tester un rappel dans une minute"
          disabled={busy || !available}
          onPress={() => void test()}
        />
        <SecondaryButton
          label="Vérifier les rappels programmés"
          disabled={busy}
          onPress={() => {
            setBusy(true);
            void refresh()
              .then(load)
              .finally(() => setBusy(false));
          }}
        />
      </SectionCard>
      {message ? (
        <InlineAlert title="Test programmé" message={message} />
      ) : null}
      {error || runtimeError ? (
        <InlineAlert
          title="Rappels à vérifier"
          message={error ?? runtimeError!}
        />
      ) : null}
      <SectionCard title="Mes rappels">
        {rows.length ? (
          rows.map(({ reminder: r, status }) => (
            <View key={r.id} className="gap-2">
              <Text className="text-base text-ink">
                Démarrage prévu le {formatFrenchCalendarDate(r.deadlineDate)}
              </Text>
              <Text className="text-muted">
                Rappel :{" "}
                {new Date(r.fireAt).toLocaleString("fr-FR", {
                  timeZone: "Europe/Paris",
                })}{" "}
                · {reminderStatusLabel(status)}
              </Text>
              <SecondaryButton
                label="Ouvrir l’opération et modifier le rappel"
                onPress={() =>
                  router.push({
                    pathname: "/commercial-operation/[id]",
                    params: {
                      id: r.operationId,
                      weekStart: r.weekStart,
                      reminderRevision: r.planRevisionId,
                    },
                  })
                }
              />
              <SecondaryButton
                label="Désactiver ce rappel"
                disabled={busy || !r.enabled}
                onPress={() => {
                  setBusy(true);
                  void repo
                    .save(
                      {
                        ...r,
                        enabled: false,
                        version: r.version + 1,
                        updatedAt: new Date().toISOString(),
                      },
                      randomUUID(),
                    )
                    .then(refresh)
                    .then(load)
                    .catch(() =>
                      setError(
                        "Le rappel n’a pas pu être désactivé. Réessayez.",
                      ),
                    )
                    .finally(() => setBusy(false));
                }}
              />
            </View>
          ))
        ) : (
          <Text className="text-muted">
            Aucun rappel choisi. Ouvrez une opération du plan de semaine pour en
            programmer un.
          </Text>
        )}
      </SectionCard>
    </AppScreen>
  );
}
