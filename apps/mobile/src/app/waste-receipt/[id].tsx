import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Pressable, Text, TextInput, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  AppHeader,
  AppScreen,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
  StatusBadge,
} from "@/components/ui";
import {
  WasteReceiptRepository,
  type LocalWasteLineDraft,
  type LocalWasteReceiptDetail,
} from "@/documents/waste-receipt-repository";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";

export default function WasteReceiptValidationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const database = useLocalDatabase();
  const { syncNow } = useSync();
  const repository = useMemo(
    () => new WasteReceiptRepository(database.sqlite),
    [database.sqlite],
  );
  const [detail, setDetail] = useState<LocalWasteReceiptDetail | null>();
  const [date, setDate] = useState("");
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [comparingDuplicate, setComparingDuplicate] = useState(false);
  const [resolvingDuplicate, setResolvingDuplicate] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const next = await repository.getReceiptDetail(id);
      setDetail(next);
      setDate(
        next?.receipt.confirmedWasteDate ??
          next?.receipt.detectedReceiptDate ??
          "",
      );
      setError(next ? undefined : "Ce ticket est introuvable.");
    } catch {
      setError("Le ticket n’a pas pu être relu.");
    }
  }, [id, repository]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const groups = useMemo(
    () => groupLines(detail?.lines ?? []),
    [detail?.lines],
  );

  if (detail === undefined) {
    return (
      <AppScreen>
        <AppHeader title="Validation du ticket" subtitle="Chargement…" />
      </AppScreen>
    );
  }

  if (!detail) {
    return (
      <AppScreen>
        <AppHeader title="Validation du ticket" />
        <InlineAlert
          title="Ticket indisponible"
          message={error ?? "Ce ticket est introuvable."}
        />
        <SecondaryButton label="Retour à Casse" onPress={() => router.back()} />
      </AppScreen>
    );
  }

  const reviewCount = detail.lines.filter(
    ({ line }) => line.validationStatus === "TO_REVIEW",
  ).length;

  return (
    <AppScreen>
      <AppHeader
        title="Valider le ticket"
        subtitle={`${detail.lines.length} ligne${detail.lines.length > 1 ? "s" : ""} extraite${detail.lines.length > 1 ? "s" : ""}`}
      >
        <StatusBadge status={reviewCount > 0 ? "incomplete" : "pending"} />
      </AppHeader>

      {message ? <InlineAlert title="Enregistré" message={message} /> : null}
      {error ? <InlineAlert title="Action impossible" message={error} /> : null}

      {detail.receipt.duplicateStatus === "POSSIBLE_DUPLICATE" ? (
        <SectionCard
          title="Doublon possible"
          description="Un ticket avec exactement la même image existe déjà. Aucun rapprochement n’est décidé à partir des seuls produits ou de la date."
        >
          <InlineAlert
            title="Examen nécessaire"
            message="Comparez les deux sources, puis conservez les deux tickets ou marquez cette nouvelle capture comme doublon."
          />
          {detail.duplicateCandidate ? (
            <Text className="text-sm leading-5 text-muted">
              Ticket existant du{" "}
              {formatDateTime(detail.duplicateCandidate.captureDate)}
            </Text>
          ) : (
            <Text className="text-sm leading-5 text-muted">
              Le ticket existant a été détecté sur le serveur et sa photo n’est
              pas stockée sur cet appareil.
            </Text>
          )}
          <SecondaryButton
            label={comparingDuplicate ? "Masquer la comparaison" : "Comparer"}
            onPress={() => setComparingDuplicate((value) => !value)}
          />
          {comparingDuplicate ? (
            <View className="gap-3 rounded-2xl border border-line bg-canvas p-4">
              <Text className="font-semibold text-ink">Ticket existant</Text>
              {detail.duplicateCandidate?.localFileUri ? (
                <Image
                  source={{ uri: detail.duplicateCandidate.localFileUri }}
                  resizeMode="contain"
                  className="h-64 w-full rounded-2xl bg-surface-muted"
                  accessibilityLabel="Photo du ticket existant"
                />
              ) : (
                <Text className="text-sm text-muted">
                  Photo existante indisponible sur cet appareil.
                </Text>
              )}
            </View>
          ) : null}
          <PrimaryButton
            label="Conserver les deux"
            loading={resolvingDuplicate}
            onPress={() => {
              setResolvingDuplicate(true);
              setError(undefined);
              void repository
                .resolveExactDuplicate(
                  detail.receipt.id,
                  "KEEP_BOTH",
                  randomUUID(),
                )
                .then(async () => {
                  setMessage(
                    "Les deux tickets sont conservés. L’envoi démarre.",
                  );
                  await load();
                  void syncNow(detail.receipt.storeId);
                })
                .catch(() => setError("Le choix n’a pas pu être enregistré."))
                .finally(() => setResolvingDuplicate(false));
            }}
          />
          <SecondaryButton
            label="Marquer comme doublon"
            disabled={resolvingDuplicate}
            onPress={() => {
              setResolvingDuplicate(true);
              setError(undefined);
              void repository
                .resolveExactDuplicate(detail.receipt.id, "CONFIRM_DUPLICATE")
                .then(async () => {
                  setMessage("Ce ticket est conservé et marqué comme doublon.");
                  await load();
                })
                .catch(() => setError("Le choix n’a pas pu être enregistré."))
                .finally(() => setResolvingDuplicate(false));
            }}
          />
        </SectionCard>
      ) : null}

      {detail.receipt.duplicateStatus === "CONFIRMED_DUPLICATE" ? (
        <InlineAlert
          title="Doublon confirmé"
          message="La nouvelle source reste conservée sur cet appareil et ne sera pas publiée."
        />
      ) : null}

      <SectionCard
        title="Photo source"
        description="L’original reste conservé sur cet appareil."
      >
        {detail.localFileUri ? (
          <Image
            source={{ uri: detail.localFileUri }}
            resizeMode="contain"
            className="h-80 w-full rounded-2xl bg-surface-muted"
            accessibilityLabel="Photo du ticket de casse"
          />
        ) : (
          <Text className="text-sm text-muted">Photo locale indisponible.</Text>
        )}
      </SectionCard>

      <SectionCard
        title="Date de casse"
        description={
          detail.receipt.detectedReceiptDate
            ? `Date détectée : ${formatDate(detail.receipt.detectedReceiptDate)}`
            : "Aucune date fiable n’a été détectée. Saisissez la date du ticket."
        }
      >
        <TextInput
          value={date}
          onChangeText={setDate}
          placeholder="AAAA-MM-JJ"
          autoCapitalize="none"
          className="min-h-12 rounded-xl border border-line bg-canvas px-4 text-base text-ink"
          accessibilityLabel="Date de casse au format année mois jour"
        />
        <PrimaryButton
          label="Confirmer la date"
          onPress={() => {
            setError(undefined);
            setMessage(undefined);
            void repository
              .confirmWasteDate(detail.receipt.id, date)
              .then(async () => {
                setMessage("La date de casse est confirmée.");
                await load();
              })
              .catch(() =>
                setError("Saisissez une date valide au format AAAA-MM-JJ."),
              );
          }}
        />
      </SectionCard>

      <View className="gap-4">
        <View className="gap-1">
          <Text className="text-xl font-semibold text-ink">
            Lignes du ticket
          </Text>
          <Text className="text-sm leading-5 text-muted">
            Les répétitions sont regroupées, mais chaque occurrence reste
            modifiable séparément.
          </Text>
        </View>
        {groups.map((group) => (
          <LineGroup
            key={group.key}
            label={group.label}
            lines={group.lines}
            receiptId={detail.receipt.id}
            repository={repository}
            onChanged={load}
            onMessage={setMessage}
            onError={setError}
          />
        ))}
      </View>

      <SecondaryButton label="Retour à Casse" onPress={() => router.back()} />
    </AppScreen>
  );
}

