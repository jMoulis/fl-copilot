import { useLocalSearchParams } from "expo-router";
import { ProductEditScreen } from "@/products/product-edit-screen";
import { ProductDetailScreen } from "@/products/product-detail-screen";
export default function ProductRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return id === "new" ? (
    <ProductEditScreen key={id} id={id} />
  ) : (
    <ProductDetailScreen key={id} id={id} />
  );
}
