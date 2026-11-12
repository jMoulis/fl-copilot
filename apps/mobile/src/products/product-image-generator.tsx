import { useEffect, useRef, useState } from "react";
import { Image, Text, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { ApiClient, ApiClientError } from "@fl-copilot/api-client";
import type {
  ProductImageOptions,
  ProductImageRequest,
  ProductImageResult,
} from "@fl-copilot/sync-contracts";
import type { Product } from "@fl-copilot/domain";
import { useAuth } from "../auth/auth-provider";
import { getApiBaseUrl } from "../config/environment";
import { InlineAlert, PrimaryButton, SecondaryButton } from "../components/ui";
import type { VisualLibraryController } from "./use-visual-library";
import { nativeVisualFileStorage } from "./visual-file-storage";
import {
  assignCapturedVisual,
  loadVisualSelectionBasis,
  type VisualSelectionBasis,
} from "./visual-library-actions";
import { withVisualFiles } from "./visual-file-lock";
import {
  readProductImageRequest,
  retainProductImageRequest,
  finishProductImageRequest,
} from "./product-image-request";
import { visualErrorMessage } from "./visual-library-state";

const api = new ApiClient(getApiBaseUrl());
/** Network generation is optional. Approval still uses the canonical local transaction and Outbox. */
export function ProductImageGenerator({
  product,
  gallery,
  onSaved,
  visible,
  onClose,
}: {
  product: Product;
  gallery: VisualLibraryController;
  onSaved(): void;
  visible: boolean;
  onClose(): void;
}) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [options, setOptions] = useState<ProductImageOptions | null>(null),
    [request, setRequest] = useState<ProductImageRequest | null>(null),
    [result, setResult] = useState<ProductImageResult | null>(null),
    [uri, setUri] = useState<string | null>(null),
    [ready, setReady] = useState(false);
  const binding = useRef({
    context: gallery.context,
    productId: product.id,
    productVersion: product.version,
  });
  binding.current = {
    context: gallery.context,
    productId: product.id,
    productVersion: product.version,
  };
  const mounted = useRef(true),
    lock = useRef(false),
    basis = useRef<VisualSelectionBasis | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const ctx = gallery.context;
  const beginRef = useRef(begin);
  beginRef.current = begin;
  useEffect(() => {
    if (visible) void beginRef.current();
  }, [visible]);
  function check() {
    if (
      !ctx?.canWrite() ||
      !mounted.current ||
      binding.current.context?.actorId !== ctx.actorId ||
      binding.current.context.storeId !== ctx.storeId ||
      binding.current.productId !== product.id ||
      binding.current.productVersion !== product.version
    )
      throw Error("VISUAL_SCOPE_CHANGED");
  }
  async function action(run: () => Promise<void>) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      check();
      await run();
      return true;
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof ApiClientError ? e.message : visualErrorMessage(e),
        );
      return false;
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function receive(value: ProductImageResult) {
    check();
    setResult(value);
    if (
      value.productId !== product.id ||
      value.productVersion !== product.version
    )
      throw Error("VISUAL_PRODUCT_CHANGED");
    if (value.status !== "READY" || !value.image) return;
    const image = value.image;
    const bytes = await auth.withAccessToken(
      (token) =>
        api.downloadGeneratedProductImage(
          token,
          ctx!.storeId,
          value.requestId,
          image,
        ),
      ctx!.actorId,
    );
    check();
    await withVisualFiles(ctx!.storeId, async () => {
      await nativeVisualFileStorage.write(ctx!.storeId, "SOURCE", image, bytes);
      check();
      const local = await nativeVisualFileStorage.uri(
        ctx!.storeId,
        "SOURCE",
        image,
      );
      check();
      setUri(local);
      setReady(false);
    });
  }
  async function begin() {
    await action(async () => {
      setUri(null);
      setReady(false);
      setResult(null);
      setRequest(null);
      setOptions(null);
      basis.current = await loadVisualSelectionBasis(
        gallery.sqlite,
        product.id,
        ctx!,
      );
      check();
      const prior = await readProductImageRequest(
        gallery.sqlite,
        ctx!.storeId,
        ctx!.actorId,
        product.id,
      );
      check();
      setRequest(prior);
      if (prior) {
        try {
          await receive(
            await auth.withAccessToken(
              (t) => api.productImageStatus(t, ctx!.storeId, prior.requestId),
              ctx!.actorId,
            ),
          );
        } catch (e) {
          if (!(e instanceof ApiClientError) || e.status !== 404) throw e;
        }
      }
      const value = await auth.withAccessToken(
        (t) => api.productImageOptions(t, ctx!.storeId, product.id),
        ctx!.actorId,
      );
      check();
      setOptions(value);
    });
  }
  async function generate() {
    await action(async () => {
      if (!options?.available || options.productVersion !== product.version)
        throw Error("VISUAL_PRODUCT_CHANGED");
      let input = request;
      if (!input)
        input = await retainProductImageRequest(
          gallery.sqlite,
          ctx!.storeId,
          ctx!.actorId,
          {
            requestId: randomUUID(),
            productId: product.id,
            productVersion: product.version,
            policyId: options.policyId,
          },
          ctx!.now(),
        );
      check();
      setRequest(input);
      await receive(
        await auth.withAccessToken(
          (t) => api.generateProductImage(t, ctx!.storeId, input!),
          ctx!.actorId,
        ),
      );
    });
  }
  async function refresh() {
    await action(async () => {
      if (request)
        await receive(
          await auth.withAccessToken(
            (t) => api.productImageStatus(t, ctx!.storeId, request.requestId),
            ctx!.actorId,
          ),
        );
    });
  }
  async function use() {
    await action(async () => {
      if (!result?.image || !uri || !ready || !basis.current) return;
      await withVisualFiles(ctx!.storeId, async () => {
        const source = await nativeVisualFileStorage.capture(ctx!.storeId, uri);
        check();
        await assignCapturedVisual(
          gallery.sqlite,
          basis.current!,
          source,
          true,
          ctx!,
          result.image!,
        );
      });
      await finishProductImageRequest(
        gallery.sqlite,
        ctx!.storeId,
        ctx!.actorId,
        result.requestId,
        true,
        ctx!.now(),
      );
      check();
      onClose();
      onSaved();
    });
  }
  async function discard() {
    return action(async () => {
      if (request)
        await finishProductImageRequest(
          gallery.sqlite,
          ctx!.storeId,
          ctx!.actorId,
          request.requestId,
          false,
          ctx!.now(),
        );
      check();
      setRequest(null);
      setResult(null);
      setUri(null);
      setReady(false);
    });
  }
  if (!visible) return null;
  return (
    <View className="gap-4">
      <Text className="text-lg font-semibold text-ink">{product.label}</Text>
      <Text className="text-base text-muted">
        {product.nature === "BULK"
          ? "Produit en vrac, sans emballage."
          : "Conditionnement illustratif, sans marque inventée."}
      </Text>
      {error ? (
        <InlineAlert title="Génération à vérifier" message={error} />
      ) : null}
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: "100%", height: 240, backgroundColor: "transparent" }}
          resizeMode="contain"
          accessibilityLabel={`Illustration IA proposée : ${product.label}`}
          onLoad={() => setReady(true)}
          onError={() => setReady(false)}
        />
      ) : null}
      {result?.status === "READY" ? (
        <View className="gap-3">
          <Text className="text-base text-muted">
            Illustration IA · PNG transparent. Vérifie qu’elle convient au
            produit. L’image actuelle reste conservée.
          </Text>
          <PrimaryButton
            label={busy ? "Enregistrement…" : "Utiliser cette image"}
            disabled={busy || !ready}
            onPress={() => {
              void use();
            }}
          />
          {!uri ? (
            <SecondaryButton
              label="Charger l’aperçu"
              disabled={busy}
              onPress={() => {
                void refresh();
              }}
            />
          ) : null}
          <SecondaryButton
            label="Garder l’image actuelle"
            disabled={busy}
            onPress={() => {
              void discard().then((ok) => {
                if (ok) onClose();
              });
            }}
          />
        </View>
      ) : result ? (
        <View className="gap-3">
          <Text className="text-base text-muted">
            {result.status === "RUNNING"
              ? "La génération est en cours. Tu peux retrouver son résultat ici."
              : "Le résultat n’a pas pu être confirmé. La demande peut avoir été facturée ; aucune relance automatique n’a été faite."}
          </Text>
          <SecondaryButton
            label="Vérifier le résultat"
            disabled={busy}
            onPress={() => {
              void refresh();
            }}
          />
          {result.status === "UNKNOWN" ? (
            <SecondaryButton
              label="Abandonner cet essai"
              disabled={busy}
              onPress={() => {
                void discard();
              }}
            />
          ) : null}
        </View>
      ) : (
        <View className="gap-3">
          <Text className="text-base text-muted">
            Un produit, une image réaliste, sur fond transparent. Tu choisiras
            ensuite si tu souhaites l’utiliser.
          </Text>
          {options?.estimatedCostUsd ? (
            <Text className="text-base text-ink">
              Coût indicatif : environ{" "}
              {options.estimatedCostUsd.toLocaleString("fr-FR", {
                maximumFractionDigits: 3,
              })}{" "}
              $ par image. Le montant final facturé par OpenAI peut varier.
            </Text>
          ) : null}
          {options?.reasonFr ? (
            <Text className="text-base text-muted">{options.reasonFr}</Text>
          ) : null}
          {options && options.productVersion !== product.version ? (
            <Text className="text-base text-muted">
              Synchronise d’abord les dernières modifications de cette fiche.
            </Text>
          ) : null}
          <PrimaryButton
            label={
              busy
                ? request
                  ? "Génération en cours…"
                  : "Préparation…"
                : request
                  ? "Reprendre cette demande"
                  : "Générer l’image"
            }
            disabled={
              busy ||
              !options?.available ||
              options.productVersion !== product.version
            }
            onPress={() => {
              void generate();
            }}
          />
          {request ? (
            <SecondaryButton
              label="Abandonner cette demande"
              disabled={busy}
              onPress={() => {
                void discard();
              }}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}
