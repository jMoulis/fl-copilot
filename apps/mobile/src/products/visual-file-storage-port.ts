import type { VisualAsset } from "@fl-copilot/domain";
import type {
  VerifiedVisualFile,
  VisualFileVariant,
} from "./visual-file-cache";
/** Runtime-neutral boundary: tests/server code must not load Expo globals. */
export type VisualFileDescriptor = Pick<
  VisualAsset,
  "contentHash" | "mimeType" | "sizeBytes"
>;
export interface VisualFileStorage {
  removeCached(storeId: string, file: VerifiedVisualFile): Promise<void>;
  capture(
    storeId: string,
    selectedUri: string,
  ): Promise<
    VerifiedVisualFile & {
      mimeType: VisualAsset["mimeType"];
      width: number;
      height: number;
    }
  >;
  read(
    storeId: string,
    variant: VisualFileVariant,
    descriptor: VisualFileDescriptor,
  ): Promise<Uint8Array>;
  write(
    storeId: string,
    variant: VisualFileVariant,
    descriptor: VisualFileDescriptor,
    bytes: Uint8Array,
  ): Promise<VerifiedVisualFile>;
  uri(
    storeId: string,
    variant: VisualFileVariant,
    descriptor: VisualFileDescriptor,
  ): Promise<string | null>;
  upload(
    storeId: string,
    descriptor: VisualFileDescriptor,
    url: string,
    headers: Record<string, string>,
  ): Promise<void>;
}
