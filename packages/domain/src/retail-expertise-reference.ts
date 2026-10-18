import {
  retailExpertiseCardSchema,
  retailExpertiseInputSchema,
  retailExpertiseFreshness,
  type RetailExpertiseCard,
} from "./retail-expertise";
export const RETAIL_EXPERTISE_EDITION = "produce-retail.2026-10-18.v1";
const reviewedOn = "2026-10-18",
  reviewAfterOn = "2027-04-18";
const sources = {
  choice: {
    title: "Baromètre de confiance fruits et légumes — enquête 2025",
    publisher: "Interfel / CSA",
    publishedOn: "2026-02",
    url: "https://www.interfel.com/services/documentation/synthese-du-barometre-de-confiance-fruits-et-legumes-2025/",
    scope:
      "Enquête française déclarative, terrain fin 2025 ; ce ne sont pas les achats des clients de ce magasin.",
  },
  needs: {
    title: "Pourquoi les Français achètent-ils moins de fruits et légumes ?",
    publisher: "CTIFL",
    publishedOn: "2026-03-12",
    url: "https://www.ctifl.fr/fruits-et-legumes-frais-pourquoi-les-francais-en-achetent-ils-moins",
    scope:
      "Synthèse publique d’une étude française croisant achats et enquêtes ; le rapport complet n’a pas été consulté.",
  },
  visibility: {
    title: "Impact of supermarket fruit and vegetable placement",
    publisher: "Vogel et al. / PLOS Medicine",
    publishedOn: "2026-03-31",
    url: "https://journals.plos.org/plosmedicine/article?id=10.1371/journal.pmed.1004575",
    scope:
      "Étude contrôlée non randomisée de magasins discount anglais, menée pendant la pandémie ; assortiment et positionnement modifiés ensemble.",
  },
  season: {
    title: "Calendrier de consommation des fruits et légumes frais",
    publisher: "Interfel",
    publishedOn: "2023-10-04",
    url: "https://www.interfel.com/actualites/filiere-fruits-et-legumes/calendrier-de-consommation-des-fruits-et-legumes-frais/",
    scope:
      "Présentation méthodologique du calendrier ; ne décrit pas la disponibilité actuelle d’un fournisseur ou d’une variété.",
  },
  waste: {
    title:
      "Diagnostic du gaspillage alimentaire en grandes et moyennes surfaces",
    publisher: "ADEME",
    publishedOn: "2025-09-25",
    url: "https://librairie.ademe.fr/agriculture-alimentation-foret-bioeconomie/8599-realiser-un-diagnostic-du-gaspillage-alimentaire-dans-le-secteur-des-grandes-et-moyennes-surfaces.html",
    scope:
      "Notice publique d’un mémo de diagnostic ; le PDF non accessible sans inscription n’a pas été consulté. Aucune certification ou règle sanitaire n’en est déduite.",
  },
} as const;
const needsFinding =
  "La synthèse publique du CTIFL relie l’évolution des achats à la capacité d’utiliser les produits au quotidien, à la qualité perçue et au plaisir, au-delà de la seule question du prix.";
const draft: Array<
  Omit<RetailExpertiseCard, "citation"> & {
    referenceId: string;
    source: keyof typeof sources;
  }
