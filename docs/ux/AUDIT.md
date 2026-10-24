# Audit UX et arbitrages V1 — 19 octobre 2026

## Arbitrage complémentaire — 24 octobre : PDF dans la conversation

Le retour de Julien précise la séparation entre lecture et action métier. Joindre un PDF doit permettre au copilote de lire immédiatement son original dès l’envoi terminé, de discuter de toute période demandée et de préparer la semaine suivante. La revue d’une extraction et la semaine courante ne sont pas des prérequis à cette discussion. Les validations canoniques restent liées à l’enregistrement des offres, décisions et réalisations ; une lecture IA du document ne devient pas un indicateur officiel du magasin.

Dans le fil, la pièce jointe donne accès à l’original. Le panneau de suivi/reprise du traitement commercial appartient à l’espace Documents commerciaux, où il reste accessible ; il ne doit pas être remonté sous chaque occurrence de PDF dans l’historique et laisser croire qu’une analyse métier doit être validée avant la réponse. Le traitement en arrière-plan existant et les parcours d’enregistrement gardent leurs propres états. Cet arbitrage ne clôture ni le parcours réel discussion → action ni la recette native.

## Référence historique de l’audit initial

Référence de code examinée : `824cf4c2262b611606d5bea4f927d8d3dfafab65` (PR 273). Les onze textes du ZIP v1.1 (README et specs 00–09) et ses trois planches ont été lus/inspectés. Cet audit ne modifie pas l’application et ne vaut pas recette du binaire installé.

## Conclusion

L’UX fait partie du périmètre V1. L’Explorer analytique natif est un manque fonctionnel important, pas une finition graphique. Le code métier et le copilote sont beaucoup plus avancés que l’interface native de consultation. Les mentions « locked decisions » du document d’un autre agent sont des propositions à confronter aux décisions de Julien et aux invariants du projet ; elles ne créent aucune autorité supplémentaire.

La date du 28 octobre est une cible de présentation, pas une preuve que tous les critères V1/M8 sont déjà couverts. L’annonce précédente d’une livraison complète au 21–22 était insuffisamment fondée : ce jalon peut être une première tranche UX testable, pas une promesse de conformité intégrale au ZIP. Aucun retrait de périmètre V1 n’est décidé dans cet audit.

## Ce qui existe et doit être réutilisé

- Expo Router, composants natifs, feuilles de détail, formulaires, accessibilité partielle, SQLite, migrations, Outbox et synchronisation bidirectionnelle.
- Indicateurs déterministes quotidiens, calculs sur périodes explicites, couverture et contributions ; outils d’analyse du chat. Calcul sur une période arbitraire ne signifie pas sélection/comparaison ISO automatique déjà disponible.
- Imports Mercalys multiples/ZIP, publications et corrections, PDF commerciaux, tickets multi-photos, référentiel produits/besoins/associations, préparation et plans commerciaux, tâches et déclarations d’exécution.
- Chat natif, streaming, étapes d’outils, sources, formulaires, conversations, mémoire et compactage ; nombreux parcours de modification/revue codés.
- Plan physique magasin versionné, géométrie qualifiée, référence/brouillon, propositions d’affectation et schéma ; lien à la préparation et validation commerciale séparée.

Le suivi M7 distingue code prêt, livré et validé. Beaucoup de lots récents sont encore en attente de livraison groupée ; un test automatisé ou une maquette web ne remplace pas une validation iPhone.

## Écarts vérifiés dans le code

1. `apps/mobile/src/app/(tabs)/analytics.tsx` affiche inconditionnellement un titre et un état vide. Aucun Explorer natif Jour/Semaine/Mois/Année, graphique ou drill-down n’y est branché.
2. `apps/mobile/src/app/(tabs)/_layout.tsx` conserve Aujourd’hui / Ma semaine / Analyses / Casse / Plus. Produits est une route masquée et le chat est hors de ce groupe d’onglets. Ce n’est pas la navigation des planches ; les piles indépendantes par domaine ne sont pas matérialisées comme demandé.
3. `apps/mobile/src/design/tokens.ts` et `components/ui.tsx` utilisent le thème clair et des cartes blanches. Passer au sombre nécessite aussi les textes, champs, modales, badges, graphiques, clavier et barre système ; remplacer seulement les couleurs racines serait insuffisant.
4. `products/index.tsx` est une liste de cartes avec ajout/édition et état de sync. Recherche, filtres et présentation compacte orientée consultation des maquettes restent à intégrer ; les éditeurs métier sont à conserver.
5. `apps/mobile/src/store/ui.ts` ne conserve que l’ouverture de l’écran À propos. Aucun état Analytics complet période/filtres/historique/scroll n’y est implémenté. Un état UI dédié est à construire, sans déplacer les données métier hors SQLite.
6. `packages/analytics-core/src/calendar-period-comparison.ts` calcule des périodes de dates fournies explicitement. Ce module ne sélectionne pas par lui-même la même semaine ISO N−1 ni les appariements de jours requis par le ZIP. Il faut réutiliser les formules, ajouter la politique calendaire et tester les limites.
7. Aucun modèle de bibliothèque visuelle correspondant à `visual_assets`, `visual_identities`, `product_visual_links`, `image_enrichment_jobs` n’a été identifié dans les contrats/migrations inspectés. Les photos source de casse/PDF ne constituent pas une bibliothèque d’images produit.
8. Les reçus et la préparation commerciale existent. Le ZIP traite trop peu leurs parcours réels, les corrections Mercalys, les réglages magasin, la mémoire et la synchronisation ; ils ne doivent pas disparaître lors de la nouvelle navigation.

## Arbitrages retenus

### 1. Direction visuelle et navigation

