import { CommercialOfferValidationView } from "@/commercial/offer-validation-view";
import { useCallback, useMemo, useRef, useState } from "react";
import { Text, TextInput, View, Alert } from "react-native";
import { router, useFocusEffect } from "expo-router";
import {
  digestStringAsync,
  CryptoDigestAlgorithm,
  randomUUID,
} from "expo-crypto";
import {
  currentCommercialWeek,
  commercialWeekPreparationId,
  commercialChoiceWithinWeek,
  commercialPreparationOfferIssues,
  commercialDocumentWeekContext,
  commercialItemWeekStatus,
} from "@fl-copilot/commercial-core";
import {
  commercialWeekPreparationSchema,
  synchronizedCommercialVisualReadingSchema,
  type CommercialWeekPreparation,
} from "@fl-copilot/sync-contracts";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import {
  CommercialPreparationRepository,
  type LocalCommercialPreparation,
} from "@/commercial/week-preparation-repository";
import {
  readCommercialChoices,
  type LocalCommercialChoice,
} from "@/commercial/offer-choice-repository";
import { commercialChoiceSummary } from "@/commercial/choice-presentation";
import {
  commercialPreparationError,
  commercialPreparationSummary,
} from "@/commercial/preparation-presentation";
import {
  AppScreen,
  AppHeader,
  SectionCard,
  SecondaryButton,
  PrimaryButton,
  InlineAlert,
  StatusBadge,
} from "@/components/ui";
const digest = (text: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, text);
type Placement = CommercialWeekPreparation["placements"][number];
type Idea = { label: string; source: NonNullable<Placement["sourceIdea"]> };
export default function WeekPreparationScreen() {
  const { session } = useAuth(),
    storeId = session?.stores[0]?.storeId;
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync();
  const [week] = useState(() => currentCommercialWeek());
  const repo = useMemo(
    () => new CommercialPreparationRepository(sqlite, digest),
    [sqlite],
  );
  const [saved, setSaved] = useState<LocalCommercialPreparation | null>(null),
    [choices, setChoices] = useState<LocalCommercialChoice[]>([]),
    [ideas, setIdeas] = useState<Idea[]>([]),
    [capacity, setCapacity] = useState(""),
    [refs, setRefs] = useState<CommercialWeekPreparation["offerRefs"]>([]),
    [placements, setPlacements] = useState<Placement[]>([]),
    [note, setNote] = useState(""),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [issues, setIssues] = useState<Record<string, string>>({});
  const initialized = useRef(false),
    saving = useRef(false);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!storeId) return;
        const [record, records, rows] = await Promise.all([
          repo.get(storeId, week.start),
          readCommercialChoices(sqlite, storeId),
          sqlite.getAllAsync<{ payload_json: string }>(
            "SELECT payload_json FROM commercial_visual_readings WHERE store_id=? ORDER BY source_document_id,page_number",
            storeId,
          ),
        ]);
        if (!active) return;
        setChoices(records);
        const pages = rows.map((r) =>
            synchronizedCommercialVisualReadingSchema.parse(
              JSON.parse(r.payload_json),
            ),
          ),
          documents = [...new Set(pages.map((p) => p.sourceDocumentId))];
        const found = documents.flatMap((doc) => {
          const docPages = pages.filter(
              (p) => p.sourceDocumentId === doc && p.reading,
            ),
            context = commercialDocumentWeekContext(
              docPages.map((p) => p.reading!),
            );
          return docPages.flatMap((p) =>
            p.reading!.tgIdeas.flatMap((idea, index) =>
              commercialItemWeekStatus(idea, context, week) === "CURRENT"
                ? [
                    {
                      label: idea.label,
                      source: {
                        readingId: p.id,
                        checksum: p.checksum,
                        tgIndex: index,
                      },
                    },
                  ]
                : [],
            ),
          );
        });
        setIdeas(found);
        if (!initialized.current) {
          setSaved(record);
          setCapacity(
            record?.entity.tgCapacity === null || !record
              ? ""
              : String(record.entity.tgCapacity),
          );
          setRefs(record?.entity.offerRefs ?? []);
          setPlacements(record?.entity.placements ?? []);
          setNote(record?.entity.note ?? "");
          initialized.current = true;
        }
        setLoaded(true);
      })().catch(() => {
        if (active) {
          setError("La préparation ne peut pas être lue sur cet appareil.");
          setLoaded(true);
        }
      });
      return () => {
        active = false;
      };
    }, [storeId, sqlite, repo, week]),
  );
  const eligible = choices.filter(
    (c) =>
      c.entity.status === "RETAINED" &&
      commercialChoiceWithinWeek(c.entity, week) &&
      !["ERROR", "CONFLICT"].includes(c.syncState),
  );
  const stale = refs.some(
    (ref) =>
      !eligible.some(
        (c) =>
          c.entity.id === ref.choiceId &&
          c.entity.version === ref.choiceVersion,
      ),
  );
  function refreshOffers() {
    const next = refs.flatMap((ref) => {
      const c = eligible.find((c) => c.entity.id === ref.choiceId);
      return c
        ? [{ choiceId: c.entity.id, choiceVersion: c.entity.version }]
        : [];
    });
    setRefs(next);
    setPlacements((old) =>
      old.map((p) => ({
        ...p,
        offerIds: p.offerIds.filter((id) =>
          next.some((r) => r.choiceId === id),
        ),
      })),
    );
    setError(undefined);
  }
  function toggleOffer(choice: LocalCommercialChoice) {
    const included = refs.some((r) => r.choiceId === choice.entity.id);
    setRefs((old) =>
      included
        ? old.filter((r) => r.choiceId !== choice.entity.id)
        : [
            ...old,
            {
              choiceId: choice.entity.id,
              choiceVersion: choice.entity.version,
            },
          ],
    );
    if (included)
      setPlacements((old) =>
        old.map((p) => ({
          ...p,
          offerIds: p.offerIds.filter((id) => id !== choice.entity.id),
        })),
      );
  }
  function changePlacement(id: string, patch: Partial<Placement>) {
    setPlacements((old) =>
      old.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  }
  async function save() {
    if (!storeId || saving.current) return;
    if (currentCommercialWeek().start !== week.start) {
      setError(
        "La semaine a changé. Revenez à Ma semaine pour ouvrir la préparation courante.",
      );
      return;
    }
    setError(undefined);
    setIssues({});
    saving.current = true;
    setBusy(true);
    try {
      const now = new Date().toISOString(),
        id = await commercialWeekPreparationId(storeId, week.start, digest),
        version =
          (saved?.syncState === "ERROR"
            ? (saved.remoteVersion ?? 0)
            : (saved?.entity.version ?? 0)) + 1;
      const parsed = commercialWeekPreparationSchema.safeParse({
        id,
        storeId,
        weekStart: week.start,
        weekEnd: week.end,
        status: "DRAFT",
        tgCapacity:
          capacity.trim() === ""
            ? null
            : /^\d+$/.test(capacity.trim())
              ? Number(capacity)
              : undefined,
        offerRefs: refs,
        placements,
        note,
        version,
        createdAt: saved?.entity.createdAt ?? now,
        updatedAt: now,
      });
      if (!parsed.success) {
        const next: Record<string, string> = {};
        for (const issue of parsed.error.issues)
          next[String(issue.path[0])] = issue.message;
        setIssues(next);
        return;
      }
      if (
        commercialPreparationOfferIssues(
          parsed.data,
          choices.map((c) => c.entity),
        ).length
      )
        throw Error("COMMERCIAL_PREPARATION_OFFERS_CHANGED");
      await repo.save(parsed.data, { commandId: randomUUID(), deviceId });
      setSaved(await repo.get(storeId, week.start));
      void syncNow(storeId)
        .then(async () => {
          setChoices(await readCommercialChoices(sqlite, storeId));
          const latest = await repo.get(storeId, week.start);
          if (latest?.entity.version === parsed.data.version) setSaved(latest);
          else if (latest)
            setError(
              "La préparation a changé pendant la synchronisation. Votre saisie reste visible ; rouvrez la semaine avant de la modifier.",
            );
        })
        .catch(() => undefined);
    } catch (reason) {
      setError(
        commercialPreparationError(
          reason instanceof Error ? reason.message : undefined,
        ),
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const unsavedChanges =
    !!saved &&
    JSON.stringify({
      tgCapacity:
        capacity.trim() === ""
          ? null
          : /^\d+$/.test(capacity.trim())
            ? Number(capacity)
            : "invalid",
      offerRefs: refs,
      placements,
      note: note.trim(),
    }) !==
      JSON.stringify({
        tgCapacity: saved.entity.tgCapacity,
        offerRefs: saved.entity.offerRefs,
        placements: saved.entity.placements,
        note: saved.entity.note,
      });
  return (
    <AppScreen>
      <AppHeader
        title={`Préparer ma semaine ${week.number}`}
        subtitle="Choisissez vos offres et vos TG. Cette préparation reste un brouillon, sans validation finale ni action exécutée."
      />
      <SecondaryButton
        label="Retour à Ma semaine"
        disabled={busy}
        onPress={() => router.back()}
      />
      {!loaded ? <Text>Lecture de la préparation…</Text> : null}
      {error ? (
        <InlineAlert title="Préparation à vérifier" message={error} />
      ) : null}
      {saved ? (
        <SectionCard title="Brouillon enregistré">
          <Text className="text-base text-ink">
            {commercialPreparationSummary(saved.entity)}
          </Text>
          <StatusBadge
            status={
              saved.syncState === "SYNCED"
                ? "synced"
                : saved.syncState === "CONFLICT"
                  ? "conflict"
                  : saved.syncState === "ERROR"
                    ? "error"
                    : "pending"
            }
          />
          {saved.syncState === "ERROR" ? (
            <InlineAlert
              title="Synchronisation à reprendre"
              message={commercialPreparationError(
                saved.lastErrorCode ?? undefined,
              )}
            />
          ) : null}
          {saved.syncState === "CONFLICT" ? (
            <SecondaryButton
              label="Comparer dans Synchronisation"
              onPress={() => router.push("/sync-center")}
            />
          ) : null}
        </SectionCard>
      ) : null}
      {stale ? (
        <InlineAlert
          title="Offres modifiées depuis la préparation"
          message="Une offre sélectionnée a changé ou a été retirée. Les affectations précédentes restent visibles ; relisez-les avant de mettre à jour."
        />
      ) : null}
      {stale ? (
        <SecondaryButton
          label="Mettre à jour les offres du brouillon"
          onPress={() =>
            Alert.alert(
              "Mettre à jour les offres ?",
              "Les versions seront actualisées et les offres retirées ou hors semaine seront enlevées des TG. Le brouillon précédent reste dans l’historique après l’enregistrement.",
              [
                { text: "Annuler", style: "cancel" },
                { text: "Mettre à jour", onPress: refreshOffers },
              ],
            )
          }
        />
      ) : null}
      <SectionCard
        title="Offres pour ma semaine"
        description="Sélectionnez parmi vos offres retenues. Une offre peut rester hors TG."
      >
        {!eligible.length ? (
          <Text className="text-sm text-muted">
            Retenez d’abord une offre dans la synthèse commerciale.
          </Text>
        ) : null}
        {eligible.map((c) => (
          <View key={c.entity.id} className="gap-2">
            <Text className="text-base text-ink">
              {commercialChoiceSummary(c.entity)}
            </Text>
            <SecondaryButton
              label={`${refs.some((r) => r.choiceId === c.entity.id) ? "✓ Sélectionnée · retirer" : "Inclure dans la préparation"}`}
              onPress={() => toggleOffer(c)}
            />
          </View>
        ))}
      </SectionCard>
      <SectionCard
        title="TG disponibles cette semaine"
        description="Les idées du PDF ne déterminent pas la capacité de votre magasin."
      >
        <TextInput
          accessibilityLabel="Nombre de TG disponibles"
          keyboardType="number-pad"
          value={capacity}
          onChangeText={setCapacity}
          placeholder="Nombre réel de TG disponibles"
          className={`rounded-xl border p-3 text-base text-ink ${issues.tgCapacity ? "border-danger" : "border-line"}`}
        />
        {issues.tgCapacity ? (
          <Text accessibilityRole="alert" className="text-danger">
            {issues.tgCapacity}
          </Text>
        ) : null}
        <SecondaryButton
          label="Ajouter un emplacement TG"
          onPress={() =>
            setPlacements((old) => {
              let number = 1;
              while (
                old.some(
                  (p) => p.label.toLocaleLowerCase("fr-FR") === `tg ${number}`,
                )
              )
                number++;
              return [
                ...old,
                {
                  id: randomUUID(),
                  label: `TG ${number}`,
                  theme: "",
                  offerIds: [],
                  sourceIdea: null,
                },
              ];
            })
          }
        />
      </SectionCard>
      {placements.map((p) => (
        <SectionCard
          key={p.id}
          title={p.label || "Emplacement TG"}
          description="Une affectation préparée n’est pas une installation réalisée."
        >
          <TextInput
            accessibilityLabel="Nom de cet emplacement"
            value={p.label}
            onChangeText={(label) => changePlacement(p.id, { label })}
            className="rounded-xl border border-line p-3 text-base text-ink"
          />
          <TextInput
            accessibilityLabel="Thème de cette TG"
            value={p.theme}
            onChangeText={(theme) => changePlacement(p.id, { theme })}
            placeholder="Thème choisi pour le magasin"
            className="rounded-xl border border-line p-3 text-base text-ink"
          />
          {ideas.length ? (
            <Text className="font-semibold text-ink">
              Idées du document, à adapter
            </Text>
          ) : null}
          {ideas.map((idea, index) => (
            <SecondaryButton
              key={`${idea.source.readingId}:${index}`}
              label={`S’inspirer de : ${idea.label}`}
              onPress={() =>
                changePlacement(p.id, {
                  theme: idea.label,
                  sourceIdea: idea.source,
                })
              }
            />
          ))}
          {p.sourceIdea ? (
            <SecondaryButton
              label="Détacher l’idée du document"
              onPress={() => changePlacement(p.id, { sourceIdea: null })}
            />
          ) : null}
          <Text className="font-semibold text-ink">Offres affectées</Text>
          {refs.map((ref) => {
            const c = choices.find((c) => c.entity.id === ref.choiceId);
            return c ? (
              <SecondaryButton
                key={ref.choiceId}
                label={`${p.offerIds.includes(ref.choiceId) ? "✓ " : ""}${c.entity.rawProductLabel}`}
                onPress={() =>
                  changePlacement(p.id, {
                    offerIds: p.offerIds.includes(ref.choiceId)
                      ? p.offerIds.filter((id) => id !== ref.choiceId)
                      : [...p.offerIds, ref.choiceId],
                  })
                }
              />
            ) : null;
          })}
          {!p.offerIds.length ? (
            <Text className="text-sm text-muted">
              Aucune offre affectée : cet emplacement reste à compléter.
            </Text>
          ) : null}
          <SecondaryButton
            label="Retirer cet emplacement du brouillon"
            onPress={() =>
              setPlacements((old) => old.filter((row) => row.id !== p.id))
            }
          />
        </SectionCard>
      ))}
      {issues.placements ? (
        <InlineAlert
          title="Emplacements à corriger"
          message={issues.placements}
        />
      ) : null}
      <SectionCard title="Note de préparation">
        <TextInput
          accessibilityLabel="Note pour la semaine"
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={1200}
          className="rounded-xl border border-line p-3 text-base text-ink"
        />
      </SectionCard>
      <PrimaryButton
        label={busy ? "Enregistrement…" : "Enregistrer le brouillon de semaine"}
        disabled={busy || !loaded || saved?.syncState === "CONFLICT"}
        onPress={() => void save()}
      />
      {saved ? (
        <CommercialOfferValidationView
          key={`${saved.entity.id}:${saved.entity.version}`}
          plan={saved.entity}
          unsavedChanges={unsavedChanges}
        />
      ) : null}
    </AppScreen>
  );
}
