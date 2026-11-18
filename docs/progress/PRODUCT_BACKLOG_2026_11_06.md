# Backlog produit — point du 18 novembre 2026

**Régression signalée sur build 79 :** synchronisation en erreur, PA reçu par
email en attente et menus parfois inactifs. Omission de la capacité PA dans la
validation du bootstrap reproduite et corrigée localement, test rouge puis vert.
Correctif non encore livré ; cause du blocage tactile non confirmée.

**18 novembre — PA quotidiens livrés, build 79 disponible :** PR 539
fusionnée après CI push/PR/master vertes. Import local XLSX/ZIP et boîte mail
magasin réutilisent les parcours Mercalys ; date d’application, sources,
historique produit, doublons, corrections et prix à vérifier sont conservés.
Build 79 compilé sur le Mac, archive vérifiée et envoi accepté par Apple ;
disponible en TestFlight privé (`VALID` / `IN_BETA_TESTING`). Recette propriétaire en attente.
Les simulations chiffrées restent reportées. Voir
[le lot PA](../qa/PURCHASE_PRICE_SOURCE_2026_11_18.md).

Build 78 confirmé disponible en test interne TestFlight (`VALID` /
`IN_BETA_TESTING`, non expiré). La recette du propriétaire reste à recueillir.

## Livré — pas de nouvelle recette sans régression

- [x] Navigation Journal / Analyses / Copilote / Imports, raccourcis Produits et
      Réglages, séparation préparation et gestion des données, retour produit contextuel.
- [x] Premier lot de défilement du chat, skeleton Analyses, couverture dans le détail
      et graphiques compacts des produits. Les retours d'usage ne valent pas
      certification de tous les gestes ou fidélité graphique intégrale aux maquettes.
- [x] Titres automatiques et renommage manuel des conversations.
- [x] Génération d'images depuis la fiche produit et aperçus transparents, avec
      suppression des libellés récurrents. Plusieurs générations réussies rapportées
      après le correctif.
- [x] Routage léger et optimisation des outils du copilote, vérifiés sur les
      scénarios rapportés. Les coûts et la qualité restent à surveiller à l'usage.
- [x] Mémoire automatique privée : nouvelle préférence retenue puis retrouvée dans
      une nouvelle discussion, validée sur le build 60.
- [x] Journal quotidien : contexte extérieur, signalements/notes, collecte et
      archives, transports configurés/filtrés et lecture par le copilote.
- [x] Moteur descriptif du Journal : calculs et restitution fonctionnelle validés.
      Le test à deux paires de jours ne qualifie pas une association ou sa stabilité.

- [x] Pilotage quotidien du Journal, tâches commerciales et pense-bêtes privés
      avec rappel facultatif : fonctionnement et rappel validés par le propriétaire.
- [x] Marché solaire et finitions Réglages / Mon magasin / Synchronisation :
      build 74 accepté sur iPhone. Parcours, formulaires et retours validés.

- [x] **Journal — indices de prix fruits/légumes INSEE** : collecte et archives
      existantes enrichies, affichage natif et restitution du copilote validés
      par le propriétaire sur build 75 le 17 novembre, après correctif serveur
      PR 534. [Sources, livraison et validation](../qa/JOURNAL_PRODUCE_PRICES_2026_11_16.md).

## Livré et accepté — actualités nationales utiles au Journal

Le propriétaire approuve le 17 novembre le premier périmètre : mouvements sociaux
et restrictions nationales utiles aux déplacements ou à l’approvisionnement,
avec trois informations pertinentes maximum par jour. Réutiliser collecte,
archives et lecteurs existants ; aucune collecte IA, nouvelle orchestration ou
souscription payante. Les grands rendez-vous sportifs/électoraux restent hors de
ce premier lot. Les lots précédemment acceptés restent clos.

[Qualification des sources et critères du lot](../qa/JOURNAL_NATIONAL_NEWS_2026_11_17.md).
Premier incrément implémenté et vérifié localement : collecte bornée, archives,
lecture Copilote et affichage natif. Dates incertaines explicitement conservées ;
déduplication par URL canonique, pas de regroupement sémantique automatique.
PR 536 fusionnée après CI push/PR vertes ; CI master verte. API publiée et saine.
Build 76 compilé localement, vérifié et envoyé à Apple ; le propriétaire confirme
« tout fonctionne ». Ce lot est clos.

