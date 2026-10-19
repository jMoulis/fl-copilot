import sharp from "sharp";
import { createHash } from "node:crypto";
import {
  VISUAL_LIBRARY_POLICY,
  detectVisualImageMime,
  type VisualAsset,
} from "@fl-copilot/domain";
import { sharpCompatibleInput } from "../uploads/waste-receipt-image-normalization";
export const visualBytesHash = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
export interface VisualImageProcessor {
  normalize(
    bytes: Uint8Array,
    asset: VisualAsset,
  ): Promise<{ bytes: Uint8Array; width: number; height: number }>;
}
export const visualImageProcessor: VisualImageProcessor = {
  async normalize(bytes, asset) {
    if (
      bytes.byteLength !== asset.sizeBytes ||
      bytes.byteLength > VISUAL_LIBRARY_POLICY.maximumBytes ||
      visualBytesHash(bytes) !== asset.contentHash ||
      detectVisualImageMime(bytes) !== asset.mimeType
    )
      throw Error("VISUAL_FILE_INVALID");
    const metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: VISUAL_LIBRARY_POLICY.maximumPixels,
    }).metadata();
    const format = {
      "image/jpeg": "jpeg",
      "image/png": "png",
      "image/webp": "webp",
      "image/heic": "heif",
      "image/heif": "heif",
    }[asset.mimeType];
    const rotated = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
    const sameSize =
      metadata.width === asset.width && metadata.height === asset.height;
    const orientedSize =
      rotated &&
      metadata.width === asset.height &&
      metadata.height === asset.width;
    if (
      metadata.format !== format ||
      (metadata.pages ?? 1) > 1 ||
      (!sameSize && !orientedSize)
    )
      throw Error("VISUAL_FILE_INVALID");
    const compatible = await sharpCompatibleInput(bytes);
    const output = await sharp(compatible, {
      failOn: "error",
      limitInputPixels: VISUAL_LIBRARY_POLICY.maximumPixels,
    })
      .rotate()
      .resize({
        width: 1024,
        height: 1024,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    if (
      output.data.byteLength > 2 * 1024 * 1024 ||
      !output.info.width ||
      !output.info.height
    )
      throw Error("VISUAL_FILE_INVALID");
    return {
      bytes: new Uint8Array(output.data),
      width: output.info.width,
      height: output.info.height,
    };
  },
};
