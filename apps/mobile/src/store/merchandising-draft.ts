import type {
  StoreMerchandising,
  StoreMerchandisingZone,
} from "@fl-copilot/domain";
export type MerchandisingDraft = {
  activeTgCount: string;
  implantation: string;
  circulation: string;
  zones: StoreMerchandisingZone[];
};
export const emptyMerchandisingDraft = (): MerchandisingDraft => ({
  activeTgCount: "",
  implantation: "",
  circulation: "",
  zones: [],
});
export function merchandisingDraft(
  value: StoreMerchandising | null | undefined,
): MerchandisingDraft | undefined {
  return value
    ? {
        activeTgCount:
          value.activeTgCount === null ? "" : String(value.activeTgCount),
        implantation: value.implantation ?? "",
        circulation: value.circulation ?? "",
        zones: value.zones.map((zone) => ({ ...zone })),
      }
    : undefined;
}
export function merchandisingValue(draft: MerchandisingDraft | undefined) {
  if (!draft) return undefined;
  return {
    activeTgCount:
      draft.activeTgCount.trim() === ""
        ? null
        : /^\d+$/.test(draft.activeTgCount)
          ? Number(draft.activeTgCount)
          : NaN,
    implantation: draft.implantation.trim() || null,
    circulation: draft.circulation.trim() || null,
    zones: draft.zones,
  };
}