## Livré et accepté — Repères du jour

Un seul accès dans le Journal ouvre une page regroupant les huit rubriques.
Le contexte INSEE devient « Prix et conjoncture » sur cette page. La météo
compacte et « Analyser cette journée » après les notes restent dans le Journal.
Conserver la date, le retour, les sources et archives existantes.
PR 537 fusionnée, CI vertes ; build 77 compilé localement et accepté à l’envoi
par Apple, confirmé disponible en test interne TestFlight (`VALID` /
`IN_BETA_TESTING`). Le propriétaire confirme « Super ça fonctionne parfaitement » :
lot clôturé.
[Suivi et vérification](../qa/JOURNAL_CONTEXT_PAGE_2026_11_18.md).

## Lot livré — Analyses et graphiques, recette iPhone en attente

Maquette validée, avec ajout demandé : retrait du sélecteur Casse PA et de
« Comprendre cette répartition », catégories compactes, anneau de répartition,
barre de navigation comme sur la maquette. Les montants et comparaisons existants
restent déterministes. PR 538 fusionnée, CI push/PR/master vertes ; build 78
compilé localement, vérifié et accepté à l’envoi par Apple. Recette propriétaire
encore en attente. [Suivi](../qa/ANALYTICS_POLISH_2026_11_18.md).

## Lot PA livré — recette iPhone en attente

PR 539 fusionnée, CI push/PR/master vertes. API en production ; build local 79
vérifié et accepté à l’envoi par Apple. Imports locaux XLSX/ZIP et email magasin,
aperçu des variations, rapprochement, doublons/corrections, sources/historique,
confirmation des PA à vérifier et synchronisation sont inclus. Les PA sont HT
par unité produit validée. ACTIF ne modifie pas le catalogue ; les montants exacts
0,01/0,001 restent exclus jusqu’à confirmation explicite. Pas de nouvelle
simulation ni de recalcul des marges officielles Mercalys. Le fichier privé
fourni a été qualifié en base de test, pas importé en production.
[Qualification, tests et livraison](../qa/PURCHASE_PRICE_SOURCE_2026_11_18.md).

## Réserves et sujets explicitement reportés

- [ ] **Sauvegarde/restauration Atlas** : réserve M8 maintenue à la demande du
      propriétaire. Activation et restauration isolée ne sont pas qualifiées.
- [ ] **Approfondissement des contre-promotions chiffrées** : report maintenu.
      L’upload quotidien des PA est livré dans le lot ci-dessus.
- [ ] **Implantation détaillée** : chantier M7-6 reporté, à reprendre avec le plan
      merchandising et les mesures utiles. Le contexte déclaré actuel reste disponible.
- [ ] **M9** : Android et qualification dédiée d'accessibilité, non démarrés.

## Évolutions à prioriser à l'usage

- [ ] Finitions UX et graphiques à partir des maquettes et de défauts concrets.
- [ ] Éventuelles extensions du contexte économique F&L ou des facteurs du
      Journal, à cadrer sur un besoin concret. Les indices INSEE, les actualités
      nationales du premier périmètre et leur navigation sont déjà livrés et acceptés.
- [ ] Évaluation de l'utilité des associations quand un historique comparable
      suffisant existe ; pas de modèle causal/prédictif déclaré validé.
- [ ] Étude du nouveau payload de la webapp Mousquetaires, gardée de côté.

Le pilote administratif de trois illustrations externes reste un ancien cas
non exécuté faute de prérequis attestés. La génération dans l'application ne
fabrique ni ses fichiers, ni ses approbations, ni son intégration passée. Toute
reprise conserve les exigences de provenance et d'import canonique.

## V2 explicitement demandée

- [ ] Génération d'images de TG ; une illustration ne prouve pas la faisabilité
      physique ou une installation réalisée.

La surveillance des coûts, de la collecte et des régressions est de la maintenance,
pas une raison de laisser ouverts indéfiniment les anciens lots acceptés.

Décision du propriétaire — 16 novembre 2026 : le détourage des photos existantes
est retiré du périmètre, jugé inutile. Ne plus le proposer comme prochain lot.
