import type { LocalProductMasterRecord } from "./product-master-repository";
import type { Product } from "@fl-copilot/domain";
import type {
  ProductEditorDraft,
  ProductEditorSnapshot,
} from "./product-editor-service";

export interface ProductListItem {
  record: LocalProductMasterRecord<Product>;
  conflictId?: string;
  searchTerms?: string[];
}

export interface ProductListState {
  loading: boolean;
  storeMissing: boolean;
  products: ProductListItem[];
  error?: string;
  refresh(): Promise<void>;
}

export interface ProductEditorState {
  loading: boolean;
  missing: boolean;
  storeMissing: boolean;
  snapshot?: ProductEditorSnapshot;
  conflictId?: string;
  error?: string;
  save(
    draft: ProductEditorDraft,
    expected?: ProductEditorSnapshot,
  ): Promise<string>;
}
