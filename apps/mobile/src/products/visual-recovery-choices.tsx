import { Text, View } from "react-native";
import { InlineAlert, PrimaryButton, SecondaryButton } from "../components/ui";
import { VisualVersion, VisualReviewCheck } from "./visual-conflict-preview";
import { syncFailurePresentation } from "../sync/failure-presentation";
import type {
  VisualRecoveryRepository,
  VisualRecoveryAction,
} from "./visual-recovery-repository";
export type VisualRecoveryReview = Awaited<
  ReturnType<VisualRecoveryRepository["review"]>
>;
export type VisualRecoverySelection = {
  action: VisualRecoveryAction | null;
  checked: boolean;
  reactivate: boolean;
  rightsConfirmed: boolean;
};
function consents(
  review: VisualRecoveryReview,
  action: VisualRecoverySelection["action"],
) {
  const needsExtra =
    action === "RETRY_LOCAL"
      ? review.retryReactivates
      : action === "ADOPT_REMOTE" && review.adoptReactivates;
  const needsRights =
    action === "RETRY_LOCAL" &&
    !review.current.entity.deletedAt &&
    "provenance" in review.current.entity &&
    review.current.entity.provenance.type === "USER_UPLOAD";
  return { needsExtra, needsRights };
}
export function visualRecoverySelectionReady(
  review: VisualRecoveryReview,
  selection: VisualRecoverySelection,
) {
  const { action, checked, reactivate, rightsConfirmed } = selection;
  const permitted =
    action === "RETRY_LOCAL"
      ? review.canRetry
      : action === "REMOVE_LINK"
        ? review.canRemove
        : action === "RETIRE_LOCAL"
          ? review.canRetire
          : action === "ADOPT_REMOTE" && review.canAdopt;
  const { needsExtra, needsRights } = consents(review, action);
  return (
    !!permitted &&
    checked &&
    (!needsExtra || reactivate) &&
    (!needsRights || rightsConfirmed)
  );
}
/** Shared manual/chat presentation only; the canonical recovery repository remains the authority. */
export function VisualRecoveryChoices({
  review,
  selection,
  busy,
  canConfirm,
  onAction,
  onChecked,
  onReactivate,
  onRights,
  onConfirm,
}: {
  review: VisualRecoveryReview;
  selection: VisualRecoverySelection;
  busy: boolean;
  canConfirm: boolean;
  onAction(action: VisualRecoveryAction): void;
  onChecked(): void;
  onReactivate(): void;
  onRights(): void;
  onConfirm(): void;
}) {
  const kind = review.kind,
    { action, checked, reactivate: extra, rightsConfirmed: rights } = selection;
  const { needsExtra, needsRights } = consents(review, action);
  const enabled =
    canConfirm && !busy && visualRecoverySelectionReady(review, selection);
  return (
    <View className="gap-4">
      <InlineAlert
        title="Enregistrement refusé"
        message={
          syncFailurePresentation(
            kind,
            review.commands.filter((c) => c.status === "FAILED").at(-1)
              ?.last_error_code ?? null,
          ).message
        }
      />
      <VisualVersion
        key={`${review.hash}:local`}
        title="Choix conservé sur cet appareil"
        entity={review.current.entity}
        labels={review.labels}
        preview={review.preview}
      />
      {review.remote ? (
        <VisualVersion
          key={`${review.hash}:remote`}
          title="Version connue à la dernière synchronisation"
          entity={review.remote}
          labels={review.labels}
          preview={"contentHash" in review.remote ? review.remote : null}
        />
      ) : null}
      <Text className="text-base text-muted">{review.reason}</Text>
      <SecondaryButton
        label={
          action === "RETRY_LOCAL" ? "✓ Retenter ce choix" : "Retenter ce choix"
        }
        disabled={busy || !review.canRetry}
        onPress={() => onAction("RETRY_LOCAL")}
      />
      {review.canAdopt ? (
        <SecondaryButton
          label={
            action === "ADOPT_REMOTE"
              ? "✓ Garder la version synchronisée connue"
              : "Garder la version synchronisée connue"
          }
          disabled={busy}
          onPress={() => onAction("ADOPT_REMOTE")}
        />
      ) : null}
      {kind === "product_visual_link" ? (
        <SecondaryButton
          label={
            action === "REMOVE_LINK"
              ? "✓ Retirer cette association"
              : "Retirer cette association"
          }
          disabled={busy || !review.canRemove}
          onPress={() => onAction("REMOVE_LINK")}
        />
      ) : null}
      {review.canRetire ? (
        <SecondaryButton
          label={
            action === "RETIRE_LOCAL"
              ? "✓ Retirer ce choix local"
              : "Retirer ce choix local"
          }
          disabled={busy}
          onPress={() => onAction("RETIRE_LOCAL")}
        />
      ) : null}
      {action === "REMOVE_LINK" || action === "RETIRE_LOCAL" ? (
        <Text className="text-base text-muted">
          Le produit et la photo sont conservés. Le retrait sera contrôlé par le
          serveur ; une version distante inconnue ne sera pas remplacée
          automatiquement.
        </Text>
      ) : null}
      {needsExtra ? (
        <VisualReviewCheck
          checked={extra}
          disabled={busy}
          label="Je confirme la remise en diffusion de cet élément retiré ou supprimé."
          onPress={() => onReactivate()}
        />
      ) : null}
      {needsRights ? (
        <VisualReviewCheck
          checked={rights}
          disabled={busy}
          label="Je confirme disposer des droits d’utilisation de cette photo."
          onPress={() => onRights()}
        />
      ) : null}
      <VisualReviewCheck
        checked={checked}
        disabled={busy || !action}
        label="J’ai relu ce choix et je confirme cette reprise."
        onPress={() => onChecked()}
      />
      <PrimaryButton
        label={busy ? "Enregistrement…" : "Confirmer la reprise"}
        disabled={!enabled}
        onPress={onConfirm}
      />
    </View>
  );
}
