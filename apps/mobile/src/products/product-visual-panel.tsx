import { withVisualFiles } from "./visual-file-lock";
import { useMemo, useState, type ReactNode } from "react";
import { IconButton } from "../components/dashboard";
import {
  Alert,
  Image,
  Linking,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Product, VisualIdentity } from "@fl-copilot/domain";
import {
  BottomSheet,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
} from "../components/ui";
import { colors } from "../design/tokens";
import { ProductVisual } from "./product-visual";
import {
  resolveLibraryState,
  visualTransferLabel,
  visualErrorMessage,
  productVisualRecoveryTargets,
} from "./visual-library-state";
import { VisualRecoveryForm } from "./visual-recovery";
import type { VisualLibraryController } from "./use-visual-library";
import {
  assignCapturedVisual,
  assignLibraryVisual,
  removeProductVisual,
  revokeLibraryVisual,
  loadVisualSelectionBasis,
  type VisualSelectionBasis,
} from "./visual-library-actions";
import { nativeVisualFileStorage } from "./visual-file-storage";
import type { LocalVisualRecord } from "./visual-library-repository";
type Choice =
  | { kind: "PHOTO"; uri: string; basis: VisualSelectionBasis }
  | {
      kind: "LIBRARY";
      identity: LocalVisualRecord<VisualIdentity>;
      basis: VisualSelectionBasis;
    };
