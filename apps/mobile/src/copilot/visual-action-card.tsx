import type { PreparedVisualSourcePhoto } from "./visual-source-photo";
import { visualConflictSummary } from "../products/visual-conflict-presentation";
import { useCallback, useMemo, useState, useRef, useLayoutEffect } from "react";
import {
  ActivityIndicator,
  Pressable,
  Switch,
  Text,
  View,
  Image,
} from "react-native";
import type { CopilotMessage } from "@fl-copilot/domain";
import type { CopilotVisualActionController } from "./visual-action-controller";
import { useReviewedConflict } from "../components/use-reviewed-conflict";
import { VisualVersion } from "../products/visual-conflict-preview";
import { colors } from "../design/tokens";
export function VisualActionCard({
  message,
  controller,
  canConfirm,
  onSaved,
  requestPreview,
}: {
  message: CopilotMessage;
  controller: CopilotVisualActionController;
  canConfirm: boolean;
  onSaved: () => void;
  requestPreview: (assetId: string) => Promise<void>;
}) {
  const scope = useMemo(
    () => ({ message, controller, canConfirm }),
    [message, controller, canConfirm],
  );
  const [sourceImage, setSourceImage] = useState<{
    scope: object;
    review: unknown;
    prepared: PreparedVisualSourcePhoto;
  }>();
  const [rights, setRights] = useState<{ scope: object; review: unknown }>();
  const imageContext = useRef<unknown>(undefined);
  const [photo, setPhoto] = useState<{ scope: object; review: unknown }>(),
    [global, setGlobal] = useState<{ scope: object; review: unknown }>(),
    [restore, setRestore] = useState<{ scope: object; review: unknown }>(),
    [comparison, setComparison] = useState<{
      scope: object;
      review: unknown;
    }>(),
    [previewRun, setPreviewRun] = useState(0),
    [fetching, setFetching] = useState<{ scope: object; review: unknown }>(),
    [fileError, setFileError] = useState<{
      scope: object;
      review: unknown;
      message: string;
    }>(),
    [completed, setCompleted] = useState<{ scope: object; result: unknown }>();
  const approved = (
    value: { scope: object; review: unknown } | undefined,
    review: unknown,
  ) => value?.scope === scope && value.review === review;
  const read = useCallback(
    () => controller.open(message),
    [controller, message],
  );
  const state = useReviewedConflict({
    scope,
    read,
    canChoose: (r) =>
      canConfirm &&
      approved(comparison, r) &&
      r.status === "READY" &&
      !!r.review &&
      (!["ASSIGN_LIBRARY", "ASSIGN_SOURCE"].includes(r.content.input.action) ||
        approved(photo, r)) &&
      (r.content.input.action !== "ASSIGN_SOURCE" || approved(rights, r)) &&
      (r.content.input.action !== "REVOKE_CURRENT" || approved(global, r)) &&
      (!r.review.currentLink?.entity.deletedAt ||
        !["ASSIGN_LIBRARY", "ASSIGN_SOURCE"].includes(r.content.input.action) ||
        approved(restore, r)),
    choose: async (r, _local, lifetime) => {
      if (r.status !== "READY" || !r.review) throw Error("VISUAL_ACTION_STALE");
      const result = await controller.confirm(
        message,
        r.review.basisHash,
        {
          photoReviewed:
            ["ASSIGN_LIBRARY", "ASSIGN_SOURCE"].includes(
              r.content.input.action,
            ) && approved(photo, r),
          confirmGlobalRevoke:
            r.content.input.action === "REVOKE_CURRENT" && approved(global, r),
          ...(r.content.input.action === "ASSIGN_SOURCE"
            ? { rightsConfirmed: approved(rights, r) }
            : {}),
          restoreAssociation:
            ["ASSIGN_LIBRARY", "ASSIGN_SOURCE"].includes(
              r.content.input.action,
            ) &&
            !!r.review.currentLink?.entity.deletedAt &&
            approved(restore, r),
        },
        lifetime.signal,
        lifetime.canResolve,
      );
      if (lifetime.canResolve()) setCompleted({ scope, result: result.result });
    },
    onSuccess: onSaved,
    errorText: () =>
      "L’image ou la fiche a changé, ou vos droits ne sont plus disponibles. Votre choix n’a pas été appliqué ; relisez les informations avant de confirmer.",
  });
  const r = state.review,
    review = r?.review,
    key = review?.basisHash,
    action = r?.content.input.action,
    done = completed?.scope === scope || r?.status === "COMPLETED";
  const asset =
    action === "ASSIGN_SOURCE"
      ? null
      : action === "ASSIGN_LIBRARY"
        ? review?.selectedAsset?.entity
        : review?.currentAsset?.entity;
  const identity =
    action === "ASSIGN_SOURCE"
      ? null
      : action === "ASSIGN_LIBRARY"
        ? review?.selectedIdentity?.entity
        : review?.currentIdentity?.entity;
  const ready = canConfirm && r?.status === "READY" && !done;
  const needsPhoto = action === "ASSIGN_LIBRARY" || action === "ASSIGN_SOURCE",
    needsGlobal = action === "REVOKE_CURRENT",
    needsRestore = needsPhoto && !!review?.currentLink?.entity.deletedAt;
  const allowed =
    ready &&
    state.compared &&
    approved(comparison, r) &&
    (!needsPhoto || approved(photo, r)) &&
    (action !== "ASSIGN_SOURCE" || approved(rights, r)) &&
    (!needsGlobal || approved(global, r)) &&
    (!needsRestore || approved(restore, r)) &&
    !state.reading &&
    !state.busy &&
    !state.error;
  const displayedSourceImage = approved(sourceImage, r)
    ? sourceImage
    : undefined;
  useLayoutEffect(() => {
    imageContext.current = displayedSourceImage;
    return () => {
      imageContext.current = undefined;
    };
  }, [displayedSourceImage]);
  async function recover() {
    if (
      (action !== "ASSIGN_SOURCE" && !asset) ||
      approved(fetching, r) ||
      approved(photo, r) ||
      !state.isCurrent() ||
      done
    )
      return;
    setFetching({ scope, review: r });
    setFileError(undefined);
    try {
      if (action === "ASSIGN_SOURCE") {
        const prepared = await controller.prepareSourcePhoto(
          message,
          undefined,
          state.isCurrent,
        );
        if (state.isCurrent()) setSourceImage({ scope, review: r, prepared });
      } else await requestPreview(asset!.id);
      if (state.isCurrent()) setPreviewRun((n) => n + 1);
    } catch (error) {
      if (state.isCurrent())
        setFileError({
          scope,
          review: r,
          message:
            error instanceof Error &&
            error.message === "VISUAL_SOURCE_SIZE_LIMIT"
              ? "Cette photo dépasse les 12 Mio de la bibliothèque produit. Joignez une copie plus légère ; l’original reste conservé et consultable dans le chat."
              : "L’aperçu n’est pas encore disponible. L’original reste conservé ; vous pourrez réessayer après synchronisation.",
        });
    } finally {
      if (state.isCurrent()) setFetching(undefined);
    }
  }
  return (
    <View
      style={{
        padding: 16,
        gap: 12,
        borderWidth: 1,
        borderRadius: 16,
        borderColor: colors.line,
      }}
    >
      <Text style={{ fontWeight: "700", color: colors.ink }}>
        {action === "REVOKE_CURRENT"
          ? "Retirer cette image de la bibliothèque"
          : action === "REMOVE_PRODUCT"
            ? "Retirer l’image du produit"
            : "Changer l’image du produit"}
      </Text>
      {state.reading ? (
        <ActivityIndicator accessibilityLabel="Vérification de l’image et du produit" />
      ) : null}
      {r?.content.basis.product ? (
        <Text style={{ color: colors.ink }}>
          {r.content.basis.product.metadata.label}
        </Text>
      ) : null}
      {done ? (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.ink }}>
          Choix enregistré sur cet appareil. Les originaux restent conservés.
        </Text>
      ) : null}
      {!done && r && r.status !== "READY" ? (
        <Text style={{ color: colors.muted }}>
          Cette proposition n’est plus applicable ici. Synchronisez puis
          demandez un nouvel aperçu ; aucune image n’a été remplacée.
        </Text>
      ) : null}
      {ready && review ? (
        <>
          {action === "ASSIGN_SOURCE" ? (
            <>
              <Text style={{ color: colors.muted }}>
                Photo jointe : {review.basis.sourcePhoto?.filename}. L’original
                restera conservé.
              </Text>
              {displayedSourceImage ? (
                <Image
                  source={{ uri: displayedSourceImage.prepared.uri }}
                  resizeMode="contain"
                  style={{ width: "100%", height: 180 }}
                  accessibilityLabel="Photo jointe à vérifier pour ce produit"
                  onLoad={() => {
                    if (
                      imageContext.current === displayedSourceImage &&
                      state.isCurrent()
                    )
                      setPhoto({ scope, review: r });
                  }}
                  onError={() => {
                    if (
                      imageContext.current === displayedSourceImage &&
                      state.isCurrent()
                    ) {
                      setPhoto(undefined);
                      setSourceImage(undefined);
                    }
                  }}
                />
              ) : null}
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Switch
                  accessibilityLabel="Je confirme les droits d’utilisation de cette photo"
                  value={approved(rights, r)}
                  onValueChange={(v) =>
                    setRights(v ? { scope, review: r } : undefined)
                  }
                />
                <Text style={{ color: colors.ink, flex: 1 }}>
                  Je dispose des droits pour utiliser cette photo comme image
                  produit.
                </Text>
              </View>
            </>
          ) : null}
          {identity ? (
            <Text style={{ color: colors.muted }}>
              {visualConflictSummary(identity, {})[1]}
            </Text>
          ) : null}
          {asset ? (
            <VisualVersion
              key={`${key}/${previewRun}`}
              title={identity?.canonicalName ?? "Image concernée"}
              entity={asset}
              labels={{}}
              preview={asset}
              compact
              onPreviewReady={(loaded) => {
                if (state.isCurrent() && needsPhoto)
                  setPhoto(loaded ? { scope, review: r } : undefined);
              }}
            />
          ) : null}
          {needsPhoto ? (
            <>
              <Text style={{ color: colors.muted }}>
                Affichez la photo pour vérifier qu’elle correspond au produit.
                Une image générique ou illustrative ne confirme ni emballage, ni
                marque, ni origine.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  action === "ASSIGN_SOURCE"
                    ? "Préparer la photo jointe"
                    : "Récupérer l’aperçu de cette image"
                }
                disabled={approved(fetching, r) || state.busy}
                accessibilityState={{
                  disabled: approved(fetching, r) || state.busy,
                }}
                style={{
                  minHeight: 44,
                  justifyContent: "center",
                  paddingVertical: 10,
                }}
                onPress={() => void recover()}
              >
                <Text style={{ color: colors.forest }}>
                  {approved(fetching, r)
                    ? "Récupération de l’aperçu…"
                    : action === "ASSIGN_SOURCE"
                      ? "Préparer la photo jointe"
                      : "Récupérer l’aperçu si nécessaire"}
                </Text>
              </Pressable>
            </>
          ) : null}
          {action === "REMOVE_PRODUCT" ? (
            <Text style={{ color: colors.muted }}>
              L’association de cette image au produit sera retirée. L’image et
              ses autres associations restent dans la bibliothèque.
            </Text>
          ) : null}
          {needsGlobal ? (
            <>
              <Text style={{ color: colors.muted }}>
                Cette image cessera d’être distribuée pour tous les produits qui
                l’utilisent. Les originaux sont conservés.
              </Text>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Switch
                  accessibilityLabel="Je confirme le retrait de cette image pour tous les produits"
                  value={approved(global, r)}
                  onValueChange={(v) =>
                    setGlobal(v ? { scope, review: r } : undefined)
                  }
                />
                <Text style={{ color: colors.ink, flex: 1 }}>
                  Retirer cette image pour tous les produits.
                </Text>
              </View>
            </>
          ) : null}
          {needsRestore ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <Switch
                accessibilityLabel="Je confirme le rétablissement de l’association à une image"
                value={approved(restore, r)}
                onValueChange={(v) =>
                  setRestore(v ? { scope, review: r } : undefined)
                }
              />
              <Text style={{ color: colors.ink, flex: 1 }}>
                Rétablir explicitement une association retirée.
              </Text>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Switch
              accessibilityLabel="J’ai vérifié l’image et je confirme ce choix"
              value={state.compared && approved(comparison, r)}
              onValueChange={(v) => {
                setComparison(v ? { scope, review: r } : undefined);
                state.setCompared(v);
              }}
            />
            <Text style={{ color: colors.ink, flex: 1 }}>
              J’ai vérifié et je confirme ce choix.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Confirmer le choix d’image"
            accessibilityState={{ disabled: !allowed }}
            disabled={!allowed}
            onPress={() => void state.resolve(true)}
            style={{
              padding: 12,
              minHeight: 44,
              justifyContent: "center",
              borderRadius: 12,
              backgroundColor: colors.forest,
              opacity: allowed ? 1 : 0.5,
            }}
          >
            <Text style={{ color: colors.onAccent, fontWeight: "700" }}>
              {state.busy ? "Enregistrement…" : "Confirmer ce choix"}
            </Text>
          </Pressable>
        </>
      ) : null}
      {state.error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.critical }}
        >
          {state.error}
        </Text>
      ) : null}
      {approved(fileError, r) ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.critical }}
        >
          {fileError!.message}
        </Text>
      ) : null}
      {!done ? (
        <Pressable
          accessibilityLabel="Relire les informations"
          accessibilityRole="button"
          disabled={state.reading || state.busy}
          accessibilityState={{ disabled: state.reading || state.busy }}
          style={{
            minHeight: 44,
            justifyContent: "center",
            paddingVertical: 10,
          }}
          onPress={() => {
            setPhoto(undefined);
            setSourceImage(undefined);
            setRights(undefined);
            setGlobal(undefined);
            setRestore(undefined);
            state.reload();
          }}
        >
          <Text style={{ color: colors.forest }}>Relire les informations</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
