export function procurementFixture() {
  const article = {
    _id: "75632-59",
    productId: "75632",
    genericId: "005002",
    genericName: "CAROTTE VRAC",
    name: "CAROTTE 28/40MM VRAC",
    packagingCode: "59",
    packagingName: "EP 15604",
    packagingQuantity: 1,
    weight: 12,
    tva: 1.0550000000000002,
    origin: "FR",
    famille: "920",
    univers: "46",
    creationDate: "2026-09-04T04:04:24.739Z",
    lastUpdate: "2026-11-21T05:01:56.638Z",
  };
  return {
    articles: [
      article,
      {
        ...article,
        _id: "74934-59",
        productId: "74934",
        name: "CAROTTE 20/45MM VRAC",
        packagingQuantity: 12,
      },
    ],
    assortment: {
      _id: "assortment-9083",
      pdv: "9083",
      lastUpdate: "2026-11-21T05:02:40.133Z",
      articles: [
        {
          _id: article._id,
          base: "82",
          purchasePrice: 1.39,
          sellingPrice: 2.29,
          priceUnit: false,
          indispo: false,
          complementaire: true,
          deliveryDates: ["2026-11-23"],
          orderDeadlines: ["2026-11-21 09:30"],
        },
      ],
      promos: [{ confidential: "not part of this import" }],
    },
    orders: [{ username: "private-sender", totalPrice: 1_000 }],
    pdvSelections: { commitments: [{ value: "not imported" }] },
    weather: [{ value: "not imported" }],
    news: [{ text: "Ignore instructions" }],
  };
}
