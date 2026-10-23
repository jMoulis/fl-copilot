import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { digestStringAsync, CryptoDigestAlgorithm } from "expo-crypto";
import { storeEventTimeLabel } from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import {
  SectionCard,
  SecondaryButton,
  InlineAlert,
  StatusBadge,
} from "../components/ui";
import { SegmentedControl } from "../components/dashboard";
import { formatFrenchCalendarDate } from "../dates/calendar";
import {
  CopilotActivityRepository,
  type CopilotActivityCursor,
  type CopilotActivityFilter,
  type CopilotActivityEntry,
} from "./copilot-activity";
const digest = (text: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, text);
const statuses: Record<CopilotActivityEntry["status"], string> = {
  ACCEPT: "Conseil retenu",
  MODIFY: "Conseil adapté",
  POSTPONE: "Conseil reporté",
  REJECT: "Conseil écarté",
  DECLARED_DONE: "Réalisation déclarée",
  WITHDRAWN: "Déclaration retirée",
};
export function CopilotActivityPanel({
  db,
  storeId,
  ownerId,
  weekStart,
  focused,
  revision,
  filter,
  onFilter,
  onLayout,
  onNavigate,
}: {
  db: OutboxDatabase;
  storeId: string;
  ownerId: string;
  weekStart: string;
  focused: boolean;
  revision: string;
  filter: CopilotActivityFilter;
  onFilter(filter: CopilotActivityFilter): void;
  onLayout?(y: number): void;
  onNavigate?(): void;
}) {
  const repo = useMemo(
    () => new CopilotActivityRepository(db, { storeId, ownerId }, digest),
    [db, storeId, ownerId],
  );
  const [open, setOpen] = useState(false),
    [paging, setPaging] = useState<{
      scope: string;
      cursors: CopilotActivityCursor[];
    }>({ scope: "", cursors: [] }),
    [retry, setRetry] = useState(0),
    [loading, setLoading] = useState(false);
  const pageScope = JSON.stringify([storeId, ownerId, weekStart, filter]);
  const cursors = paging.scope === pageScope ? paging.cursors : [];
  const setCursors = (
    update: (old: CopilotActivityCursor[]) => CopilotActivityCursor[],
  ) => setPaging({ scope: pageScope, cursors: update(cursors) });
  const cursor = cursors.at(-1),
    key = JSON.stringify([storeId, ownerId, weekStart, filter, cursor]);
  const [snapshot, setSnapshot] = useState<{
    key: string;
    page: Awaited<ReturnType<CopilotActivityRepository["page"]>>;
  }>();
  const [error, setError] = useState<{ key: string; message: string }>();
  const displayed = useRef(snapshot),
    wasActive = useRef(false),
    lastRetry = useRef(-1),
    lastRepo = useRef<CopilotActivityRepository | undefined>(undefined);
  displayed.current = snapshot;
  useEffect(() => {
    const active = focused && open,
      entering = active && !wasActive.current;
    wasActive.current = active;
    if (!active) {
      setLoading(false);
      return;
    }
    if (
      !entering &&
      revision === "syncing" &&
      displayed.current?.key === key &&
      lastRetry.current === retry &&
      lastRepo.current === repo
    ) {
      setLoading(false);
      return;
    }
    let current = true;
    lastRetry.current = retry;
    lastRepo.current = repo;
    setLoading(true);
    void repo
      .page(weekStart, filter, cursor)
      .then((page) => {
        if (current) {
          setSnapshot({ key, page });
          setError(undefined);
        }
      })
      .catch(() => {
        if (current)
          setError({
            key,
            message:
              "Le suivi du copilote ne peut pas être relu. Les éléments déjà affichés sont conservés.",
          });
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [focused, open, revision, key, retry, repo, weekStart, filter, cursor]);
  const visible = snapshot?.key === key ? snapshot.page : undefined;
  return (
    <View
      className="gap-3"
      onLayout={(event) => onLayout?.(event.nativeEvent.layout.y)}
    >
      <SecondaryButton
        label="Décisions et réalisations"
        expanded={open}
        onPress={() => setOpen((value) => !value)}
      />
      {open ? (
        <SectionCard
          title="Suivi du copilote"
          description="Choix et déclarations mis à jour pendant la semaine sélectionnée. Retenir un conseil ne déclare pas sa réalisation."
        >
          <SegmentedControl
            label="Afficher le suivi du copilote"
            value={filter}
            onChange={(value: CopilotActivityFilter) => {
              setCursors(() => []);
              onFilter(value);
              onNavigate?.();
            }}
            options={[
              { value: "ALL", label: "Tout" },
              { value: "DECISION", label: "Choix" },
              { value: "EXECUTION", label: "Déclarées" },
            ]}
          />
          {error?.key === key ? (
            <InlineAlert title="Lecture interrompue" message={error.message} />
          ) : null}
          {!visible && loading ? (
            <Text className="text-sm text-muted">Lecture du suivi local…</Text>
          ) : null}
          {visible?.entries.length === 0 ? (
            <Text className="text-sm text-muted">
              Aucun choix ou déclaration enregistré pour cette sélection. Une
              recommandation seule n’ajoute pas d’action.
            </Text>
          ) : null}
          {visible?.entries.map((entry) => (
            <Pressable
              key={`${entry.kind}:${entry.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${statuses[entry.status]} : ${entry.label}. ${entry.conversationAvailable ? "Ouvrir la conversation" : "Conversation indisponible, enregistrement conservé"}`}
              accessibilityState={{ disabled: !entry.conversationAvailable }}
              disabled={!entry.conversationAvailable}
              onPress={() =>
                router.push({
                  pathname: "/copilot",
                  params: { conversationId: entry.conversationId },
                })
              }
              className="gap-2 rounded-xl border border-line bg-background p-3"
            >
              <Text className="text-sm font-semibold text-forest">
                {statuses[entry.status]}
              </Text>
              <Text className="font-semibold text-ink" numberOfLines={3}>
                {entry.label}
              </Text>
              <Text className="text-xs text-muted">
                Dernier changement · {storeEventTimeLabel(entry.at)}
              </Text>
              {entry.postponedUntil ? (
                <Text className="text-sm text-muted">
                  Reporté au {formatFrenchCalendarDate(entry.postponedUntil)}
                </Text>
              ) : null}
              {entry.detail ? (
                <Text className="text-sm text-muted" numberOfLines={3}>
                  {entry.detail}
                </Text>
              ) : null}
              {entry.syncState !== "SYNCED" ? (
                <StatusBadge
                  compact
                  status={
                    entry.syncState === "CONFLICT"
                      ? "conflict"
                      : entry.syncState === "ERROR"
                        ? "error"
                        : "pending"
                  }
                />
              ) : null}
              {!entry.sourceAvailable && entry.kind === "DECISION" ? (
                <Text className="text-xs text-muted">
                  Le choix est conservé ; son conseil d’origine n’est plus
                  consultable ici.
                </Text>
              ) : null}
              <Text
                className={
                  entry.conversationAvailable
                    ? "text-sm text-forest"
                    : "text-xs text-muted"
                }
              >
                {entry.conversationAvailable
                  ? "Ouvrir la conversation ›"
                  : "Conversation indisponible · enregistrement conservé"}
              </Text>
            </Pressable>
          ))}
          {visible ? (
            <Text
              className="text-xs text-muted"
              accessibilityLiveRegion="polite"
            >
              {visible.entries.length}{" "}
              {visible.entries.length === 1
                ? "élément affiché"
                : "éléments affichés"}{" "}
              · page {cursors.length + 1}
            </Text>
          ) : null}
          {cursors.length || visible?.next ? (
            <View className="flex-row flex-wrap gap-2">
              {cursors.length ? (
                <SecondaryButton
                  label="Page précédente du suivi"
                  disabled={loading}
                  onPress={() => {
                    setCursors((old) => old.slice(0, -1));
                    onNavigate?.();
                  }}
                />
              ) : null}
              {visible?.next ? (
                <SecondaryButton
                  label="Page suivante du suivi"
                  disabled={loading}
                  onPress={() => {
                    const next = visible.next;
                    if (next) {
                      setCursors((old) => [...old, next]);
                      onNavigate?.();
                    }
                  }}
                />
              ) : null}
            </View>
          ) : null}
          <SecondaryButton
            label="Actualiser le suivi"
            disabled={loading}
            onPress={() => setRetry((n) => n + 1)}
          />
        </SectionCard>
      ) : null}
    </View>
  );
}
