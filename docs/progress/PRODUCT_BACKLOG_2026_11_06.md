# Backlog produit — point du 17 novembre 2026

Ce fichier conserve son chemin historique pour les liens existants. Le statut
courant du pilote et les preuves sont dans [le point consolidé](PILOT_STATUS_2026_11_14.md).
Les anciennes étapes de préparation sont [archivées ici](PRODUCT_BACKLOG_HISTORY_THROUGH_2026_11_14.md) ;
leurs cases non cochées ne sont plus des tâches actives.

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

## Lot UX approuvé — Repères du jour

Un seul accès dans le Journal ouvre une page regroupant les huit rubriques.
Le contexte INSEE devient « Prix et conjoncture » sur cette page. La météo
compacte et « Analyser cette journée » après les notes restent dans le Journal.
Conserver la date, le retour, les sources et archives existantes.
[Suivi et vérification](../qa/JOURNAL_CONTEXT_PAGE_2026_11_18.md).

## Réserves et sujets explicitement reportés

- [ ] **Sauvegarde/restauration Atlas** : réserve M8 maintenue à la demande du
      propriétaire. Activation et restauration isolée ne sont pas qualifiées.
- [ ] **PA quotidiens / approfondissement des contre-promotions chiffrées** :
      chantier M7-2 reporté. Les calculs et conseils qualitatifs existants restent acquis.
- [ ] **Implantation détaillée** : chantier M7-6 reporté, à reprendre avec le plan
      merchandising et les mesures utiles. Le contexte déclaré actuel reste disponible.
- [ ] **M9** : Android et qualification dédiée d'accessibilité, non démarrés.

## Évolutions à prioriser à l'usage

- [ ] Finitions UX et graphiques à partir des maquettes et de défauts concrets.
- [ ] Contexte économique F&L plus détaillé, actualités nationales pertinentes et
      autres facteurs du Journal. Le socle actuel n'attend pas ces extensions.
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
