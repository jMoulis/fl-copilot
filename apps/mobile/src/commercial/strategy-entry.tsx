import { currentCommercialWeek } from "@fl-copilot/commercial-core";
import { useCallback, useMemo, useRef, useState } from "react";
import { Text } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { randomUUID } from "expo-crypto";
import { DateSelector } from "../components/date-selector";
import {
  SectionCard,
  PrimaryButton,
  SecondaryButton,
  InlineAlert,
} from "../components/ui";
import { useLocalDatabase } from "../providers/database-provider";
import { CopilotConversationRepository } from "../copilot/conversation-repository";
import { CopilotLocalChatController } from "../copilot/local-chat-controller";
import {
  CommercialStrategyConversation,
  strategyWeek,
} from "./strategy-conversation";
import { formatFrenchCalendarDate } from "../dates/calendar";

export function CommercialStrategyEntry({
  sourceDocumentId,
  storeId,
  ownerId,
  initialWeekStart,
  onDetails,
}: {
  sourceDocumentId: string;
  storeId: string;
  ownerId: string;
  initialWeekStart?: string;
  onDetails(): void;
}) {
  const { sqlite, deviceId } = useLocalDatabase();
  const [selected, setSelected] = useState<string>();
  const week = strategyWeek(selected ?? initialWeekStart);
  const controller = useMemo(
    () =>
      new CopilotLocalChatController(
        new CopilotConversationRepository(sqlite, { storeId, ownerId }),
        { storeId, ownerId, deviceId },
        randomUUID,
      ),
    [sqlite, storeId, ownerId, deviceId],
  );
  const conversation = useMemo(
    () =>
      new CommercialStrategyConversation(
        controller,
        sourceDocumentId,
        week.start,
      ),
    [controller, sourceDocumentId, week.start],
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const locked = useRef(false),
    active = useRef(false);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      return () => {
        active.current = false;
      };
    }, []),
  );
  async function open() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const conversationId = await conversation.open();
      if (active.current)
        router.push({ pathname: "/copilot", params: { conversationId } });
    } catch {
      if (active.current)
        setError(
          "La discussion ne peut pas être préparée. Vérifie que l’original du PDF est disponible sur cet appareil. Aucun choix commercial n’a été enregistré.",
        );
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <SectionCard
      title={`Ma stratégie · semaine ${week.number} · ${week.year}`}
      description={`Du ${formatFrenchCalendarDate(week.start)} au ${formatFrenchCalendarDate(week.end)}`}
    >
      <Text className="text-base leading-6 text-ink">
        Partons des TG proposées par l’enseigne pour choisir les présentations
        et les contre-promos adaptées à ton rayon.
      </Text>
      <DateSelector
        value={week.start}
        label="Semaine à préparer"
        description="Choisis un jour de la semaine sur laquelle tu veux travailler."
        disabled={busy}
        triggerLabel="Changer de semaine"
        onConfirm={(date) => {
          if (!locked.current)
            setSelected(
              currentCommercialWeek(new Date(`${date}T12:00:00Z`)).start,
            );
        }}
      />
      <PrimaryButton
        label={busy ? "Ouverture…" : "Préparer avec le copilote"}
        disabled={busy}
        onPress={() => void open()}
      />
      <Text className="text-sm text-muted">
        Le PDF sera joint à une discussion avec la semaine choisie. Tu peux
        ajuster la demande avant de l’envoyer, sans examiner les extraits.
      </Text>
      {error ? (
        <InlineAlert title="Discussion indisponible" message={error} />
      ) : null}
      <SecondaryButton
        label="Consulter les informations du document"
        disabled={busy}
        onPress={onDetails}
      />
    </SectionCard>
  );
}
