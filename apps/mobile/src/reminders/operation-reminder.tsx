import { useCallback, useMemo, useRef, useState } from "react";
import { Text, TextInput } from "react-native";
import { router, useFocusEffect } from "expo-router";
import {
  randomUUID,
  digestStringAsync,
  CryptoDigestAlgorithm,
} from "expo-crypto";
import { commercialExecutionPlanChecksum } from "@fl-copilot/commercial-core";
import {
  reminderInstant,
  proposedReminderDate,
  parisDate,
  type CommercialWeekPlan,
} from "@fl-copilot/domain";
import { useLocalDatabase } from "@/providers/database-provider";
import { DateSelector } from "@/components/date-selector";
import {
  SectionCard,
  PrimaryButton,
  SecondaryButton,
  InlineAlert,
} from "@/components/ui";
import { useReminders } from "./provider";
import { ReminderRepository, subscribeReminderSnapshots } from "./repository";
import { reminderStatusLabel } from "./presentation";
export function OperationReminder({
  plan,
  operationId,
  allowed,
}: {
  plan: CommercialWeekPlan;
  operationId: string;
  allowed: boolean;
}) {
  const op = plan.operations.find((o) => o.id === operationId)!,
    { sqlite } = useLocalDatabase(),
    { refresh, available, error: runtimeError } = useReminders();
  const repo = useMemo(
    () =>
      new ReminderRepository(sqlite, (s) =>
        digestStringAsync(CryptoDigestAlgorithm.SHA256, s),
      ),
    [sqlite],
  );
  const [existing, setExisting] = useState<
      Awaited<ReturnType<ReminderRepository["list"]>>[number] | null
    >(null),
    [date, setDate] = useState(() => proposedReminderDate(op.plannedStart)),
    [time, setTime] = useState("09:00"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [enabled, setEnabled] = useState(false),
    [saved, setSaved] = useState(false);
  const initialized = useRef(false);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const load = async () => {
        const row =
            (await repo.list(plan.storeId)).find(
              (r) => r.reminder.operationId === operationId,
            ) ?? null,
          pref = await repo.preferences(plan.storeId);
        if (active) {
          if (!initialized.current) {
            initialized.current = true;
            if (row) {
              setDate(parisDate(row.reminder.fireAt));
              setTime(
                new Date(row.reminder.fireAt).toLocaleTimeString("en-GB", {
                  timeZone: "Europe/Paris",
                  hour: "2-digit",
                  minute: "2-digit",
                  hourCycle: "h23",
                }),
              );
            }
          }
          setExisting(row);
          setEnabled(pref);
        }
      };
      const read = () =>
        void load().catch(() => {
          if (active) setError("Le rappel local ne peut pas être lu.");
        });
      read();
      const unsubscribe = subscribeReminderSnapshots(read);
      return () => {
        unsubscribe();
        active = false;
      };
    }, [repo, plan.storeId, operationId]),
  );
  async function save() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const fireAt = reminderInstant(date, time);
      if (fireAt <= new Date().toISOString())
        throw Error("Choisissez une date et une heure à venir.");
      const now = new Date().toISOString(),
        old = existing?.reminder;
      await repo.save(
        {
          id: old?.id ?? randomUUID(),
          storeId: plan.storeId,
          planId: plan.id,
          planRevisionId: plan.revisionId,
          planChecksum: await commercialExecutionPlanChecksum(plan, (s) =>
            digestStringAsync(CryptoDigestAlgorithm.SHA256, s),
          ),
          operationId,
          weekStart: plan.weekStart,
          deadlineDate: op.plannedStart,
          fireAt,
          enabled: true,
          version: (old?.version ?? 0) + 1,
          createdAt: old?.createdAt ?? now,
          updatedAt: now,
        },
        randomUUID(),
      );
      await refresh();
      setExisting(
        (await repo.list(plan.storeId)).find(
          (r) => r.reminder.operationId === operationId,
        ) ?? null,
      );
      setSaved(true);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Le rappel ne peut pas être enregistré.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <SectionCard title="Rappel du démarrage prévu">
      <Text className="text-muted">
        Choisissez quand vous souhaitez être alerté. Ce rappel ne confirme ni
        l’installation ni une commande.
      </Text>
      <SecondaryButton
        label="Réglages des rappels sur ce téléphone"
        onPress={() => router.push("/reminder-settings")}
      />
      {!enabled ? (
        <Text className="text-muted">
          Activez les rappels sur ce téléphone dans les réglages.
        </Text>
      ) : null}
      {existing ? (
        <Text className="text-muted">
          {new Date(existing.reminder.fireAt).toLocaleString("fr-FR", {
            timeZone: "Europe/Paris",
          })}{" "}
          · {reminderStatusLabel(existing.status)}
        </Text>
      ) : null}
      {!allowed ? (
        <InlineAlert
          title="Plan à vérifier"
          message="Synchronisez et vérifiez la version actuelle du plan avant de programmer un rappel."
        />
      ) : null}
      <DateSelector
        value={date}
        onConfirm={(v) => {
          setDate(v);
          setSaved(false);
        }}
      />
      <Text className="text-ink">Heure du magasin (06:00 à 21:59)</Text>
      <TextInput
        accessibilityLabel="Heure du rappel au format heures minutes"
        className="rounded-xl border border-line p-3 text-ink"
        value={time}
        placeholder="09:00"
        onChangeText={(v) => {
          setTime(v);
          setSaved(false);
        }}
      />
      <PrimaryButton
        label={busy ? "Programmation…" : "Enregistrer ce rappel"}
        disabled={busy || !available || !enabled || !allowed}
        onPress={() => void save()}
      />
      {runtimeError ? (
        <InlineAlert title="Programmation à vérifier" message={runtimeError} />
      ) : null}
      {error ? <InlineAlert title="Rappel impossible" message={error} /> : null}
      {saved ? (
        <Text className="text-muted">
          Le rappel est conservé sur ce téléphone. Son état de programmation est
          affiché ci-dessus.
        </Text>
      ) : null}
    </SectionCard>
  );
}