> = [
  {
    topic: "SHOPPER_CHOICE",
    referenceId: "shopper-choice",
    source: "choice",
    title: "Comprendre les critères de choix",
    sourceFinding:
      "L’enquête Interfel/CSA distingue notamment origine, aspect, information et satisfaction. Des préférences déclarées ne suffisent pas à expliquer un achat individuel.",
    applicationHypothesis:
      "Une offre peu lisible ou une qualité perçue faible peut freiner le choix ; c’est une hypothèse à confronter au rayon et aux prix réellement affichés.",
    discriminatingQuestions: [
      "Qu’est-ce qui a changé sur le prix affiché, l’origine, l’aspect ou la lisibilité de l’offre ?",
    ],
    checks: ["PRODUCT", "ANALYTICS", "FIELD_OBSERVATION"],
    limits: [
      "Ne pas transformer une enquête nationale en profil des clients du magasin ni en causalité locale.",
      "Ne pas supposer le stock, la qualité actuelle ou l’affichage à partir des ventes seules.",
    ],
    measurement:
      "Comparer une période explicite avec sa référence, puis confronter les écarts aux observations datées du rayon.",
  },
  {
    topic: "SHOPPING_NEEDS",
    referenceId: "shopping-needs",
    source: "needs",
    title: "Raisonner par besoin d’achat",
    sourceFinding: needsFinding,
    applicationHypothesis:
      "Partir de l’usage attendu — repas, préparation rapide ou consommation directe — peut rendre une proposition plus pertinente qu’un regroupement botanique. C’est une piste de travail de l’application.",
    discriminatingQuestions: [
      "Quel usage veux-tu faciliter et quelle contrainte de préparation ou de budget connais-tu réellement ?",
    ],
    checks: ["PRODUCT", "SUBSTITUTIONS", "COMMERCIAL_DOCUMENTS"],
    limits: [
      "Un besoin d’achat n’est ni une quantité de commande ni un segment individuel déduit des seules ventes.",
      "Ne pas créer ou valider une unité de besoin sans décision explicite.",
    ],
    measurement:
      "Définir le besoin visé puis suivre les produits concernés sans mélanger des quantités en kg et en pièces.",
  },
  {
    topic: "ASSOCIATIONS",
    referenceId: "associations",
    source: "needs",
    title: "Proposer une complémentarité à tester",
    sourceFinding: needsFinding,
    applicationHypothesis:
      "Rapprocher des produits utiles au même repas peut être testé comme une complémentarité de service. Ce principe de travail ne prouve aucune association observée dans les paniers.",
    discriminatingQuestions: [
      "Quel usage commun justifie ce rapprochement, et l’espace permet-il de le rendre compréhensible ?",
    ],
    checks: [
      "PRODUCT",
      "COMMERCIAL_DOCUMENTS",
      "FIELD_OBSERVATION",
      "ANALYTICS",
    ],
    limits: [
      "Des évolutions de ventes simultanées ne prouvent pas des achats dans un même panier.",
      "Ne pas inventer de taux d’attachement ou de panier moyen sans transactions adaptées.",
    ],
    measurement:
      "Observer les ventes et la casse des produits concernés avant et pendant le test, en conservant les autres changements comme explications concurrentes.",
  },
  {
    topic: "SUBSTITUTION",
    referenceId: "substitution",
    source: "needs",
    title: "Examiner une alternative sans promettre le report",
    sourceFinding: needsFinding,
    applicationHypothesis:
      "Une alternative peut être pertinente pour un même usage déclaré. Le sens de la relation, le format et la disponibilité doivent être vérifiés dans les données et sur le terrain.",
    discriminatingQuestions: [
      "L’alternative répond-elle au même usage, et sa disponibilité a-t-elle été vérifiée ?",
    ],
    checks: ["SUBSTITUTIONS", "STORE_EVENTS", "PRODUCT", "ANALYTICS"],
    limits: [
      "Une relation dans un sens ne prouve pas l’inverse ; utiliser les relations dirigées confirmées.",
      "Une hausse concomitante ne quantifie ni un report individuel ni des ventes perdues ; aucune élasticité n’est inventée.",
    ],
    measurement:
      "Comparer des périodes compatibles en gardant la rupture déclarée, les opérations et les autres variations comme contexte, pas comme preuve causale.",
  },
  {
    topic: "VISIBILITY",
    referenceId: "visibility",
    source: "visibility",
    title: "Tester la visibilité de l’offre",
    sourceFinding:
      "L’étude observe une évolution des ventes après déplacement et élargissement du rayon vers l’entrée. Les résultats s’atténuent dans le temps et les effets au niveau des ménages restent incertains.",
    applicationHypothesis:
      "Une présentation plus visible et lisible peut être testée ; on ne peut attribuer l’effet à une seule composante ni transférer le résultat de cette étude à une TG locale.",
    discriminatingQuestions: [
      "Quel emplacement, quelle visibilité et quelle exécution sont réellement constatés ?",
    ],
    checks: [
      "FIELD_OBSERVATION",
      "EXECUTION",
      "ANALYTICS",
      "COMMERCIAL_DOCUMENTS",
    ],
    limits: [
      "Magasins anglais et étude non randomisée : pas de promesse de gain ni d’équivalence avec le magasin pilote.",
      "Une photo ne mesure pas les passages ni les dimensions ; une TG prévue n’est pas une TG installée.",
    ],
    measurement:
      "Dater la mise en place réelle puis examiner ventes, marge connue et casse sur des périodes comparables, avec prix, disponibilité et autres promotions comme facteurs concurrents.",
  },
  {
    topic: "SEASONALITY",
    referenceId: "seasonality",
    source: "season",
    title: "Distinguer disponibilité, saison et cœur de saison",
    sourceFinding:
      "Le calendrier Interfel distingue disponibilité, saison et cœur de saison en tenant compte des variétés, zones et modes de production ou de conservation.",
    applicationHypothesis:
      "Mettre en avant une offre saisonnière exige de préciser produit, origine et période ; le repère national ne remplace ni le document commercial de la semaine ni l’approvisionnement confirmé.",
    discriminatingQuestions: [
      "De quel produit, de quelle origine et de quelle semaine parle-t-on ?",
    ],
    checks: ["PRODUCT", "COMMERCIAL_DOCUMENTS", "STORE_CONTEXT"],
    limits: [
      "Ne pas déduire un cœur de saison ou une disponibilité locale du seul mois.",
      "Vérifier une source actuelle pour une campagne, un prix ou une tension d’approvisionnement ; ce repère n’est pas une information de marché en temps réel.",
    ],
    measurement:
      "Situer la proposition dans sa semaine et confronter l’offre réelle aux résultats disponibles sans attribuer automatiquement une variation à la saison.",
  },
  {
    topic: "WASTE_DIAGNOSIS",
    referenceId: "waste-diagnosis",
    source: "waste",
    title: "Construire un diagnostic de casse exploitable",
    sourceFinding:
      "L’ADEME publie une méthode de diagnostic du gaspillage destinée aux grandes et moyennes surfaces. La notice seule ne fournit ni seuil de performance ni protocole détaillé utilisable ici.",
    applicationHypothesis:
      "Dans l’application, un diagnostic utile peut partir des montants et dates enregistrés, puis rechercher les produits dominants et les causes terrain documentées avant de choisir un test.",
    discriminatingQuestions: [
      "Les dates correspondent-elles à la saisie ou au fait terrain, et connais-tu la cause du retrait ?",
    ],
    checks: ["ANALYTICS", "STORE_EVENTS", "PRODUCT", "FIELD_OBSERVATION"],
    limits: [
      "La casse valorisée au prix de vente n’est pas un coût d’achat perdu, un tonnage ni un diagnostic réglementaire certifié.",
      "Une journée manquante n’est pas une absence de casse ; ne pas définir un seuil bon/mauvais sans référence pertinente.",
    ],
    measurement:
      "Suivre les montants renseignés et leur couverture, distinguer les canaux Mercalys/photo et utiliser seulement des quantités de même unité lorsqu’elles sont fiables.",
  },
];
const cards = draft.map(({ referenceId, source, ...card }) =>
  retailExpertiseCardSchema.parse({
    ...card,
    citation: {
      kind: "RETAIL_EXPERTISE",
      referenceId,
      version: 1,
      reviewedOn,
      reviewAfterOn,
      sources: [sources[source]],
    },
  }),
);
/** Curated snapshots, not live research, store memory or permission to execute an action. */
export function readRetailExpertiseReference(
  raw: unknown,
  asOf = new Date().toISOString(),
) {
  const input = retailExpertiseInputSchema.parse(raw);
  const status = retailExpertiseFreshness(cards[0]!.citation, asOf);
  return {
    input,
    edition: RETAIL_EXPERTISE_EDITION,
    evaluatedAt: asOf,
    status,
    cards:
      status === "CURRENT"
        ? input.topics.map((topic) =>
            retailExpertiseCardSchema.parse(
              cards.find((c) => c.topic === topic)!,
            ),
          )
        : [],
  };
}
