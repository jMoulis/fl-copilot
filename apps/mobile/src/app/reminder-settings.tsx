import { useCallback, useMemo, useRef, useState } from "react";
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
type ReminderContext = {
  scope: object;
  current(): boolean;
  check(): void;
  load(): Promise<void>;
};
export default function ReminderSettings() {
  const { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    { sqlite, deviceId } = useLocalDatabase(),
    { refresh, error: runtimeError, available } = useReminders();
  const ownerId = session?.user.id,
    scope = useMemo(
      () => ({ ownerId, storeId, sqlite, deviceId }),
      [ownerId, storeId, sqlite, deviceId],
    ),
    currentScope = useRef(scope),
    activeContext = useRef<ReminderContext | undefined>(undefined),
    locked = useRef<ReminderContext | undefined>(undefined);
  currentScope.current = scope;
  const repo = useMemo(
    () =>
      new ReminderRepository(sqlite, (s) =>
        digestStringAsync(CryptoDigestAlgorithm.SHA256, s),
      ),
    [sqlite],
  );
  const [context, setContext] = useState<ReminderContext>(),
    [snapshot, setSnapshot] = useState<{
      scope: object;
      enabled: boolean;
      rows: Awaited<ReturnType<ReminderRepository["list"]>>;
    }>(),
    [saving, setSaving] = useState<ReminderContext>(),
    [feedback, setFeedback] = useState<{
      scope: object;
      error?: string;
      message?: string;
    }>();
  const ownSnapshot = snapshot?.scope === scope ? snapshot : undefined,
    enabled = ownSnapshot?.enabled ?? false,
    rows = ownSnapshot?.rows ?? [],
    busy = saving?.scope === scope,
    error = feedback?.scope === scope ? feedback.error : undefined,
    message = feedback?.scope === scope ? feedback.message : undefined,
    ready = context?.scope === scope && context.current();
  useFocusEffect(
    useCallback(() => {
      if (!scope.storeId || !scope.ownerId) return;
      let active = true,
        revision = 0;
      const current = () => active && currentScope.current === scope;
      const next: ReminderContext = {
        scope,
        current,
        check: () => {
          if (!current()) throw Error("REMINDER_CONTEXT_CHANGED");
        },
        load: async () => {
          if (!current()) return;
          const ticket = ++revision;
          try {
            const [value, entries] = await Promise.all([
              repo.preferences(scope.storeId!),
              repo.list(scope.storeId!),
            ]);
            if (current() && ticket === revision) {
              setSnapshot({ scope, enabled: value, rows: entries });
              setFeedback((old) =>
                old?.scope === scope ? { ...old, error: undefined } : old,
              );
            }
          } catch (caught) {
            if (current() && ticket === revision)
              setFeedback({
                scope,
                error:
                  "Les rappels locaux ne peuvent pas être relus. Les réglages déjà affichés sont conservés.",
              });
            throw caught;
          }
        },
      };
      activeContext.current = next;
      setContext(next);
      setSaving(undefined);
      setFeedback({ scope });
      const read = () => void next.load().catch(() => {});
      read();
      const unsubscribe = subscribeReminderSnapshots(read);
      return () => {
        active = false;
        revision++;
        unsubscribe();
        if (activeContext.current === next) activeContext.current = undefined;
      };
    }, [repo, scope]),
  );
  async function run(
    action: (review: ReminderContext) => Promise<void>,
    failure: string,
  ) {
    const review = context;
    if (
      !review ||
      review.scope !== scope ||
      activeContext.current !== review ||
      !review.current() ||
      locked.current === review
    )
      return;
    locked.current = review;
    setSaving(review);
    setFeedback({ scope });
    try {
      await action(review);
      review.check();
      await review.load();
    } catch (caught) {
      if (review.current())
        setFeedback({
          scope,
          error:
            caught instanceof Error && caught.message.startsWith("Autorisez")
              ? caught.message
              : failure,
        });
    } finally {
      if (review.current()) setSaving(undefined);
      if (locked.current === review) locked.current = undefined;
    }
  }
  function toggle(value: boolean) {
    return run(async (review) => {
      if (value) {
        const granted = await requestReminderPermission();
        review.check();
        if (!granted)
          throw Error(
            "Autorisez les notifications dans les réglages du téléphone, puis activez les rappels.",
          );
      }
      review.check();
      await repo.setEnabled(
        storeId!,
        value,
        randomUUID(),
        new Date().toISOString(),
        review.check,
      );
      review.check();
      await refresh();
    }, "Les réglages des rappels sont à vérifier. Les intentions enregistrées sont conservées.");
  }
  function test() {
    return run(async (review) => {
      const granted = await requestReminderPermission();
      review.check();
      if (!granted)
        throw Error(
          "Autorisez les notifications dans les réglages du téléphone.",
        );
      const n = await notificationModule();
      review.check();
      if (!n) throw Error("NOTIFICATIONS_UNAVAILABLE");
      const identifier = `fl-reminder-test-${storeId}-${randomUUID()}`;
      try {
        await n.scheduleNotificationAsync({
          identifier,
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
      } finally {
        if (!review.current())
          await n.cancelScheduledNotificationAsync(identifier);
      }
      review.check();
      setFeedback({
        scope,
        message:
          "Rappel de test programmé dans une minute. Verrouillez le téléphone, éventuellement en mode avion.",
      });
    }, "Le rappel de test n’a pas pu être vérifié. Réessayez depuis cet écran.");
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
            disabled={busy || !available || !ready || !ownSnapshot}
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
          disabled={busy || !ready}
          onPress={() =>
            void run(async () => {
              await Linking.openSettings();
            }, "Les réglages du téléphone ne peuvent pas être ouverts.")
          }
        />
        <SecondaryButton
          label="Tester un rappel dans une minute"
          disabled={busy || !available || !ready}
          onPress={() => void test()}
        />
        <SecondaryButton
          label="Vérifier les rappels programmés"
          disabled={busy || !ready}
          onPress={() => {
            void run(async () => {
              await refresh();
            }, "La vérification des rappels n’a pas abouti. Les réglages enregistrés sont conservés.");
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
                onPress={() => {
                  if (!context || context.scope !== scope || !context.current())
                    return;
                  router.push({
                    pathname: "/commercial-operation/[id]",
                    params: {
                      id: r.operationId,
                      weekStart: r.weekStart,
                      reminderRevision: r.planRevisionId,
                    },
                  });
                }}
              />
              <SecondaryButton
                label="Désactiver ce rappel"
                disabled={busy || !r.enabled || !ready}
                onPress={() => {
                  void run(async (review) => {
                    review.check();
                    await repo.save(
                      {
                        ...r,
                        enabled: false,
                        version: r.version + 1,
                        updatedAt: new Date().toISOString(),
                      },
                      randomUUID(),
                      review.check,
                    );
                    review.check();
                    await refresh();
                  }, "La désactivation du rappel est à vérifier. Son intention locale est conservée.");
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
