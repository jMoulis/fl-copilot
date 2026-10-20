import {
  resolveProductVisual,
  type Product,
  type VisualAsset,
  type VisualIdentity,
  type ProductVisualLink,
  type ProductVisualResolution,
} from "@fl-copilot/domain";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import {
  VisualLibraryRepository,
  type LocalVisualRecord,
} from "./visual-library-repository";
import type { VisualFileJob } from "./visual-file-jobs";
export interface VisualLibraryState {
  storeId: string;
  offlineRequired?: Set<string>;
  assets: Map<string, LocalVisualRecord<VisualAsset>>;
  identities: Map<string, LocalVisualRecord<VisualIdentity>>;
  links: Map<string, LocalVisualRecord<ProductVisualLink>[]>;
  files: Map<string, { source: boolean; preview: boolean; uploaded: boolean }>;
  jobs: Map<string, VisualFileJob[]>;
}
export async function loadVisualLibraryState(
  db: OutboxDatabase & AtomicMutationDatabase,
  storeId: string,
  ownerId: string,
): Promise<VisualLibraryState> {
  const repo = new VisualLibraryRepository(db);
  const [assets, identities, links, files, jobs] = await Promise.all([
    repo.list("visual_asset", storeId),
    repo.list("visual_identity", storeId),
    repo.list("product_visual_link", storeId),
    db.getAllAsync<{ asset_id: string; variant: string; uploaded: number }>(
      "SELECT asset_id,variant,uploaded FROM visual_asset_files WHERE store_id=?",
      storeId,
    ),
    db.getAllAsync<VisualFileJob>(
      "SELECT * FROM local_jobs WHERE type='VISUAL_FILE_TRANSFER' AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.ownerId')=? ORDER BY created_at DESC",
      storeId,
      ownerId,
    ),
  ]);
  const result: VisualLibraryState = {
    storeId,
    offlineRequired: new Set(
      assets.filter((r) => r.offlineRequired).map((r) => r.entity.id),
    ),
    assets: new Map(assets.map((r) => [r.entity.id, r])),
    identities: new Map(identities.map((r) => [r.entity.id, r])),
    links: new Map(),
    files: new Map(),
    jobs: new Map(),
  };
  for (const link of links)
    result.links.set(link.entity.productId, [
      ...(result.links.get(link.entity.productId) ?? []),
      link,
    ]);
  for (const file of files) {
    const prior = result.files.get(file.asset_id) ?? {
      source: false,
      preview: false,
      uploaded: false,
    };
    result.files.set(file.asset_id, {
      source: prior.source || file.variant === "SOURCE",
      preview: prior.preview || file.variant === "PREVIEW",
      uploaded:
        prior.uploaded || (file.variant === "SOURCE" && !!file.uploaded),
    });
  }
  for (const job of jobs) {
    try {
      const payload = JSON.parse(job.payload_json) as { assetId?: string };
      if (payload.assetId && result.assets.has(payload.assetId))
        result.jobs.set(payload.assetId, [
          ...(result.jobs.get(payload.assetId) ?? []),
          job,
        ]);
    } catch {
      /* A corrupt job remains visible in synchronization; it cannot authorize a display. */
    }
  }
  return result;
}
const safe = <T extends { deletedAt: string | null }>(
  r: LocalVisualRecord<T> | undefined,
): r is LocalVisualRecord<T> =>
  !!r && !r.remote?.deletedAt && !["ERROR", "CONFLICT"].includes(r.syncState);
export function resolveLibraryState(
  state: VisualLibraryState | null,
  product: Product,
): ProductVisualResolution {
  if (!state || state.storeId !== product.storeId)
    return { kind: "PLACEHOLDER", category: product.category };
  const links = (state.links.get(product.id) ?? []).filter(
    (r) => !r.entity.deletedAt,
  );
  if (links.length !== 1 || !safe(links[0]))
    return { kind: "PLACEHOLDER", category: product.category };
  const identities = links
    .map((l) => state.identities.get(l.entity.visualIdentityId))
    .filter(safe);
  const assets = links
    .map((l) =>
      state.assets.get(
        l.entity.overrideAssetId ??
          state.identities.get(l.entity.visualIdentityId)?.entity
            .primaryAssetId ??
          "",
      ),
    )
    .filter(safe)
    .filter(
      (r) =>
        !r.remote?.deletedAt &&
        !["REVOKED", "REJECTED"].includes(r.remote?.review.status ?? ""),
    );
  return resolveProductVisual({
    product,
    links: links.filter(safe).map((r) => r.entity),
    identities: [
      ...new Map(identities.map((r) => [r.entity.id, r.entity])).values(),
    ],
    assets: [...new Map(assets.map((r) => [r.entity.id, r.entity])).values()],
  });
}
export function visualTransferLabel(
  state: VisualLibraryState,
  assetId: string,
) {
  const asset = state.assets.get(assetId),
    jobs = state.jobs.get(assetId) ?? [],
    files = state.files.get(assetId);
  if (
    !asset ||
    asset.entity.deletedAt ||
    asset.entity.review.status === "REVOKED"
  )
    return "Image retirée";
  if (["CONFLICT", "ERROR"].includes(asset.syncState))
    return asset.syncState === "CONFLICT"
      ? "Conflit à examiner"
      : "Métadonnées en erreur";
  if (asset.entity.review.status !== "APPROVED") return "Image à examiner";
  if (jobs.some((j) => j.status === "FAILED")) return "Transfert à reprendre";
  if (asset.dirty) return "Métadonnées à synchroniser";
  if (files?.preview) return "Image vérifiée et envoyée";
  if (jobs.some((j) => j.status === "RUNNING")) return "Transfert en cours";
  if (files?.uploaded) return "Image envoyée · aperçu en attente";
  if (files?.source) return "Original conservé · envoi en attente";
  return "Aperçu non enregistré sur cet appareil";
}
export function visualErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  switch (code) {
    case "VISUAL_RIGHTS_REQUIRED":
      return "Confirmez que vous pouvez utiliser cette photo dans l’application.";
    case "VISUAL_SCOPE_CHANGED":
    case "VISUAL_ACCESS_INVALID":
      return "Le compte, le magasin ou vos droits ont changé. Reprenez votre action dans le magasin actif.";
    case "VISUAL_PRODUCT_CHANGED":
      return "La fiche produit a changé. Relisez-la avant de confirmer l’image.";
    case "VISUAL_SELECTION_CHANGED":
    case "VISUAL_REVISION_INVALID":
      return "L’image ou son association a changé. Relisez le choix actuel avant de confirmer.";
    case "VISUAL_TARGET_UNAVAILABLE":
    case "VISUAL_ASSET_UNAVAILABLE":
    case "VISUAL_RESOLVE_REQUIRED":
      return "Cette cible est retirée, non approuvée ou en conflit. Votre choix précédent reste conservé.";
    case "VISUAL_SOURCE_FILE_MISSING":
      return "L’original n’est plus disponible sur cet appareil. Sélectionnez à nouveau la même photo pour reprendre son envoi.";
    case "VISUAL_FILE_INVALID":
    case "VISUAL_FILE_BINDING_INVALID":
      return "Cette image n’a pas pu être vérifiée. Choisissez un fichier JPEG, PNG, WebP ou HEIC de 12 Mo maximum.";
    default:
      return "L’opération n’a pas pu être terminée. Les choix déjà enregistrés et les originaux sont conservés. Réessayez après avoir vérifié l’espace disponible et la connexion.";
  }
}