Retenir Dark Premium, hiérarchie plus compacte, graphiques lisibles, états métier et composants cohérents. Adapter les rendus translucides/décoratifs aux contraintes natives, contraste et performances.

Retenir comme cible cohérente cinq domaines : Aujourd’hui / Analyses / Produits / Copilote / Actions, avec pile propre et contexte conservé. Garder le copilote directement accessible, conversationnel et principal dans le parcours. Le choix de l’onglet d’ouverture doit être cohérent avec cette priorité ; il n’est pas dicté par l’ordre visuel de la planche.

Préserver Ma semaine, documents commerciaux, préparation/TG, casse, imports, paramètres magasin et synchronisation. Proposition de rangement : semaine/plan/tâches dans Actions avec liens depuis Aujourd’hui et le chat ; capture/import par actions explicites et depuis le compositeur ; réglages/synchronisation par une entrée de gestion stable. Les emplacements exacts seront montrés sur le premier parcours natif avant généralisation. La migration des routes garde les anciens liens et la reprise des écrans en cours. L’ancienne charte à cinq onglets doit être alignée explicitement, pas contournée en cachant des routes.

### 2. Chat

Conserver le chat simple demandé par Julien : conversations, saisie, fichiers/photos, réponses naturelles, tableaux, sources et cartes seulement lorsqu’une action ou une information est nécessaire. Écarter une transformation de l’écran principal en mur de cartes « Recommandations / Questions / Insights ». Trois priorités restent une limite du brief Aujourd’hui/Ma semaine, pas une limite aux analyses ou à la discussion.

### 3. Temps et comparaisons

Retenir Jour/Semaine/Mois/Année, flèches, sélecteurs adaptés, granularité ancrée sur la date, retour exact et filtres conservés. Centraliser les périodes et comparaisons dans le moteur partagé, puis les exposer au chat et à l’Explorer ; ne pas créer deux vérités.

Pour l’Explorer, retenir le défaut semaine ISO N−1 et jour de même semaine ISO/jour de semaine. Préserver les vues ou demandes explicites J−7 : N−1 et J−7 ne sont pas interchangeables. Mois/année : comparaison civile qualifiée, sans normalisation commerciale inventée. Formaliser les jours clos/importés appariés et les fermetures avant d’afficher un delta ; absence d’import, zéro et couverture différente restent distincts. Semaine 53 sans correspondant : indisponible/non comparable, sans remplacement caché.

Les dates des images ne sont pas fiables : en 2026, la semaine ISO 43 va du 19 au 25 octobre, et non du 20 au 26 indiqué sur la planche. Les périodes viennent du moteur, jamais du dessin.

### 4. Chiffres et recommandations illustrés

Écarter les graphiques horaires avec seules données journalières, les stocks supposés, le surstock calculé sans stock fiable, les commandes automatiques en kg et les prévisions de ventes non modélisées. Ne pas ajouter des données de démonstration au métier pour imiter une carte.

Les variations « météo +12 % » et « promo +18 % » des images ne prouvent aucune causalité. Afficher les observations mesurées et des hypothèses qualifiées ; contextualiser météo, promos, calendrier et ruptures sans inventer leur contribution. Aucun pourcentage sur dénominateur nul/manquant ou périodes incomparables. La marge agrégée reste pondérée par les montants ; les kg, pièces et conditionnés ne sont pas mélangés.

### 5. Visuels produits et implantation

Deux besoins distincts : bibliothèque produit réutilisable et illustration d’une implantation. Ne pas créer une image à chaque import/SKU. Le socle V1 de bibliothèque doit permettre placeholder cohérent, réutilisation d’image approuvée, lien/override manuel persistant, déduplication, provenance, cache et sync. Les automatismes de recherche sous licence/génération sont un sous-lot conditionnel explicitement désactivé tant que droits, fournisseur et budget ne sont pas validés. Ils ne doivent pas retarder la première tranche Explorer.

L’illustration du plan reste dans la roadmap M7. Elle reprend une référence physique et un scénario identifiables, conserve les contraintes inconnues et ne sert jamais de preuve d’une capacité mesurée. Ne pas la confondre avec les vignettes du catalogue.

### 6. Sources de casse

La formulation « vrac par photo / conditionné par Mercalys » du ZIP est trop catégorique. Garder le canal source distinct de la nature du produit : un ticket photographié peut contenir un article conditionné ; aucun montant de ticket ne modifie le CA Mercalys. Réconciliation et prévention du double comptage restent celles des services existants.

## Ce que cet audit ne prouve pas

Pas de nouvelle recette sur le téléphone, d’inspection des logs de production ou de mesure de performance réelle. Le dernier état de livraison utilisé est celui consigné dans le suivi ; il faut le relire sur les services avant toute livraison. Aucune nouvelle dépendance, architecture, donnée de stock, commande fournisseur ou autorisation commerciale n’est introduite.

## Sources

ZIP `docs/ux/FL_Copilot_Implementation_Specs_v1_1.zip`, textes 00–09, trois planches ; `docs/M7_CONVERSATIONAL_DELIVERY_PLAN.md` ; `docs/progress/M7_WORKSTREAM_STATUS.md` ; `docs/PRODUCT_ROADMAP.md` ; `docs/specs/IMPLEMENTATION_PLAN.md` ; `docs/RELEASE_PROCESS.md` ; `docs/qa/M7_GROUPED_IPHONE_ACCEPTANCE.md` ; fichiers natifs/domain cités ci-dessus. L’introduction du roadmap produit et de l’inventaire des outils date d’avant plusieurs incréments : elle ne suffit pas à déterminer l’état actuel ; le code et le journal M7 récent ont servi de contrôle.
