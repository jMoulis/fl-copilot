export function commercialOfferValidationError(code: string | undefined) {
  return (
    (
      {
        COMMERCIAL_VALIDATION_CHOICE_CHANGED:
          "Une offre a été modifiée, retirée ou est en conflit. Relisez-la puis mettez à jour le brouillon avant de valider.",
        COMMERCIAL_VALIDATION_PRODUCT_INVALID:
          "Le produit associé n’est plus actif. Choisissez un produit disponible dans la fiche de l’offre.",
        COMMERCIAL_VALIDATION_SOURCE_INVALID:
          "L’offre ne correspond pas à la source conservée. Rouvrez le PDF et vérifiez les conditions.",
        COMMERCIAL_VALIDATION_IMMUTABLE:
          "Cette version a déjà une validation conservée. Modifiez le choix pour valider une nouvelle version.",
        COMMERCIAL_VALIDATION_SYNCING:
          "La validation s’envoie. Attendez la fin de la synchronisation.",
      } as Record<string, string>
    )[code ?? ""] ??
    "La validation n’a pas pu être enregistrée. Rouvrez le brouillon et vérifiez les offres signalées."
  );
}
