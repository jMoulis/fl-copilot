import * as XLSX from "xlsx";
export function referenceBytes(plu: string | number | null = "005002") {
  const w = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    w,
    XLSX.utils.aoa_to_sheet([
      ["Numéro point de vente : 9083"],
      ["Date d'application :21/11/2026"],
      [
        "ITM8",
        "EAN",
        "LIBELLE",
        "NOMENCLATURE",
        "PRIX ACHAT PAR UNITE",
        "ACTIF",
        "PV TTC",
        "Code TVA",
        "PLU",
      ],
      [
        "0000087005002",
        "2800500200000",
        "CAROTTE VRAC",
        "LEGUMES",
        0.01,
        "Oui",
        1.49,
        "5.5%",
        plu,
      ],
    ]),
    "Mercalys",
  );
  return new Uint8Array(XLSX.write(w, { type: "buffer", bookType: "xlsx" }));
}