function LineGroup({
  label,
  lines,
  receiptId,
  repository,
  onChanged,
  onMessage,
  onError,
}: {
  label: string;
  lines: LocalWasteLineDraft[];
  receiptId: string;
  repository: WasteReceiptRepository;
  onChanged(): Promise<void>;
  onMessage(value: string | undefined): void;
  onError(value: string | undefined): void;
}) {
  const [expanded, setExpanded] = useState(lines.length === 1);
  const total = lines.reduce(
    (sum, item) => sum + Number(item.line.totalPrice ?? 0),
    0,
  );
  return (
    <SectionCard
      title={label}
      description={`${lines.length} occurrence${lines.length > 1 ? "s" : ""}${total > 0 ? ` · ${formatMoney(total)}` : ""}`}
    >
      {lines.length > 1 ? (
        <SecondaryButton
          label={expanded ? "Masquer les occurrences" : "Voir les occurrences"}
          onPress={() => setExpanded((value) => !value)}
        />
      ) : null}
      {expanded
        ? lines.map((draft) => (
            <LineEditor
              key={draft.line.id}
              draft={draft}
              receiptId={receiptId}
              repository={repository}
              onChanged={onChanged}
              onMessage={onMessage}
              onError={onError}
            />
          ))
        : null}
    </SectionCard>
  );
}

