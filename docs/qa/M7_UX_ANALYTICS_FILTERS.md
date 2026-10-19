# M7 — Explorer : périmètres, contributions et contexte (PR 275)

## Résultat et frontières

Le responsable peut affiner l’Explorer par catégorie, nature (Vrac/Conditionné/À préciser) ou produit du catalogue local. Le périmètre est visible à côté du montant principal. Les résultats restent issus des montants canoniques `product_daily_performance` et de la classification actuelle du catalogue ; le canal source n’est jamais utilisé pour inventer la nature d’un produit.

Sans filtre, le montant principal reste l’agrégat officiel `department_daily_performance`, même si le détail des produits est incomplet ou différent. Le détail n’est pas une recomposition silencieuse du total du rayon. Avec filtre, l’univers est celui des produits-jours observés sur les deux périodes ; un produit absent d’une journée ou de la référence n’est pas considéré vendu à zéro. Un produit introuvable ne devient pas une sélection de tout le rayon.

Les cartes de catégories et les montants par produit ouvrent un périmètre plus précis. Le classement porte sur les montants renseignés décroissants, pas sur une causalité, un impact prédit ou une quantité. Zéro, négatif et partiel restent visibles. Les résultats sont classés avant pagination, vingt produits par page ; les deltas de chaque produit réutilisent la politique de jours clos appariés de l’Explorer. Les anciennes politiques J−7 ne changent pas.

La somme et la qualification quotidiennes sont extraites du moteur `analytics.query` existant, puis réutilisées par ce moteur et l’Explorer. Les cas de requête du copilote restent inchangés. Aucun calcul monétaire n’est ajouté dans une vue React et aucun accès Mongo brut n’est exposé.

## Navigation

- Mois présente les semaines ISO qui l’intersectent, avec les dates lundi–dimanche complètes, même à cheval sur deux mois/années.
- Mois → semaine → jour → retours conserve filtres, période, ancre, pagination et les défilements vertical/horizontal. Le cache local v1 antérieur reçoit des valeurs de présentation par défaut ; les données métier ne sont pas migrées.
- Un indicateur Aujourd’hui ouvre la date et la métrique exactes dans Analyses. La référence N−1 de l’Explorer reste explicitement distincte du J−7 de la carte d’origine.
- Une fiche produit ouvre son périmètre dans la période Analytics conservée (ou la dernière période locale à l’initialisation). Le lien ne déclenche aucune modification de produit.
- Les paramètres de sélection sont limités et validés : période réelle, métrique et filtres, avec identité de navigation ; aucun magasin, acteur, opérateur, callback ou URL arbitraire. Un lien invalide conserve le contexte existant et affiche une explication.

Les liens depuis les citations du chat demandent encore des métadonnées structurées fiables ; une période n’est pas devinée dans un libellé ou une URL générée. Ce volet reste ouvert.

## Preuves automatisées et visuelles

- `pnpm check` : **2 178 tests réussis**, 496 cas conditionnés par l’environnement local ignorés ; lint et types réussis. Onze nouveaux cas, plus le cas de redémarrage sur disque enrichi avec les filtres et les deux défilements.
- Les nouveaux cas couvrent : égalité de sommes avec le moteur du chat, catégories/natures/identités, périmètres incompatibles, valeurs manquantes/partielles/zéro/négatives, doublons et magasin étranger, classement avant pagination, semaines ISO de frontière, sélection native stricte et retours exacts.
- Vraie base SQLite migrée : total officiel distinct du sous-total filtré, isolation magasin, aucune commande Outbox ; 5 100 lignes lues au-delà d’une page SQL pour tester le curseur date/produit, sans troncature du total.
- Formatage, build/import API et exports Hermes iOS/Android réussis. Les CI exactes push/PR, avec Mongo transactionnel, restent requises avant fusion.
- Aperçu local de composants de production compilés, à 390 points, avec données de test explicitement signalées : feuille de filtres, semaine Fruits à 5 286 €, Mois → semaine → jour → retours conservant Fruits, puis périmètre produit. Pas d’erreur console observée. Cet aperçu temporaire a été retiré des routes avant commit ; il ne prouve pas SQLite/authentification/gestes sur téléphone.

## Mesure de volume

Mesure ponctuelle sur ce Mac, avec SQLite Node en mémoire et données synthétiques : **147 produits × 730 jours = 107 310 instantanés**. Lecture + analyse complète d’une année et sa référence : **1 132 ms**, croissance du tas JavaScript d’environ **49 Mio**, cumul exact **53 655 €**, 365 jours comparables, 147 produits classés et vingt cartes retournées. Préparation de la base : 738 ms. Le script temporaire a été retiré après mesure ; ce benchmark ne s’ajoute pas au nombre de tests de la suite.

Cette mesure valide une charge synthétique et la pagination ; elle ne garantit ni la performance, ni le pic mémoire, ni l’absence de contention sur iPhone. Mesurer aussi le rafraîchissement pendant import/synchronisation lors de la recette native. Les lectures utilisent les index existants et des pages SQL de 5 000 lignes, dans une transaction cohérente. Limites explicites : 10 000 fiches et 500 000 instantanés. Au-delà, aucune somme n’est tronquée : le total officiel sans filtre reste lisible avec un avertissement pour le détail ; une sélection trop volumineuse demande une période plus courte ou un produit.

## Livraison et portes encore ouvertes

Code de consultation, sans migration, dépendance native, mutation métier, commande Outbox ou endpoint nouveau. Aucun déploiement, appel modèle/image ni build EAS payant n’est initié. Les captures et le benchmark sont conservés dans `artifacts/analytics-filters` du workspace partagé.

Ce lot complète une partie de L3/L4. Restent notamment les liens des citations du chat, les gestes/retours natifs, les formulaires non enregistrés, la cohérence des autres écrans et des médias, puis les portes M7/M8 et l’acceptation native groupée. Le périmètre V1 et les sept chantiers ne sont pas réduits ; aucun chantier complet ne devient validé sur la seule compilation.
