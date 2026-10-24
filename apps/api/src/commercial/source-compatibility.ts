import type { Db } from "mongodb";
import { AuthError } from "../auth/service";
/** Call only after store authorization. Never advance an older client's cursor past unreadable data. */
export async function requireCommercialSourceCompatibility(
  db: Db,
  storeId: string,
  supported: boolean,
) {
  if (supported) return;
  const original = await db
    .collection("commercialOfferChoices")
    .findOne(
      { storeId, "source.kind": "PDF_ORIGINAL" },
      { projection: { _id: 1 }, maxTimeMS: 2000 },
    );
  if (original)
    throw new AuthError(
      426,
      "COMMERCIAL_SOURCE_UPGRADE_REQUIRED",
      "Mettez l’application à jour pour synchroniser les offres liées directement aux PDF. Vos données locales sont conservées.",
    );
}
