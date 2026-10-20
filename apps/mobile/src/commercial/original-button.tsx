import { SourceOriginalButton } from "../documents/source-original-button";
/** Keep every existing PDF entry point while retaining a verified offline original. */
export function CommercialOriginalButton({
  sourceDocumentId,
  label = "Consulter le PDF original",
}: {
  sourceDocumentId: string;
  label?: string;
}) {
  return (
    <SourceOriginalButton sourceDocumentId={sourceDocumentId} label={label} />
  );
}
