import { useLocalSearchParams } from "expo-router";
import { ProductEditScreen } from "@/products/product-edit-screen";
import { ProductDetailScreen } from "@/products/product-detail-screen";
export default function ProductRoute() {
  const { id, selection } = useLocalSearchParams<{
    id: string;
    selection?: string | string[];
  }>();
  return id === "new" ? (
    <ProductEditScreen key={id} id={id} />
  ) : (
    <ProductDetailScreen key={id} id={id} selection={selection} />
  );
}
