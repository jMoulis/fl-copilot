import { Text } from "react-native";
import { SectionCard } from "../components/ui";
import {
  categoryLabels,
  natureLabels,
  unitLabels,
} from "../products/catalogue-view";
import type { ProductEditorSnapshot } from "../products/product-editor-service";

export function ReceiptProductReview({
  label,
  snapshot,
}: {
  label: string;
  snapshot: ProductEditorSnapshot;
}) {
  const p = snapshot.product.entity;
  const codes = snapshot.identifiers.filter(
    (r) =>
      !r.entity.deletedAt &&
      r.entity.status === "VALIDATED" &&
      !["ERROR", "CONFLICT"].includes(r.syncState),
  );
  return (
    <SectionCard title="Confirmer l’association">
      <Text className="text-muted">Libellé sur le ticket : {label}</Text>
      <Text className="text-xl font-semibold text-ink">{p.label}</Text>
      <Text className="text-muted">
        {categoryLabels[p.category]} · {natureLabels[p.nature]} ·{" "}
        {unitLabels[p.salesUnit]}
      </Text>
      {codes.slice(0, 20).map(({ entity }) => (
        <Text selectable key={entity.id} className="text-ink">
          {entity.type} : {entity.value}
        </Text>
      ))}
      {codes.length > 20 ? (
        <Text className="text-muted">
          {codes.length - 20} autre(s) code(s) dans la fiche produit.
        </Text>
      ) : null}
      <Text className="text-sm text-muted">
        Seule cette ligne sera associée. Le ticket ne sera pas publié et aucun
        alias ne sera mémorisé automatiquement.
      </Text>
    </SectionCard>
  );
}
