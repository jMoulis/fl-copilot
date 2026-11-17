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

## Prochaine proposition — cadrage, pas de chantier actif

**Actualités nationales utiles au Journal** : proposition présentée au propriétaire,
non encore arbitrée ni implémentée. Commencer par sélectionner les événements
utiles, leurs sources, dates/périmètres et limites de collecte. Éviter un fil
d'actualité généraliste, les doublons, une nouvelle orchestration IA et toute
promesse de causalité. Réutiliser les archives et lecteurs existants seulement
après vérification de leur adéquation. Aucun fournisseur, coût ou abonnement
supplémentaire n'est autorisé par cette inscription.

La [passation du 17 novembre](HANDOFF_2026_11_17.md) fixe le point de reprise.
Aucun lot livré ne reste artificiellement ouvert après la validation INSEE.

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
