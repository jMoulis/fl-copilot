import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import {
  AppScreen,
  AppHeader,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui";
import { useUnsavedForm } from "@/components/use-unsaved-form";
import { ReceiptCatalogueList } from "@/documents/receipt-catalogue-list";
import { ReceiptProductReview } from "@/documents/receipt-product-review";
import { useReceiptProductTarget } from "@/documents/use-receipt-product-target";
import {
  receiptProductOriginSchema,
  receiptProductError,
  type ReceiptProductOrigin,
} from "@/documents/receipt-product-selection";
import { ProductMasterRepository } from "@/products/product-master-repository";
import {
  loadProductEditorSnapshot,
  type ProductEditorSnapshot,
} from "@/products/product-editor-service";
import { useProductList } from "@/products/use-product-editor";
import { catalogueSnapshotIdentity } from "@fl-copilot/domain";
import { z } from "zod";

export default function ReceiptProductRoute() {
  const params = useLocalSearchParams();
  const origin = receiptProductOriginSchema.safeParse({
    receiptId: params.receiptId,
    lineId: params.lineId,
  });
  const { session } = useAuth(),
    storeId = session?.stores[0]?.storeId;
  const created = z.uuid().safeParse(params.createdProductId);
  return origin.success && storeId && session ? (
    <ReceiptProductPicker
      key={`${storeId}:${session.user.id}:${origin.data.receiptId}:${origin.data.lineId}`}
      origin={origin.data}
      storeId={storeId}
      createdProductId={created.success ? created.data : undefined}
    />
  ) : (
    <AppScreen>
      <AppHeader title="Choisir le produit" />
      <InlineAlert
        title="Ligne indisponible"
        message="Ouvrez cette sélection depuis un ticket du magasin actif."
      />
      <SecondaryButton label="Retour" onPress={() => router.back()} />
    </AppScreen>
  );
}

function ReceiptProductPicker({
  origin,
  storeId,
  createdProductId,
}: {
  origin: ReceiptProductOrigin;
  storeId: string;
  createdProductId?: string;
}) {
  const context = useReceiptProductTarget(origin, storeId);
  const catalogue = useProductList();
  const { sqlite } = useLocalDatabase();
  const products = useMemo(() => new ProductMasterRepository(sqlite), [sqlite]);
  const [query, setQuery] = useState("");
  const [choice, setChoice] = useState<{
    snapshot: ProductEditorSnapshot;
    lineVersion: number;
  }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [committed, setCommitted] = useState(false);
  useUnsavedForm(false, busy);

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else
      router.replace({
        pathname: "/waste-receipt/[id]",
        params: { id: origin.receiptId },
      });
  }, [origin.receiptId]);
  const returned = useRef(false);
  useEffect(() => {
    if (committed && !busy && !returned.current) {
      returned.current = true;
      back();
    }
  }, [committed, busy, back]);
  const select = useCallback(
    async (id: string) => {
      if (locked.current || !context.available || !context.target) return;
      locked.current = true;
      setBusy(true);
      setError(undefined);
      try {
        const snapshot = await loadProductEditorSnapshot(products, id);
        if (!snapshot || snapshot.product.entity.storeId !== storeId)
          throw Error("WASTE_RECEIPT_PRODUCT_CANDIDATE_INVALID");
        setChoice({ snapshot, lineVersion: context.target.draft.line.version });
      } catch (reason) {
        setError(receiptProductError(reason));
      } finally {
        locked.current = false;
        setBusy(false);
      }
    },
    [context.available, context.target, products, storeId],
  );
  const openedCreated = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      createdProductId &&
      context.available &&
      !locked.current &&
      openedCreated.current !== createdProductId
    ) {
      openedCreated.current = createdProductId;
      void select(createdProductId);
    }
  }, [createdProductId, context.available, select]);
  async function confirm() {
    if (locked.current || !choice || !context.available) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await context.repository.selectCatalogueProduct(
        origin.receiptId,
        origin.lineId,
        choice.snapshot.product.entity.id,
        choice.lineVersion,
        { storeId, identity: catalogueSnapshotIdentity(choice.snapshot) },
      );
      setCommitted(true);
    } catch (reason) {
      setError(receiptProductError(reason));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  // Navigate only after the shared removal guard has observed the committed operation.
  if (committed)
    return (
      <AppScreen>
        <AppHeader
          title="Produit associé"
          subtitle="La modification est enregistrée sur cet appareil. La publication du ticket reste une action distincte."
        />
        <PrimaryButton label="Revenir au ticket" onPress={back} />
      </AppScreen>
    );
  const label =
    context.target?.draft.line.rawLabel ?? "Chargement de la ligne…";
  const unavailable = !context.available || busy;
  const changed =
    choice &&
    context.target &&
    choice.lineVersion !== context.target.draft.line.version;
  if (choice)
    return (
      <AppScreen>
        <AppHeader title="Vérifier le produit" />
        <ReceiptProductReview label={label} snapshot={choice.snapshot} />
        {error || context.error || changed ? (
          <InlineAlert
            title="Association à revoir"
            message={
              error ??
              context.error ??
              "La ligne a changé. Relisez-la puis choisissez à nouveau le produit."
            }
          />
        ) : null}
        <PrimaryButton
          label="Associer ce produit à la ligne"
          disabled={unavailable || !!changed}
          onPress={() => void confirm()}
        />
        <SecondaryButton
          label="Choisir un autre produit"
          disabled={busy}
          onPress={() => {
            setChoice(undefined);
            setError(undefined);
            void context.refresh();
          }}
        />
        <SecondaryButton
          label="Retour au ticket"
          disabled={busy}
          onPress={back}
        />
      </AppScreen>
    );
  return (
    <ReceiptCatalogueList
      label={label}
      items={catalogue.products}
      query={query}
      onQuery={setQuery}
      onSelect={(id) => void select(id)}
      onBack={back}
      onRefresh={() => {
        void catalogue.refresh();
        void context.refresh();
      }}
      disabled={busy}
      canChoose={context.available}
      loading={context.loading || catalogue.loading}
      error={error ?? context.error ?? catalogue.error}
      onCreate={() => {
        router.push({
          pathname: "/waste-receipt-product-create",
          params: origin,
        });
      }}
    />
  );
}
