import {
  isCommercialOriginalSource,
  type CommercialChoiceSource,
} from "@fl-copilot/domain";
/** Native route authority, never a model-authored URL or fabricated extraction ID. */
export function commercialOfferHref(
  source: CommercialChoiceSource,
  choiceId?: string,
) {
  if (isCommercialOriginalSource(source)) {
    if (!choiceId) throw Error("COMMERCIAL_CHOICE_ID_REQUIRED");
    return {
      pathname: "/commercial-offer/[id]" as const,
      params: { id: choiceId, choiceId },
    };
  }
  return {
    pathname: "/commercial-offer/[id]" as const,
    params: {
      id: source.readingId,
      operationIndex: source.operationIndex,
      itemIndex: source.itemIndex,
    },
  };
}