function LineEditor({
  draft,
  receiptId,
  repository,
  onChanged,
  onMessage,
  onError,
}: {
  draft: LocalWasteLineDraft;
  receiptId: string;
  repository: WasteReceiptRepository;
  onChanged(): Promise<void>;
  onMessage(value: string | undefined): void;
  onError(value: string | undefined): void;
}) {
  const [rawLabel, setRawLabel] = useState(draft.line.rawLabel);
  const [weight, setWeight] = useState(draft.line.weight ?? "");
  const [unitPrice, setUnitPrice] = useState(draft.line.unitPrice ?? "");
  const [totalPrice, setTotalPrice] = useState(draft.line.totalPrice ?? "");

  useEffect(() => {
    setRawLabel(draft.line.rawLabel);
    setWeight(draft.line.weight ?? "");
    setUnitPrice(draft.line.unitPrice ?? "");
    setTotalPrice(draft.line.totalPrice ?? "");
  }, [draft]);

  return (
    <View className="gap-3 rounded-2xl border border-line bg-canvas p-4">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-sm font-semibold text-muted">
          Ligne {draft.line.sourceLineIndex + 1}
        </Text>
        {draft.line.validationStatus === "TO_REVIEW" ? (
          <StatusBadge status="incomplete" />
        ) : null}
      </View>

      <Field label="Libellé" value={rawLabel} onChangeText={setRawLabel} />
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Field
            label="Poids (kg)"
            value={weight}
            onChangeText={setWeight}
            decimal
          />
        </View>
        <View className="flex-1">
          <Field
            label="Prix unitaire (€)"
            value={unitPrice}
            onChangeText={setUnitPrice}
            decimal
          />
        </View>
      </View>
      <Field
        label="Montant (€)"
        value={totalPrice}
        onChangeText={setTotalPrice}
        decimal
      />

      {draft.arithmeticStatus === "MISMATCH" ? (
        <InlineAlert
          title="Montant à vérifier"
          message={`Calcul attendu : ${draft.arithmeticExpectedTotal ?? "inconnu"} € · écart : ${draft.arithmeticDifference ?? "inconnu"} €.`}
        />
      ) : null}

      <View className="gap-2">
        <Text className="text-sm font-semibold text-ink">Produit associé</Text>
        <Text className="text-sm text-muted">
          {draft.matchedProductLabel ??
            (draft.candidates.length > 0
              ? "Choisissez le bon produit."
              : "Aucun produit proposé.")}
        </Text>
        {draft.candidates.map((candidate) => (
          <Pressable
            key={candidate.productId}
            accessibilityRole="button"
            accessibilityLabel={`Associer à ${candidate.label}`}
            onPress={() => {
              onError(undefined);
              onMessage(undefined);
              void repository
                .selectProductCandidate(
                  receiptId,
                  draft.line.id,
                  candidate.productId,
                )
                .then(async () => {
                  onMessage(`Produit associé : ${candidate.label}.`);
                  await onChanged();
                })
                .catch(() => onError("Ce produit ne peut pas être associé."));
            }}
            className={`min-h-12 justify-center rounded-xl border px-4 py-3 ${
              draft.line.matchedProductId === candidate.productId
                ? "border-forest bg-positive-soft"
                : "border-line bg-white"
            }`}
          >
            <Text className="font-semibold text-ink">{candidate.label}</Text>
            <Text className="text-sm text-muted">
              {natureLabel(candidate.nature)} · score{" "}
              {Math.round(candidate.score * 100)} %
            </Text>
          </Pressable>
        ))}
      </View>

      <PrimaryButton
        label="Enregistrer la ligne"
        onPress={() => {
          onError(undefined);
          onMessage(undefined);
          void repository
            .updateLineValues(receiptId, draft.line.id, {
              rawLabel,
              weight: emptyToNull(weight),
              unitPrice: emptyToNull(unitPrice),
              totalPrice: emptyToNull(totalPrice),
            })
            .then(async () => {
              onMessage(`Ligne ${draft.line.sourceLineIndex + 1} enregistrée.`);
              await onChanged();
            })
            .catch(() =>
              onError("Vérifiez le libellé et les valeurs numériques."),
            );
        }}
      />
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  decimal = false,
}: {
  label: string;
  value: string;
  onChangeText(value: string): void;
  decimal?: boolean;
}) {
  return (
    <View className="gap-1">
      <Text className="text-sm font-medium text-muted">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={decimal ? "decimal-pad" : "default"}
        className="min-h-12 rounded-xl border border-line bg-white px-3 text-base text-ink"
      />
    </View>
  );
}

function groupLines(lines: readonly LocalWasteLineDraft[]) {
  const groups = new Map<string, LocalWasteLineDraft[]>();
  for (const line of lines) {
    const key = line.line.rawLabel
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLocaleUpperCase("fr-FR")
      .replace(/\s+/g, " ")
      .trim();
    const current = groups.get(key) ?? [];
    current.push(line);
    groups.set(key, current);
  }
  return [...groups.entries()].map(([key, linesInGroup]) => ({
    key,
    label: linesInGroup[0]?.line.rawLabel ?? key,
    lines: linesInGroup,
  }));
}

function emptyToNull(value: string) {
  return value.trim() ? value.trim().replace(",", ".") : null;
}

function natureLabel(value: "BULK" | "PACKAGED" | "UNKNOWN") {
  if (value === "BULK") return "Vrac";
  if (value === "PACKAGED") return "Emballé";
  return "Nature à confirmer";
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatDateTime(value: string | null) {
  if (!value) return "date inconnue";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "date inconnue"
    : new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}