/** Editing is explicit; opening a candidate never associates or approves it. */
export function ProductVisualPanel({
  product,
  controller: gallery,
  header,
}: {
  product: Product;
  controller: VisualLibraryController;
  header?: ReactNode;
}) {
  const [options, setOptions] = useState(false);
  const [recovery, setRecovery] = useState<{
    kind: "visual_asset" | "visual_identity" | "product_visual_link";
    id: string;
  } | null>(null);
  const [open, setOpen] = useState(false),
    [choice, setChoice] = useState<Choice | null>(null),
    [basis, setBasis] = useState<VisualSelectionBasis | null>(null);
  const [busy, setBusy] = useState(false),
    [checked, setChecked] = useState(false),
    [previewReady, setPreviewReady] = useState(false),
    [available, setAvailable] = useState(false);
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [error, setError] = useState<string>(),
    [notice, setNotice] = useState<string>();
  const state = gallery.state,
    resolution = resolveLibraryState(state, product),
    asset = resolution.kind === "ASSET" ? resolution.asset : null;
  const selectedAsset =
    choice?.kind === "LIBRARY"
      ? state?.assets.get(choice.identity.entity.primaryAssetId ?? "")?.entity
      : null;
  const identities = useMemo(
    () =>
      [...(state?.identities.values() ?? [])]
        .filter((r) => {
          const a = state?.assets.get(r.entity.primaryAssetId ?? "");
          return (
            !r.entity.deletedAt &&
            !r.remote?.deletedAt &&
            !["CONFLICT", "ERROR"].includes(r.syncState) &&
            !!a &&
            !a.entity.deletedAt &&
            !a.remote?.deletedAt &&
            a.entity.review.status === "APPROVED" &&
            !["REVOKED", "REJECTED"].includes(a.remote?.review.status ?? "") &&
            !["ERROR", "CONFLICT"].includes(a.syncState) &&
            r.entity.canonicalName
              .toLocaleLowerCase("fr")
              .includes(query.trim().toLocaleLowerCase("fr"))
          );
        })
        .sort((a, b) =>
          a.entity.canonicalName.localeCompare(b.entity.canonicalName, "fr"),
        ),
    [state, query],
  );
  const showError = (e: unknown) => setError(visualErrorMessage(e));
  const close = () => {
    if (!busy) {
      setOpen(false);
      setChoice(null);
      setChecked(false);
    }
  };
  const saved = (message: string) => {
    setNotice(message);
    setError(undefined);
    setOpen(false);
    setChoice(null);
    setChecked(false);
    void gallery.refresh().catch(() => undefined);
    void gallery.synchronize().catch(() => undefined);
  };
  const begin = async () => {
    if (!gallery.context) return;
    setBusy(true);
    setError(undefined);
    try {
      const fresh = await loadVisualSelectionBasis(
        gallery.sqlite,
        product.id,
        gallery.context,
      );
      const displayed = state?.links.get(product.id) ?? [];
      if (
        fresh.product.product.entity.version !== product.version ||
        displayed.length > 1 ||
        JSON.stringify(fresh.link?.entity ?? null) !==
          JSON.stringify(displayed[0]?.entity ?? null)
      )
        throw Error("VISUAL_SELECTION_CHANGED");
      setBasis(fresh);
      setChoice(null);
      setChecked(false);
      setQuery("");
      setPage(0);
      setOpen(true);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };
  const photo = async () => {
    if (!basis) return;
    setBusy(true);
    setError(undefined);
    try {
      const picker = await import("expo-image-picker");
      const result = await picker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        quality: 1,
        exif: false,
      });
      if (result.canceled) return;
      const selected = result.assets[0];
      if (
        !selected ||
        (selected.fileSize && selected.fileSize > 12 * 1024 * 1024) ||
        selected.width * selected.height > 36_000_000
      )
        throw Error("VISUAL_FILE_INVALID");
      setPreviewReady(false);
      setChecked(false);
      setChoice({ kind: "PHOTO", uri: selected.uri, basis });
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!choice || !checked || !previewReady || !gallery.context || busy)
      return;
    setBusy(true);
    setError(undefined);
    try {
      if (choice.kind === "PHOTO") {
        const ctx = gallery.context;
        await withVisualFiles(ctx.storeId, async () => {
          const copy = await nativeVisualFileStorage.capture(
            ctx.storeId,
            choice.uri,
          );
          const retainedUri = await nativeVisualFileStorage.uri(
            ctx.storeId,
            "SOURCE",
            copy,
          );
          if (retainedUri) setChoice({ ...choice, uri: retainedUri });
          await assignCapturedVisual(
            gallery.sqlite,
            choice.basis,
            copy,
            true,
            ctx,
          );
        });
        saved(
          "Photo et association enregistrées sur cet appareil. L’envoi se poursuivra en arrière-plan.",
        );
      } else {
        await assignLibraryVisual(
          gallery.sqlite,
          choice.basis,
          choice.identity,
          gallery.context,
        );
        saved(
          "Image choisie pour ce produit. Aucun autre produit n’a été modifié.",
        );
      }
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!gallery.context) return;
    setBusy(true);
    setError(undefined);
    try {
      const current = await loadVisualSelectionBasis(
        gallery.sqlite,
        product.id,
        gallery.context,
      );
      const displayed = state?.links.get(product.id) ?? [];
      if (displayed.length !== 1) throw Error("VISUAL_SELECTION_CHANGED");
      await removeProductVisual(
        gallery.sqlite,
        { ...current, link: displayed[0]! },
        gallery.context,
      );
      saved(
        "Association retirée. L’image et les originaux restent dans la bibliothèque.",
      );
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };
  const revoke = () => {
    const expected = asset && state?.assets.get(asset.id),
      ctx = gallery.context;
    if (!expected || !ctx) return;
    Alert.alert(
      "Retirer cette image de la bibliothèque ?",
      "Elle ne sera plus affichée pour les produits qui l’utilisent. Les originaux sont conservés.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Retirer pour tous les produits",
          style: "destructive",
          onPress: () => {
            setBusy(true);
            void revokeLibraryVisual(gallery.sqlite, expected, ctx)
              .then(() =>
                saved(
                  "Image retirée de la bibliothèque. Le retrait sera synchronisé.",
                ),
              )
              .catch(showError)
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  };
  return (
    <View className="gap-3 rounded-3xl border border-line bg-surface p-4">
      <View className="relative items-center justify-center rounded-2xl bg-surface-muted py-2">
        <ProductVisual
          category={product.category}
          resolution={resolution}
          size={asset ? 156 : 64}
          readUri={gallery.readDetailUri}
          onAvailability={setAvailable}
        />
        {gallery.canWrite && product.status !== "INACTIVE" ? (
          <View style={{ position: "absolute", top: 8, right: 8 }}>
            <IconButton
              label={
                asset
                  ? "Changer l’image du produit"
                  : "Ajouter une image au produit"
              }
              icon="camera-outline"
              disabled={busy || gallery.loading}
              onPress={() => {
                void begin();
              }}
            />
          </View>
        ) : null}
      </View>
      {header ?? (
        <Text
          accessibilityRole="header"
          className="text-lg font-semibold text-ink"
        >
          Visuel du produit
        </Text>
      )}
      <View className="gap-2">
        <Text className="text-xs text-muted">
          {asset
            ? (available ? "Copie disponible sur cet appareil. " : "") +
              visualTransferLabel(state!, asset.id)
            : gallery.canWrite
              ? "Ajoutez une image pour reconnaître ce produit."
              : "Image du produit non renseignée."}
        </Text>
        {resolution.kind === "ASSET" && resolution.generic ? (
          <Text className="text-sm text-muted">
            Visuel générique · ne décrit pas l’origine ni l’emballage exact.
          </Text>
        ) : null}
      </View>
      {notice ? <InlineAlert title="Enregistré" message={notice} /> : null}
      {error ? (
        <InlineAlert title="Image non modifiée" message={error} />
      ) : null}
      {gallery.error ? (
        <InlineAlert
          title="Bibliothèque non actualisée"
          message="Les choix déjà chargés restent visibles. Réessayez de relire la bibliothèque."
        />
      ) : null}
      {productVisualRecoveryTargets(state, product.id).map((target) => (
        <SecondaryButton
          key={`${target.kind}:${target.id}`}
          label={target.label}
          disabled={busy || !gallery.canWrite}
          onPress={() => setRecovery(target)}
        />
      ))}
      <BottomSheet
        visible={!!recovery}
        title="Reprendre le visuel"
        onClose={() => setRecovery(null)}
      >
        {recovery ? (
          <VisualRecoveryForm
            kind={recovery.kind}
            id={recovery.id}
            onRecovered={() => {
              setRecovery(null);
              setNotice(
                "Reprise enregistrée sur cet appareil. L’envoi reste suivi dans Synchronisation.",
              );
              void gallery.refresh().catch(() => undefined);
            }}
          />
        ) : null}
      </BottomSheet>
      {!gallery.canWrite ? (
        <Text className="text-xs text-muted">
          Le responsable du magasin peut gérer les images.
        </Text>
      ) : null}
      {asset ? (
        <SecondaryButton
          label={
            options ? "Masquer la source et les options" : "Source et options"
          }
          onPress={() => setOptions(!options)}
        />
      ) : null}
      {asset && options ? (
        <>
          <Provenance asset={asset} />
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{
              checked: !!state?.offlineRequired?.has(asset.id),
              disabled: busy,
            }}
            disabled={busy}
            onPress={() => {
              setBusy(true);
              void gallery
                .setOfflineRequired(
                  asset.id,
                  !state?.offlineRequired?.has(asset.id),
                )
                .catch(showError)
                .finally(() => setBusy(false));
            }}
            className="min-h-12 flex-row gap-3 rounded-2xl border border-line p-4"
          >
            <Text className="text-lg text-forest">
              {state?.offlineRequired?.has(asset.id) ? "☑" : "☐"}
            </Text>
            <Text className="flex-1 text-base text-ink">
              Conserver cette image hors connexion
            </Text>
          </Pressable>
          {state?.offlineRequired?.has(asset.id) && !available ? (
            <Text className="text-sm text-muted">
              Conservation demandée. Le téléchargement reprendra avec la
              connexion.
            </Text>
          ) : null}
          <SecondaryButton
            label="Télécharger ou reprendre l’aperçu"
            disabled={busy}
            onPress={() => {
              setBusy(true);
              void gallery
                .retry(asset.id)
                .then(() => gallery.requestPreview(asset.id))
                .catch(showError)
                .finally(() => setBusy(false));
            }}
          />
          {gallery.canWrite ? (
            <>
              <SecondaryButton
                label="Retirer l’image de ce produit"
                disabled={busy}
                onPress={() => {
                  void remove();
                }}
              />
              <SecondaryButton
                label="Retirer cette image de la bibliothèque"
                disabled={busy}
                onPress={revoke}
              />
            </>
          ) : null}
        </>
      ) : null}
      {gallery.error ? (
        <SecondaryButton
          label="Relire la bibliothèque"
          disabled={busy}
          onPress={() => {
            void gallery.refresh().catch(showError);
          }}
        />
      ) : null}
      <BottomSheet
        visible={open}
        title={choice ? "Confirmer le visuel" : "Choisir une image"}
        onClose={close}
        swipeToClose={!busy}
      >
        <Text className="text-base font-semibold text-ink">
          {basis?.product.product.entity.label}
        </Text>
        {error ? (
          <InlineAlert title="Vérification nécessaire" message={error} />
        ) : null}
        {choice ? (
          <>
            {choice.kind === "PHOTO" ? (
              <Image
                source={{ uri: choice.uri }}
                accessibilityLabel="Photo à associer au produit"
                resizeMode="contain"
                resizeMethod="resize"
                style={{
                  width: "100%",
                  height: 220,
                  borderRadius: 16,
                  backgroundColor: colors.surfaceMuted,
                }}
                onLoad={() => setPreviewReady(true)}
                onError={() => setPreviewReady(false)}
              />
            ) : selectedAsset ? (
              <>
                <ProductVisual
                  category={product.category}
                  candidate={{
                    asset: selectedAsset,
                    illustrative:
                      selectedAsset.provenance.type === "AI_GENERATED",
                    generic:
                      choice.identity.entity.specificity !== "PACKAGED_EXACT",
                  }}
                  size={220}
                  readUri={gallery.readDetailUri}
                  onAvailability={setPreviewReady}
                />
                <Text className="text-base text-ink">
                  {choice.identity.entity.canonicalName}
                </Text>
                <Provenance asset={selectedAsset} />
                {!previewReady ? (
                  <SecondaryButton
                    label="Charger l’aperçu avant de choisir"
                    disabled={busy}
                    onPress={() => {
                      void gallery
                        .requestPreview(selectedAsset.id)
                        .catch(showError);
                    }}
                  />
                ) : null}
              </>
            ) : (
              <InlineAlert
                title="Image indisponible"
                message="Relisez la bibliothèque avant de confirmer."
              />
            )}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              aria-checked={checked}
              onPress={() => setChecked(!checked)}
              className="min-h-12 flex-row gap-3 rounded-2xl border border-line p-4"
            >
              <Text className="text-lg text-forest">{checked ? "☑" : "☐"}</Text>
              <Text className="flex-1 text-base text-ink">
                {choice.kind === "PHOTO"
                  ? "Cette photo correspond au produit et je suis autorisé à l’utiliser dans l’application."
                  : "J’ai vérifié que ce visuel convient à ce produit."}
              </Text>
            </Pressable>
            <PrimaryButton
              label={busy ? "Enregistrement…" : "Utiliser cette image"}
              disabled={busy || !checked || !previewReady}
              onPress={() => {
                void confirm();
              }}
            />
            <SecondaryButton
              label="Revenir aux images"
              disabled={busy}
              onPress={() => {
                setChoice(null);
                setChecked(false);
              }}
            />
          </>
        ) : (
          <>
            <SecondaryButton
              label="Choisir une photo sur cet appareil"
              disabled={busy}
              onPress={() => {
                void photo();
              }}
            />
            <TextInput
              value={query}
              onChangeText={(text) => {
                setQuery(text);
                setPage(0);
              }}
              placeholder="Rechercher dans la bibliothèque"
              placeholderTextColor={colors.muted}
              accessibilityLabel="Rechercher un visuel"
              maxLength={200}
              className="min-h-12 rounded-2xl border border-line bg-surface px-4 text-base text-ink"
            />
            <Text className="text-sm text-muted">
              {identities.length}{" "}
              {identities.length === 1
                ? "visuel disponible"
                : "visuels disponibles"}
            </Text>
            {identities.slice(page * 20, page * 20 + 20).map((identity) => {
              const candidate = state!.assets.get(
                identity.entity.primaryAssetId!,
              )!.entity;
              return (
                <Pressable
                  key={identity.entity.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Examiner ${identity.entity.canonicalName}`}
                  onPress={() => {
                    if (basis) {
                      setChecked(false);
                      setPreviewReady(false);
                      setChoice({ kind: "LIBRARY", identity, basis });
                    }
                  }}
                  className="min-h-20 flex-row items-center gap-3 rounded-2xl border border-line bg-surface p-3"
                >
                  <ProductVisual
                    category={product.category}
                    candidate={{
                      asset: candidate,
                      illustrative:
                        candidate.provenance.type === "AI_GENERATED",
                      generic: identity.entity.specificity !== "PACKAGED_EXACT",
                    }}
                    readUri={gallery.readUri}
                  />
                  <View className="flex-1 gap-1">
                    <Text className="font-semibold text-ink">
                      {identity.entity.canonicalName}
                    </Text>
                    <Text className="text-sm text-muted">
                      {identity.entity.specificity === "PACKAGED_EXACT"
                        ? "Conditionné exact"
                        : "Visuel générique"}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
            {!identities.length ? (
              <Text className="text-base text-muted">
                Aucun visuel approuvé pour cette recherche. Vous pouvez choisir
                votre propre photo.
              </Text>
            ) : null}
            {page > 0 ? (
              <SecondaryButton
                label="Page précédente"
                onPress={() => setPage(page - 1)}
              />
            ) : null}
            {(page + 1) * 20 < identities.length ? (
              <SecondaryButton
                label="Page suivante"
                onPress={() => setPage(page + 1)}
              />
            ) : null}
          </>
        )}
      </BottomSheet>
    </View>
  );
}
function Provenance({
  asset,
}: {
  asset: import("@fl-copilot/domain").VisualAsset;
}) {
  const p = asset.provenance;
  const label =
    p.type === "USER_UPLOAD"
      ? "Photo ajoutée par le magasin · droits confirmés"
      : p.type === "AI_GENERATED"
        ? "Illustration de synthèse · ne représente pas un emballage réel"
        : `${p.provider} · ${{ SUPPLIER_PERMISSION: "autorisation fournisseur", COMMERCIAL_LICENSE: "licence commerciale", CC0: "licence CC0", CC_BY: "licence avec attribution" }[p.license.type]}${p.license.attribution ? ` · ${p.license.attribution}` : ""}`;
  return (
    <View className="gap-2">
      <Text className="text-sm text-muted">{label}</Text>
      {(p.type === "SUPPLIER" || p.type === "LICENSED_SOURCE") &&
      p.sourceUrl ? (
        <SecondaryButton
          label="Consulter la source et ses droits"
          onPress={() => {
            void Linking.openURL(p.sourceUrl!).catch(() => undefined);
          }}
        />
      ) : null}
    </View>
  );
}
