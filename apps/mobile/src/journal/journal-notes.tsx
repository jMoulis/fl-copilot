import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { randomUUID } from "expo-crypto";
import {
  journalNoteCaptureSchema,
  storeEventTimeLabel,
} from "@fl-copilot/domain";
import {
  BottomSheet,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
} from "../components/ui";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import { storeEventSyncState } from "../needs/store-event-presentation";
import { JournalNoteRepository } from "./journal-note-repository";
import { journalColors as c } from "./journal-theme";
import { journalDateLabel } from "./journal-presentation";

type Page = Awaited<ReturnType<JournalNoteRepository["list"]>>;
/** Keyed by store/owner/date by its parent; drafts never migrate to another scope. */
export function JournalNotes({
  storeId,
  date,
}: {
  storeId: string;
  date: string;
}) {
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow, lastSyncedAt } = useSync();
  const [page, setPage] = useState<Page>(),
    [cursor, setCursor] = useState<string | null>(null),
    [history, setHistory] = useState(false),
    [open, setOpen] = useState(false),
    [text, setText] = useState(""),
    [endDate, setEndDate] = useState(""),
    [period, setPeriod] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const readRevision = useRef(0);
  const alive = useRef(true),
    locked = useRef(false),
    noteId = useRef(randomUUID());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const read = useCallback(() => {
    let current = true;
    const revision = ++readRevision.current;
    void new JournalNoteRepository(sqlite)
      .list(storeId, date, cursor, history)
      .then((p) => {
        if (current && alive.current && revision === readRevision.current)
          setPage(p);
      })
      .catch(() => {
        if (current && alive.current && revision === readRevision.current)
          setError(
            "Les notes ne peuvent pas être lues. Elles restent conservées sur cet appareil.",
          );
      });
    return () => {
      current = false;
    };
  }, [sqlite, storeId, date, cursor, history]);
  useFocusEffect(read);
  useEffect(() => {
    if (lastSyncedAt) return read();
  }, [lastSyncedAt, read]);
  async function refresh() {
    const revision = ++readRevision.current;
    try {
      const p = await new JournalNoteRepository(sqlite).list(
        storeId,
        date,
        cursor,
        history,
      );
      if (alive.current && revision === readRevision.current) setPage(p);
    } catch {
      if (alive.current && revision === readRevision.current)
        setError(
          "L’enregistrement est conservé. Rouvre le Journal pour actualiser les notes.",
        );
    }
  }
  function assertCurrentScope() {
    if (!alive.current) throw Error("JOURNAL_NOTE_SCOPE_CHANGED");
  }
  function close() {
    if (locked.current) return;
    if (text.trim() || endDate)
      Alert.alert(
        "Fermer la note ?",
        "Le texte non enregistré sera abandonné.",
        [
          { text: "Continuer", style: "cancel" },
          {
            text: "Abandonner",
            style: "destructive",
            onPress: () => {
              setOpen(false);
              setText("");
              setEndDate("");
              setPeriod(false);
              noteId.current = randomUUID();
            },
          },
        ],
      );
    else setOpen(false);
  }
  async function save() {
    if (locked.current) return;
    const parsed = journalNoteCaptureSchema.safeParse({
      id: noteId.current,
      text,
      startDate: date,
      endDate: period ? endDate : null,
      capturedAt: new Date().toISOString(),
    });
    if (!parsed.success) {
      setError(
        "Saisis une note et, si nécessaire, un dernier jour valide au format AAAA-MM-JJ, à partir de la date sélectionnée.",
      );
      return;
    }
    locked.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await new JournalNoteRepository(sqlite).create(storeId, parsed.data, {
        commandId: randomUUID(),
        deviceId,
        assertCurrentScope,
      });
      if (alive.current) {
        setOpen(false);
        setText("");
        setEndDate("");
        setPeriod(false);
        noteId.current = randomUUID();
        if (cursor) setCursor(null);
        else await refresh();
      }
      void syncNow(storeId).catch(() => undefined);
    } catch {
      if (alive.current)
        setError(
          "La note n’a pas pu être enregistrée. Ton texte reste disponible pour réessayer.",
        );
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function remove(id: string) {
    Alert.alert(
      "Retirer cette note ?",
      "Elle ne sera plus utilisée pour les analyses. Son original restera dans l’historique. Pour corriger le texte, tu pourras ajouter une nouvelle note.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Retirer",
          style: "destructive",
          onPress: () => void withdraw(id),
        },
      ],
    );
  }
  async function withdraw(id: string) {
    if (locked.current) return;
    setError(undefined);
    locked.current = true;
    setBusy(true);
    try {
      await new JournalNoteRepository(sqlite).withdraw(storeId, id, {
        commandId: randomUUID(),
        deviceId,
        capturedAt: new Date().toISOString(),
        assertCurrentScope,
      });
      if (alive.current) await refresh();
      void syncNow(storeId).catch(() => undefined);
    } catch {
      if (alive.current)
        setError(
          "Le retrait n’a pas pu être enregistré. La note reste conservée.",
        );
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <View style={{ gap: 12, marginTop: 24 }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Text
          accessibilityRole="header"
          style={{ fontSize: 20, fontWeight: "600", color: c.ink }}
        >
          Notes du magasin
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ajouter une note du magasin"
          onPress={() => {
            setError(undefined);
            setOpen(true);
          }}
          disabled={busy}
          style={{ padding: 12 }}
        >
          <Text style={{ color: c.mint, fontWeight: "600" }}>+ Noter</Text>
        </Pressable>
      </View>
      {page?.rows.map(({ entity: n, syncState }) => (
        <View
          key={n.id}
          style={{
            gap: 8,
            padding: 14,
            borderWidth: 1,
            borderColor: c.line,
            borderRadius: 14,
            opacity: n.withdrawnAt ? 0.65 : 1,
          }}
        >
          <Text
            selectable
            style={{ color: c.ink, fontSize: 16, lineHeight: 23 }}
          >
            {n.text}
          </Text>
          <Text style={{ color: c.muted, fontSize: 12 }}>
            {journalDateLabel(n.startDate)}
            {n.endDate ? ` → ${journalDateLabel(n.endDate)}` : ""} ·{" "}
            {n.withdrawnAt ? "Retirée" : storeEventSyncState(syncState)}
          </Text>
          <Text style={{ color: c.muted, fontSize: 12 }}>
            Noté le {storeEventTimeLabel(n.capturedAt)}
          </Text>
          {!n.withdrawnAt ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => remove(n.id)}
              style={{ paddingVertical: 10 }}
            >
              <Text style={{ color: c.muted }}>Retirer la note</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      {page?.rows.length === 0 ? (
        <Text style={{ color: c.muted }}>Aucune note pour cette journée.</Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: 16 }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setHistory(!history);
            setCursor(null);
          }}
          style={{ paddingVertical: 12 }}
        >
          <Text style={{ color: c.mint }}>
            {history
              ? "Masquer les notes retirées"
              : "Voir aussi les notes retirées"}
          </Text>
        </Pressable>
        {cursor ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setCursor(null)}
            style={{ paddingVertical: 12 }}
          >
            <Text style={{ color: c.mint }}>Premières notes</Text>
          </Pressable>
        ) : null}
        {page?.hasMore ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setCursor(page.nextAfterId)}
            style={{ paddingVertical: 12 }}
          >
            <Text style={{ color: c.mint }}>Notes suivantes</Text>
          </Pressable>
        ) : null}
      </View>
      {error && !open ? (
        <InlineAlert title="Note du magasin" message={error} />
      ) : null}
      <BottomSheet
        visible={open}
        title="Noter dans le Journal"
        onClose={close}
        swipeToClose
        avoidKeyboard
      >
        <Text style={{ color: c.muted }}>{journalDateLabel(date)}</Text>
        <TextInput
          accessibilityLabel="Note du magasin"
          placeholder="Livraison en retard, travaux devant l’entrée, affluence inhabituelle…"
          placeholderTextColor={c.muted}
          value={text}
          onChangeText={setText}
          maxLength={1200}
          multiline
          editable={!busy}
          style={{
            minHeight: 130,
            padding: 14,
            color: c.ink,
            fontSize: 16,
            borderWidth: 1,
            borderColor: c.line,
            borderRadius: 12,
            textAlignVertical: "top",
          }}
        />
        <SecondaryButton
          label={period ? "Retirer la période" : "Ajouter une période"}
          disabled={busy}
          onPress={() => setPeriod(!period)}
        />
        {period ? (
          <TextInput
            accessibilityLabel="Dernier jour de la note, AAAA-MM-JJ"
            placeholder="Dernier jour : AAAA-MM-JJ"
            placeholderTextColor={c.muted}
            value={endDate}
            onChangeText={setEndDate}
            editable={!busy}
            style={{
              minHeight: 48,
              color: c.ink,
              padding: 12,
              borderWidth: 1,
              borderColor: c.line,
              borderRadius: 12,
            }}
          />
        ) : null}
        {error ? <InlineAlert title="Vérifie la note" message={error} /> : null}
        <PrimaryButton
          label={busy ? "Enregistrement…" : "Enregistrer la note"}
          disabled={busy}
          onPress={() => void save()}
        />
      </BottomSheet>
    </View>
  );
}
