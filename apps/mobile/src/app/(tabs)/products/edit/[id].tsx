import { useLocalSearchParams } from "expo-router";
import { ProductEditScreen } from "@/products/product-edit-screen";
export default function EditProductRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProductEditScreen key={id} id={id} />;
}
