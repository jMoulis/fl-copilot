import { Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  commercialExecutionProgress,
  commercialExecutionSameTarget,
  type CommercialExecutionProposal,
} from "@fl-copilot/commercial-core";
import type {
  CommercialExecutionTask,
  CommercialWeekPlan,
} from "@fl-copilot/domain";
import { SegmentedControl } from "../components/dashboard";
import { StatusBadge } from "../components/ui";
import { colors } from "../design/tokens";
import {
  LinkedProductVisual,
  type SharedProductVisuals,
} from "../products/linked-product-visual";
import type { LocalCommercialExecution } from "./execution-repository";
import {
  executionStatusLabels,
  commercialExecutionError,
  executionTaskContext,
} from "./execution-presentation";

export type ExecutionFilter = "ALL" | CommercialExecutionTask["status"];

/** Presentation only: opening a row never creates a declaration or changes its status. */
export function ExecutionChecklistView({
  plan,
  proposals,
  records,
  filter,
  onFilter,
  onOpen,
  visuals,
  disabled = false,
}: {
  plan: CommercialWeekPlan;
  proposals: CommercialExecutionProposal[];
  records: LocalCommercialExecution[];
  filter?: ExecutionFilter;
  onFilter(value: ExecutionFilter): void;
  onOpen(
    proposal: CommercialExecutionProposal,
    record: LocalCommercialExecution | null,
  ): void;
  visuals: SharedProductVisuals;
  disabled?: boolean;
}) {
  const progress = commercialExecutionProgress(
    proposals,
    records.map((r) => r.entity),
  );
  const rows = proposals
    .map((proposal) => ({
      proposal,
      record:
        records.find((r) =>
          commercialExecutionSameTarget(r.entity, proposal),
        ) ?? null,
    }))
    .filter(
      ({ record }) =>
        !filter ||
        filter === "ALL" ||
        (record?.entity.status ?? "TODO") === filter,
    );
  return (
    <View className="gap-3">
      <View className="gap-2">
        <View className="flex-row flex-wrap items-baseline justify-between gap-2">
          <Text className="text-2xl font-bold text-ink">
            {progress.DONE}
            <Text className="text-base font-normal text-muted">
              {" "}
              / {progress.total} réalisées
            </Text>
          </Text>
          <Text className="text-sm text-muted">{progress.TODO} à faire</Text>
        </View>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Tâches déclarées faites dans ce plan"
          accessibilityValue={{
            min: 0,
            max: progress.total || 1,
            now: progress.DONE,
            text: `${progress.DONE} sur ${progress.total}`,
          }}
          style={{
            height: 5,
            borderRadius: 4,
            overflow: "hidden",
            backgroundColor: colors.line,
          }}
        >
          <View
            style={{
              height: 5,
              borderRadius: 4,
              backgroundColor: colors.forest,
              width: `${progress.total ? (progress.DONE / progress.total) * 100 : 0}%`,
            }}
          />
        </View>
        {progress.SKIPPED || progress.NOT_APPLICABLE ? (
          <Text className="text-sm text-muted">
            {progress.SKIPPED} ignorées · {progress.NOT_APPLICABLE} non
            applicables
          </Text>
        ) : null}
      </View>
      {filter ? (
        <SegmentedControl
          label="Afficher les tâches"
          value={filter}
          onChange={onFilter}
          options={[
            { value: "TODO", label: `À faire (${progress.TODO})` },
            { value: "DONE", label: `Faites (${progress.DONE})` },
            { value: "ALL", label: `Toutes (${progress.total})` },
          ]}
        />
      ) : null}
      <View>
        {rows.map(({ proposal: p, record: r }) => {
          const status = r?.entity.status ?? "TODO";
          const conflict = r?.syncState === "CONFLICT";
          const syncLabel = r
            ? ((
                {
                  PENDING: "À synchroniser",
                  SYNCED: "Synchronisé",
                  CONFLICT: "Conflit à résoudre",
                  ERROR: "Envoi refusé",
                } as Record<string, string>
              )[r.syncState] ?? r.syncState)
            : "Pas encore déclarée";
          const offer = plan.offers.find((o) => o.id === p.targetId);

          return (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`${conflict ? "Comparer la déclaration" : "Ouvrir la déclaration"} : ${p.label}. ${executionStatusLabels[status]}. ${syncLabel}.`}
              accessibilityHint="L’ouverture ne modifie pas le statut de la tâche."
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() => onOpen(p, r)}
              className="flex-row items-start gap-3 border-b border-line py-4"
              style={({ pressed }) => ({
                minHeight: 72,
                opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
              })}
            >
              <Ionicons
                accessible={false}
                name={
                  conflict
                    ? "alert-circle-outline"
                    : status === "DONE"
                      ? "checkmark-circle"
                      : status === "TODO"
                        ? "ellipse-outline"
                        : "remove-circle-outline"
                }
                size={24}
                color={
                  conflict
                    ? colors.warning
                    : status === "DONE"
                      ? colors.forest
                      : colors.muted
                }
                style={{ marginTop: 2 }}
              />
              <View className="flex-1 gap-2">
                <Text className="text-base font-semibold leading-6 text-ink">
                  {p.label}
                </Text>
                <View className="flex-row flex-wrap items-center gap-2">
                  <Text
                    className={
                      status === "DONE"
                        ? "text-sm font-semibold text-forest"
                        : "text-sm text-muted"
                    }
                  >
                    {executionStatusLabels[status]}
                  </Text>
                  {r &&
                  ["PENDING", "SYNCED", "CONFLICT", "ERROR"].includes(
                    r.syncState,
                  ) ? (
                    <StatusBadge
                      compact
                      status={
                        r.syncState === "CONFLICT"
                          ? "conflict"
                          : r.syncState === "ERROR"
                            ? "error"
                            : r.syncState === "SYNCED"
                              ? "synced"
                              : r.syncState === "PENDING"
                                ? "pending"
                                : "local"
                      }
                    />
                  ) : r ? (
                    <Text className="text-sm text-muted">{syncLabel}</Text>
                  ) : null}
                </View>
                <Text
                  numberOfLines={2}
                  className="text-sm leading-5 text-muted"
                >
                  {r?.entity.note || executionTaskContext(plan, p.targetId)}
                </Text>
                {r?.syncState === "ERROR" ? (
                  <Text className="text-sm leading-5 text-warning">
                    {commercialExecutionError(r.lastErrorCode ?? undefined)}
                  </Text>
                ) : null}
                {conflict ? (
                  <Text className="text-sm text-warning">
                    Comparer dans Synchronisation
                  </Text>
                ) : null}
              </View>
              <View className="items-center gap-2">
                {offer ? (
                  <LinkedProductVisual
                    size={40}
                    productId={offer.productId}
                    storeId={offer.storeId}
                    visuals={visuals}
                  />
                ) : (
                  <Ionicons
                    accessible={false}
                    name="storefront-outline"
                    size={21}
                    color={colors.muted}
                  />
                )}
                <Ionicons
                  accessible={false}
                  name="chevron-forward"
                  size={16}
                  color={colors.muted}
                />
              </View>
            </Pressable>
          );
        })}
      </View>
      {!rows.length ? (
        <Text className="text-base leading-6 text-muted">
          {!proposals.length
            ? "Aucune tâche d’affiche ou de TG dans cette version du plan."
            : filter === "TODO"
              ? "Aucune tâche à faire. Consultez Toutes pour revoir les déclarations."
              : "Aucune tâche dans ce filtre."}
        </Text>
      ) : null}
    </View>
  );
}
