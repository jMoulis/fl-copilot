import { formatFrenchCalendarDate } from "../dates/calendar";
import { storeEventTimeLabel } from "@fl-copilot/domain";
import { DateSelector } from "../components/date-selector";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Switch,
  Alert,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  randomUUID,
  digestStringAsync,
  CryptoDigestAlgorithm,
} from "expo-crypto";
import {
  personalTaskFieldsSchema,
  personalTaskInstant,
  storeEventTimeCandidates,
  type PersonalTask,
  type PersonalTaskFields,
} from "@fl-copilot/domain";
import {
  commercialExecutionChecklist,
  commercialExecutionSameTarget,
  currentCommercialWeek,
  type CommercialExecutionProposal,
} from "@fl-copilot/commercial-core";
import {
  BottomSheet,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
} from "../components/ui";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import { subscribeOutboxChanges } from "../sync/outbox-repository";
import { useReminders } from "../reminders/provider";
import { requestReminderPermission } from "../reminders/native";
import { CommercialPlanRepository } from "../commercial/week-plan-repository";
import { CommercialExecutionRepository } from "../commercial/execution-repository";
import {
  personalReminderSetting,
  type PersonalReminderState,
} from "./personal-task-reminders";
import {
  PersonalTaskRepository,
  type PersonalScope,
  type LocalPersonalTask,
} from "./personal-task-repository";
import { journalColors as c } from "./journal-theme";
const digest = (s: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, s);
const taskStatus = {
  TODO: "À faire",
  DONE: "Fait",
  CANCELLED: "Annulé",
} as const;
const reminderStatus: Record<PersonalReminderState, string> = {
  OFF: "Sans rappel",
  SCHEDULED: "Rappel activé sur cet appareil",
  PERMISSION_DENIED:
    "Pense-bête enregistré. Autorise les notifications dans les réglages de l’iPhone pour recevoir le rappel.",
  NOT_AVAILABLE:
    "Pense-bête enregistré. Les rappels ne sont pas disponibles dans ce build.",
  PAST: "Pense-bête enregistré. L’heure est passée : aucun rappel à venir.",
  FAILED:
    "Pense-bête enregistré. Le rappel n’a pas pu être programmé. Réessaie depuis Modifier.",
  LIMIT:
    "Pense-bête enregistré. La limite de rappels sur cet appareil est atteinte.",
  CONFLICT: "Rappel suspendu : compare les versions de ce pense-bête.",
};
type CommercialRow = {
  kind: "commercial";
  proposal: CommercialExecutionProposal;
  weekStart: string;
  status: "TODO" | "DONE" | "SKIPPED" | "NOT_APPLICABLE";
};
type PersonalRow = { kind: "personal"; record: LocalPersonalTask };
type DailyRow = CommercialRow | PersonalRow;
const fields = (t: PersonalTask): PersonalTaskFields => ({
  text: t.text,
  date: t.date,
  time: t.time,
  status: t.status,
});
export function DailyTaskList({
  scope,
  date,
  today,
  openTaskId,
  onTaskOpened,
}: {
  scope: PersonalScope;
  date: string;
  today: string;
  openTaskId?: string;
  onTaskOpened: () => void;
}) {
  const { sqlite, deviceId } = useLocalDatabase(),
    { lastSyncedAt, syncNow } = useSync(),
    reminders = useReminders();
  const repo = useMemo(
    () => new PersonalTaskRepository(sqlite, scope),
    [sqlite, scope],
  );
  const focused = useRef(false),
    active = useRef(true),
    readGeneration = useRef(0),
    locked = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const [listHeight, setListHeight] = useState(132);
  const [failedDate, setFailedDate] = useState<string>();
  const [rowDate, setRowDate] = useState<string>();
  const [rows, setRows] = useState<DailyRow[]>([]),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState<string>(),
    [notice, setNotice] = useState<string>(),
    [expanded, setExpanded] = useState(false),
    [history, setHistory] = useState(false);
  const [sheet, setSheet] = useState<{
      record: LocalPersonalTask | null;
      edit: boolean;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [review, setReview] =
      useState<Awaited<ReturnType<PersonalTaskRepository["review"]>>>(),
    [compared, setCompared] = useState(false);
  const draftAtOpen = useRef("");
  const [draft, setDraft] = useState({
    text: "",
    date,
    time: "16:00",
    hasTime: false,
    reminder: false,
  });
  const refresh = useCallback(async () => {
    const generation = ++readGeneration.current;
    try {
      const [personal, planResult] = await Promise.all([
        repo.list(date, today),
        new CommercialPlanRepository(sqlite, digest)
          .get(
            scope.storeId,
            currentCommercialWeek(new Date(`${date}T12:00:00Z`)).start,
          )
          .then((plan) => ({ plan, failed: false }))
          .catch(() => ({ plan: null, failed: true })),
      ]);
      const plan = planResult.plan;
      let commercialFailed = planResult.failed;
      let commercial: CommercialRow[] = [];
      if (plan)
        try {
          const [proposals, records] = await Promise.all([
            commercialExecutionChecklist(plan.entity, digest),
            new CommercialExecutionRepository(sqlite, digest).list(
              scope.storeId,
              plan.entity.revisionId,
            ),
          ]);
          commercial = proposals.map((proposal) => ({
            kind: "commercial",
            proposal,
            weekStart: plan.entity.weekStart,
            status:
              records.find((r) =>
                commercialExecutionSameTarget(r.entity, proposal),
              )?.entity.status ?? "TODO",
          }));
        } catch {
          commercialFailed = true;
        }
      const combined: DailyRow[] = [
        ...personal.map((record) => ({ kind: "personal" as const, record })),
        ...commercial,
      ];
      const rank = (r: DailyRow) =>
        r.kind === "commercial"
          ? 2
          : r.record.entity.date < date
            ? 0
            : r.record.entity.time
              ? 1
              : 3;
      combined.sort(
        (a, b) =>
          rank(a) - rank(b) ||
          (a.kind === "personal" && b.kind === "personal"
            ? a.record.entity.date.localeCompare(b.record.entity.date) ||
              (a.record.entity.time ?? "23:59").localeCompare(
                b.record.entity.time ?? "23:59",
              )
            : 0),
      );
      if (active.current && generation === readGeneration.current) {
        setRows(combined);
        setRowDate(date);
        setLoaded(true);
        setFailedDate(undefined);
        setError(
          commercialFailed
            ? "Les tâches du plan ne peuvent pas être lues. Tes pense-bêtes restent disponibles."
            : undefined,
        );
      }
    } catch {
      if (active.current && generation === readGeneration.current) {
        setFailedDate(date);
        setError(
          "La liste ne peut pas être lue. Tes pense-bêtes restent conservés.",
        );
      }
    }
  }, [date, today, repo, sqlite, scope.storeId]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void refresh();
      const unsubscribe = subscribeOutboxChanges(() => void refresh());
      return () => {
        focused.current = false;
        readGeneration.current++;
        unsubscribe();
      };
    }, [refresh]),
  );
  useEffect(() => {
    if (lastSyncedAt && focused.current) void refresh();
  }, [lastSyncedAt, refresh]);
  useEffect(() => {
    setExpanded(false);
    setHistory(false);
  }, [date]);
  const open = useCallback(
    async (id: string) => {
      try {
        const record = await repo.get(id);
        if (!active.current) return;
        if (!record) {
          setError("Ce pense-bête n’est pas disponible sur cet appareil.");
          return;
        }
        setSheet({ record, edit: false });
        setReview(undefined);
        setCompared(false);
        setNotice(undefined);
        if (["CONFLICT", "ERROR"].includes(record.syncState)) {
          const r = await repo.review(id);
          if (active.current) setReview(r);
        }
      } catch {
        if (active.current)
          setError(
            "Ce pense-bête ne peut pas être ouvert. Synchronise puis réessaie.",
          );
      }
    },
    [repo],
  );
  useEffect(() => {
    if (openTaskId) {
      void open(openTaskId);
      onTaskOpened();
    }
  }, [openTaskId, open, onTaskOpened]);
  const ctx = () => ({
    deviceId,
    commandId: randomUUID(),
    now: new Date().toISOString(),
    canWrite: () => active.current,
  });
  const afterWrite = async () => {
    await refresh();
    await reminders.refresh();
    void syncNow(scope.storeId).catch(() => undefined);
  };
  const changeStatus = async (
    t: PersonalTask,
    status: PersonalTask["status"],
  ) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await repo.save(t.id, { ...fields(t), status }, t.version, ctx());
      if (!active.current) return;
      setSheet(null);
      await afterWrite();
    } catch {
      if (active.current)
        setError(
          "Ce pense-bête a changé ou son envoi doit être repris. Rouvre-le pour comparer les versions.",
        );
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  };
  const edit = async (record: LocalPersonalTask | null) => {
    setError(undefined);
    setNotice(undefined);
    setReview(undefined);
    setCompared(false);
    try {
      const setting = record
        ? await personalReminderSetting(sqlite, scope, record.entity.id)
        : null;
      if (!active.current) return;
      const nextDraft = {
        text: record?.entity.text ?? "",
        date: record?.entity.date ?? date,
        time: record?.entity.time ?? "16:00",
        hasTime: !!record?.entity.time,
        reminder: !!setting?.enabled,
      };
      draftAtOpen.current = JSON.stringify(nextDraft);
      setDraft(nextDraft);
      setSheet({ record, edit: true });
    } catch {
      if (active.current)
        setError(
          "Ce pense-bête ne peut pas être modifié pour le moment. Ta saisie reste conservée.",
        );
    }
  };
  const hasDraftChanges = Boolean(
    sheet?.edit && JSON.stringify(draft) !== draftAtOpen.current,
  );
  const close = () => {
    if (busy) return;
    const finish = () => {
      if (active.current) {
        setSheet(null);
        setError(undefined);
      }
    };
    if (hasDraftChanges)
      Alert.alert(
        "Fermer le pense-bête ?",
        "Les modifications non enregistrées seront abandonnées.",
        [
          { text: "Continuer", style: "cancel" },
          { text: "Abandonner", style: "destructive", onPress: finish },
        ],
      );
    else finish();
  };
  const save = async () => {
    if (locked.current) return;
    const parsed = personalTaskFieldsSchema.safeParse({
      text: draft.text,
      date: draft.date,
      time: draft.hasTime ? draft.time : null,
      status: sheet?.record?.entity.status ?? "TODO",
    });
    if (!parsed.success) {
      setError("Vérifie le texte, la date (AAAA-MM-JJ) et l’heure (HH:MM).");
      return;
    }
    if (parsed.data.time)
      try {
        personalTaskInstant(parsed.data.date, parsed.data.time);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Vérifie l’heure de Paris.");
        return;
      }
    locked.current = true;
    setBusy(true);
    setError(undefined);
    let saved = false;
    try {
      const t = await repo.save(
        sheet?.record?.entity.id ?? randomUUID(),
        parsed.data,
        sheet?.record?.entity.version ?? null,
        { ...ctx(), reminder: draft.hasTime && draft.reminder },
      );
      saved = true;
      if (!active.current) return;
      // Capture is durable before requesting OS permission or touching the scheduler.
      if (draft.hasTime && draft.reminder)
        await requestReminderPermission().catch(() => false);
      if (!active.current) return;
      setSheet(null);
      await afterWrite();
      const setting = await personalReminderSetting(sqlite, scope, t.id);
      if (active.current)
        setNotice(
          draft.reminder && setting
            ? reminderStatus[setting.status]
            : "Pense-bête enregistré.",
        );
    } catch {
      if (active.current)
        setError(
          saved
            ? "Ton pense-bête est enregistré. Le rappel ou l’actualisation de la liste n’a pas pu être vérifié."
            : "Le pense-bête n’a pas pu être enregistré ou a changé. Rouvre-le avant de réessayer.",
        );
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  };
  const resolve = async (useLocal: boolean) => {
    if (!sheet?.record || !review?.ready || !compared || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await repo.resolve(sheet.record.entity.id, useLocal, review.token, ctx());
      if (!active.current) return;
      setSheet(null);
      await afterWrite();
    } catch {
      if (active.current) {
        setCompared(false);
        setError(
          "La comparaison a changé. Relis les versions avant de choisir.",
        );
      }
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  };
  const openCommercial = (r: CommercialRow) =>
    router.push({
      pathname: "/commercial-plan",
      params: {
        weekStart: r.weekStart,
        mode: "execution",
        taskId: r.proposal.id,
      },
    });
  const unfinished = (r: DailyRow) =>
    r.kind === "commercial"
      ? r.status === "TODO"
      : r.record.entity.status === "TODO";
  const reading = (!loaded || rowDate !== date) && failedDate !== date;
  const visibleRows = rowDate === date ? rows : [];
  const pending = visibleRows.filter(unfinished),
    finished = visibleRows.filter((r) => !unfinished(r));
  const renderRow = (r: DailyRow) => {
    const personal = r.kind === "personal" ? r.record : null,
      t = personal?.entity,
      label = t?.text ?? (r as CommercialRow).proposal.label,
      closed = !unfinished(r),
      done = t ? t.status === "DONE" : (r as CommercialRow).status === "DONE",
      conflict = personal && ["CONFLICT", "ERROR"].includes(personal.syncState);
    const activate = () =>
      t ? void open(t.id) : openCommercial(r as CommercialRow);
    return (
      <View key={t?.id ?? (r as CommercialRow).proposal.id} style={s.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t ? (t.status === "TODO" ? "Terminer" : "Rouvrir") : "Ouvrir"} : ${label}`}
          onPress={() =>
            t && !conflict
              ? void changeStatus(t, t.status === "TODO" ? "DONE" : "TODO")
              : activate()
          }
          disabled={busy}
          style={s.checkTarget}
        >
          <View style={t ? [s.check, done && s.checked] : s.commercialMark}>
            {!t ? (
              <Ionicons
                name={done ? "checkmark-circle-outline" : "calendar-outline"}
                size={22}
                color={c.mint}
              />
            ) : done ? (
              <Ionicons name="checkmark" size={16} color={c.onAccent} />
            ) : null}
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Détails : ${label}`}
          style={s.rowBody}
          onPress={activate}
        >
          <Text
            numberOfLines={2}
            style={[
              s.label,
              closed && { color: c.muted, textDecorationLine: "line-through" },
            ]}
          >
            {label}
          </Text>
          <Text style={s.meta}>
            {t ? (
              <>
                {t.status !== "TODO"
                  ? `${taskStatus[t.status]} · prévu le ${formatFrenchCalendarDate(t.date)}`
                  : t.date < date
                    ? `À reprendre · ${formatFrenchCalendarDate(t.date)}`
                    : (t.time ?? "Dans la journée")}{" "}
                · Personnel{conflict ? " · À vérifier" : ""}
              </>
            ) : (
              `${({ TODO: "Cette semaine", DONE: "Fait", SKIPPED: "Non faite", NOT_APPLICABLE: "Non applicable" } as const)[(r as CommercialRow).status]} · Plan de la semaine`
            )}
          </Text>
        </Pressable>
        <Ionicons name="chevron-forward" size={16} color={c.muted} />
      </View>
    );
  };
  let ambiguous = false;
  try {
    ambiguous =
      draft.hasTime &&
      storeEventTimeCandidates(draft.date, draft.time).length > 1;
  } catch {
    /* partial time entry is validated on save */
  }
  const selected = sheet?.record?.entity;
  const summary = (t: PersonalTask) => (
    <View style={s.compare}>
      <Text style={s.label}>{t.text}</Text>
      <Text style={s.meta}>
        {t.date}
        {t.time ? ` · ${t.time}` : ""} · {taskStatus[t.status]}
      </Text>
    </View>
  );
  return (
    <View style={{ marginTop: 22 }}>
      <View style={s.heading}>
        <Text accessibilityRole="header" style={s.title}>
          À faire
        </Text>
        <Pressable
          accessibilityRole="button"
          style={s.add}
          onPress={() => void edit(null)}
        >
          <Ionicons name="add" size={19} color={c.onAccent} />
          <Text style={s.addText}>Ajouter</Text>
        </Pressable>
      </View>
      <Text style={s.count}>
        {pending.length
          ? `${pending.length} chose${pending.length > 1 ? "s" : ""} à faire`
          : "La liste du jour"}
      </Text>
      {(error || reminders.error) && !sheet ? (
        <InlineAlert title="Pense-bêtes" message={error ?? reminders.error!} />
      ) : null}
      {notice ? (
        <Text accessibilityRole="alert" style={s.notice}>
          {notice}
        </Text>
      ) : null}
      <View
        onLayout={(event) => {
          if (
            !reading &&
            rowDate === date &&
            event.nativeEvent.layout.height > 0
          )
            setListHeight(event.nativeEvent.layout.height);
        }}
      >
        {reading ? (
          <View
            accessibilityRole="progressbar"
            accessibilityLabel="Lecture de la liste du jour"
            accessibilityState={{ busy: true }}
            style={{ height: listHeight, gap: 10 }}
          >
            {Array.from(
              {
                length: Math.max(1, Math.min(3, Math.floor(listHeight / 44))),
              },
              (_, i) => (
                <View
                  key={i}
                  accessible={false}
                  style={{
                    height: Math.min(34, listHeight),
                    borderRadius: 12,
                    backgroundColor: c.line,
                    opacity: 0.55,
                    width: i === 1 ? "75%" : "100%",
                  }}
                />
              ),
            )}
          </View>
        ) : pending.length ? (
          (expanded ? pending : pending.slice(0, 3)).map(renderRow)
        ) : (
          <Text style={s.empty}>
            {failedDate === date && rowDate !== date
              ? "Liste indisponible pour ce jour."
              : "Aucune tâche enregistrée pour ce jour."}
          </Text>
        )}
        {pending.length > 3 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setExpanded(!expanded)}
            style={s.link}
          >
            <Text style={s.linkText}>
              {expanded ? "Réduire la liste" : `Tout voir (${pending.length})`}
            </Text>
            <Ionicons name="arrow-forward" size={16} color={c.mint} />
          </Pressable>
        ) : null}
        {finished.length ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: history }}
              style={s.link}
              onPress={() => setHistory(!history)}
            >
              <Text style={s.meta}>
                Terminés et annulés ({finished.length})
              </Text>
              <Ionicons
                name={history ? "chevron-up" : "chevron-down"}
                size={16}
                color={c.muted}
              />
            </Pressable>
            {history ? finished.map(renderRow) : null}
          </>
        ) : null}
      </View>
      <BottomSheet
        visible={!!sheet}
        dismissible={!busy && !hasDraftChanges}
        title={
          sheet?.edit
            ? selected
              ? "Modifier le pense-bête"
              : "Un pense-bête"
            : "Ton pense-bête"
        }
        onClose={close}
        swipeToClose={!busy}
        avoidKeyboard
      >
        <View style={{ gap: 14 }}>
          <Text style={s.meta}>Visible uniquement par toi</Text>
          {error ? <InlineAlert title="Pense-bête" message={error} /> : null}
          {sheet?.edit ? (
            <>
              <Text style={s.fieldLabel}>À faire</Text>
              <TextInput
                accessibilityLabel="À faire"
                value={draft.text}
                onChangeText={(text) => setDraft((d) => ({ ...d, text }))}
                placeholder="Par exemple : contrôler les avocats"
                placeholderTextColor={c.muted}
                multiline
                maxLength={250}
                style={[s.input, { minHeight: 96 }]}
                editable={!busy}
              />
              <Text style={s.fieldLabel}>Jour</Text>
              <DateSelector
                label="Jour du pense-bête"
                description="Date prévue pour ce pense-bête personnel."
                value={draft.date}
                onConfirm={(value) => setDraft((d) => ({ ...d, date: value }))}
                disabled={busy}
              />
              <View style={s.switchRow}>
                <Text style={s.label}>À une heure précise</Text>
                <Switch
                  accessibilityLabel="À une heure précise"
                  value={draft.hasTime}
                  disabled={busy}
                  onValueChange={(hasTime) =>
                    setDraft((d) => ({
                      ...d,
                      hasTime,
                      reminder: hasTime && d.reminder,
                    }))
                  }
                  trackColor={{ true: c.mint, false: c.line }}
                />
              </View>
              {draft.hasTime ? (
                <>
                  <Text style={s.fieldLabel}>Heure de Paris · HH:MM</Text>
                  <TextInput
                    accessibilityLabel="Heure du pense-bête"
                    value={draft.time}
                    onChangeText={(time) => setDraft((d) => ({ ...d, time }))}
                    style={s.input}
                    editable={!busy}
                  />
                </>
              ) : null}
              <View style={s.switchRow}>
                <Text style={s.label}>Me rappeler sur cet appareil</Text>
                <Switch
                  accessibilityLabel="Me rappeler sur cet appareil"
                  value={draft.reminder}
                  disabled={busy || !draft.hasTime}
                  onValueChange={(reminder) =>
                    setDraft((d) => ({ ...d, reminder }))
                  }
                  trackColor={{ true: c.mint, false: c.line }}
                />
              </View>
              {ambiguous && draft.reminder ? (
                <Text style={s.meta}>
                  Cette heure existe deux fois : le rappel utilise le premier
                  passage, à l’heure d’été.
                </Text>
              ) : null}
              {!draft.hasTime ? (
                <Text style={s.meta}>
                  Choisis une heure pour activer un rappel.
                </Text>
              ) : null}
              <PrimaryButton
                label={busy ? "Enregistrement…" : "Enregistrer le pense-bête"}
                disabled={busy}
                onPress={() => void save()}
              />
            </>
          ) : selected ? (
            <>
              <Text style={s.detailTitle}>{selected.text}</Text>
              <Text style={s.meta}>
                Prévu le {formatFrenchCalendarDate(selected.date)}
                {selected.time
                  ? ` · ${selected.time} · heure de Paris`
                  : ""} · {taskStatus[selected.status]}
              </Text>
              {selected.completedAt ? (
                <Text style={s.meta}>
                  Fait le {storeEventTimeLabel(selected.completedAt)}
                </Text>
              ) : selected.cancelledAt ? (
                <Text style={s.meta}>
                  Annulé le {storeEventTimeLabel(selected.cancelledAt)}
                </Text>
              ) : null}
              {sheet.record?.syncState === "CONFLICT" ||
              sheet.record?.syncState === "ERROR" ? (
                <>
                  <Text style={s.label}>Ta version</Text>
                  {summary(selected)}
                  <Text style={s.label}>Version synchronisée</Text>
                  {review?.remote ? (
                    summary(review.remote)
                  ) : (
                    <Text style={s.meta}>
                      La version synchronisée doit être relue avant de choisir.
                    </Text>
                  )}
                  <SecondaryButton
                    label="Relire la comparaison"
                    disabled={busy}
                    onPress={() => {
                      setCompared(false);
                      void open(selected.id);
                    }}
                  />
                  <View style={s.switchRow}>
                    <Text style={[s.meta, { flex: 1 }]}>
                      J’ai comparé les deux versions, y compris leur état.
                    </Text>
                    <Switch
                      accessibilityLabel="J’ai comparé les deux versions"
                      value={compared}
                      onValueChange={setCompared}
                      disabled={!review?.ready || busy}
                    />
                  </View>
                  <PrimaryButton
                    label="Conserver ma version"
                    disabled={!compared || !review?.ready || busy}
                    onPress={() => void resolve(true)}
                  />
                  <SecondaryButton
                    label="Adopter la version synchronisée"
                    disabled={!compared || !review?.ready || busy}
                    onPress={() => void resolve(false)}
                  />
                </>
              ) : (
                <>
                  <PrimaryButton
                    label={
                      selected.status === "TODO"
                        ? "Marquer comme fait"
                        : "Remettre à faire"
                    }
                    disabled={busy}
                    onPress={() =>
                      void changeStatus(
                        selected,
                        selected.status === "TODO" ? "DONE" : "TODO",
                      )
                    }
                  />
                  <SecondaryButton
                    label="Modifier le pense-bête"
                    disabled={busy}
                    onPress={() => void edit(sheet.record)}
                  />
                  {selected.status === "TODO" ? (
                    <SecondaryButton
                      label="Annuler ce pense-bête"
                      disabled={busy}
                      onPress={() =>
                        Alert.alert(
                          "Annuler ce pense-bête ?",
                          "Il restera consultable dans les éléments terminés et annulés.",
                          [
                            { text: "Le conserver", style: "cancel" },
                            {
                              text: "Annuler le pense-bête",
                              style: "destructive",
                              onPress: () =>
                                void changeStatus(selected, "CANCELLED"),
                            },
                          ],
                        )
                      }
                    />
                  ) : null}
                </>
              )}
            </>
          ) : null}
        </View>
      </BottomSheet>
    </View>
  );
}
const s = StyleSheet.create({
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 20, fontWeight: "600", color: c.ink },
  add: {
    flexDirection: "row",
    gap: 4,
    alignItems: "center",
    backgroundColor: c.accent,
    borderRadius: 999,
    paddingHorizontal: 14,
    minHeight: 42,
  },
  addText: { color: c.onAccent, fontSize: 13, fontWeight: "600" },
  count: { fontSize: 12, color: c.muted, marginTop: 8, marginBottom: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 88,
    backgroundColor: c.surface,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderColor: c.line,
    gap: 4,
  },
  commercialMark: {
    width: 32,
    height: 40,
    borderRadius: 11,
    backgroundColor: c.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  checkTarget: { width: 40, minHeight: 48, justifyContent: "center" },
  check: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: c.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  checked: { backgroundColor: c.accent, borderColor: c.accent },
  rowBody: { flex: 1, paddingVertical: 15, paddingRight: 8 },
  label: { fontSize: 15, lineHeight: 21, fontWeight: "500", color: c.ink },
  meta: { fontSize: 12, lineHeight: 18, color: c.muted, marginTop: 3 },
  link: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 46,
  },
  linkText: { fontSize: 12, color: c.mint },
  empty: { paddingVertical: 20, fontSize: 14, color: c.muted },
  notice: { fontSize: 13, lineHeight: 20, color: c.mint, paddingVertical: 10 },
  input: {
    borderColor: c.line,
    borderWidth: 1,
    borderRadius: 11,
    padding: 13,
    color: c.ink,
    fontSize: 16,
    backgroundColor: c.canvas,
  },
  fieldLabel: { fontSize: 12, color: c.muted },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 54,
    borderTopWidth: 1,
    borderColor: c.line,
  },
  detailTitle: {
    fontSize: 23,
    lineHeight: 30,
    fontWeight: "500",
    color: c.ink,
  },
  compare: {
    padding: 12,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 10,
  },
});
