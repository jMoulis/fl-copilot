# Courbes produits et photos sans fond — 12 novembre 2026

## Périmètre demandé

Reprendre la planche `02_parcours_complet.png`, écran Produits, dans la liste analytique : image détourée, nom compact, montant, variation et petite courbe à droite. Retirer le fond d’interface ajouté derrière les photos. Les champs, agrégations et comparaisons métier restent ceux de l’Explorer existant.

## Implémentation

- Chaque courbe reçoit les points déjà chargés du produit et la période de l’analyse. Aucun lecteur SQLite, abonnement ou appel distant par ligne.
- Les regroupements viennent de `explorerChartBuckets` : jours sur les semaines/mois, mois sur les années/périodes longues, agrégation explicitement citée conservée.
- Géométrie locale uniquement, sans nouvelle dépendance : segments natifs mémorisés sur la page existante de 20 produits. Échelle propre à chaque courbe, exposée dans les informations.
- Une donnée manquante coupe la courbe. Une valeur zéro reste un point réel ; les valeurs négatives restent représentables. Un seul total journalier produit un point, jamais des heures inventées.
- Variations selon la comparaison canonique ; les écarts partiels restent indicatifs avec ≈ et leur qualification dans « i ». Une hausse de casse n’est pas colorée comme une amélioration.
- Filtres hausse/baisse accessibles directement ; montant/écart/pourcentage dans un panneau de tri ; sens du classement conservé. Les critères existants, leur pagination et leur mémorisation restent utilisés.
- Le composant photo devient transparent lorsque l’image est disponible. Les cadres d’aperçu de la fiche et de la confirmation ne peignent plus de fond. Les placeholders, originaux, provenance, approbations et cache privé restent conservés. Cette modification ne détoure pas les pixels opaques d’un fichier source.

## Vérification

Tests ciblés : géométrie avec coupures, zéro, négatifs, série constante, point journalier, mois absents et moyenne explicite ; vue montée du filtre/tri/informations/fiche ; dépôt SQLite analytique ; cache PNG et absence de fond ajouté sur l’image chargée. Les contrôles complets et la livraison sont consignés séparément.

Simulateur iPhone 17 Pro, iOS 26.3, Expo Go avec API de production : rendu réel des lignes et photos transparentes, ouverture du panneau de tri, sélection du pourcentage, ouverture d’une fiche via « i », retour à la même liste avec le tri et le défilement conservés. Commandes UI programmatiques via l’inspecteur local ; aucune écriture métier ni nouvel appel IA. Les captures d’affinage sont conservées hors dépôt dans `/private/tmp/fl-sparkline-*.png`. Ce contrôle ne vaut pas recette tactile sur iPhone.

## Recette iPhone groupée

1. Analyses : semaine puis mois/année, CA puis marge/casse. Vérifier les courbes et le détail d’une comparaison indicative.
2. Filtrer les baisses, trier en € puis en %, inverser le sens ; ouvrir une fiche puis revenir et retrouver la sélection/position.
3. Vérifier un PNG transparent dans la liste, le catalogue et la fiche. Un fond blanc réellement présent dans le fichier reste distinct d’un fond d’interface.

Ce lot mobile n’exige ni déploiement API, ni migration, ni outil ou prompt IA supplémentaire. Le build précédent reste utilisable ; livraison et recette propriétaire ne sont pas présumées par la compilation.
