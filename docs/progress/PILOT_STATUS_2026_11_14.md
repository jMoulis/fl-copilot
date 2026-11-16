# État courant — pilote iPhone, actualisé le 16 novembre 2026

Ce point consolide les arbitrages et validations du propriétaire. Il remplace les
anciens statuts « en attente » des journaux datés, sans transformer une validation
fonctionnelle en certification de tous les appareils ou scénarios.

## Version utilisée

- iOS **0.1.0 (74)**, distribué dans le groupe TestFlight privé habituel et
  accepté par le propriétaire. Source native `ff01b9462228c3bc99625eb4a7b03889275be78e`.
  Les finitions Réglages, Mon magasin et Synchronisation sont clôturées.
- Le point serveur du 14 novembre documentait la publication du moteur du Journal
  depuis `9429f2b42951e7ec1be8752e265d53254095939f` ; les évolutions suivantes
  distinguent leur propre livraison de la version native.
- Pas de nouvelle recette générale M0–M8 demandée sans régression identifiée.

## Socle validé

| Périmètre               | Statut courant                                                        | Réserve conservée                                                                                               |
| ----------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| M0–M6                   | Clôturés pour le pilote iPhone                                        | La qualification multiplateforme reste distincte.                                                               |
| M7, chantiers 1/3/4/5/7 | Clôturés pour leur périmètre fonctionnel pilote                       | Les nouvelles évolutions ne rouvrent pas les recettes acceptées.                                                |
| M7, chantier 2          | Conseil qualitatif accepté ; approfondissement numérique reporté      | Import quotidien des PA et qualification des simulations futures. Les calculateurs existants restent conservés. |
| M7, chantier 6          | Contexte magasin déclaré disponible ; implantation détaillée reportée | Plan merchandising du groupement, mesures et faisabilité physique.                                              |
| M8                      | Pilote iPhone clôturé                                                 | Sauvegarde serveur Atlas et restauration isolée explicitement reportées.                                        |
| M9                      | Non démarré, reporté                                                  | Android et qualification dédiée d'accessibilité.                                                                |

Les copies/restaurations locales et les conflits iPhone/simulateur ne valent pas
validation d'une restauration cloud Atlas. Cette réserve reste visible.

## Évolutions livrées après le pilote

- Navigation **Journal · Analyses · Copilote · Imports**, accès Produits/Réglages
  dans l'en-tête, retour d'une fiche produit vers son origine. Les finitions de
  style se poursuivent à l'usage ; la fidélité intégrale aux maquettes n'est pas
  déclarée acquise.
- Défilement du chat, skeleton Analyses, couverture derrière les informations et
  courbes compactes des produits : code livré, retours d'usage positifs. Ne pas
  inventer une recette détaillée pour chaque geste non rapporté.
- Génération d'images produits depuis la fiche, vrac/conditionné et transparence :
  parcours livré ; le propriétaire rapporte plusieurs générations réussies après
  le correctif. Le détourage des photos existantes est écarté par le propriétaire
  le 16 novembre 2026 et ne figure plus au backlog actif.
  L'ancien pilote administratif de trois fichiers externes n'est pas présenté
  comme exécuté ; toute reprise exige ses vrais fichiers, droits et provenance.
- Copilote : routage léger, titres/renommage, résultats d'outils compacts et accès
  direct au contexte courant. Le dernier bilan réel utilise trois étapes expertes,
  62 235 tokens d'entrée dont 43 514 en cache (déjà inclus), et 1 459 en sortie.
  Le précédent bilan était dans une discussion continuée : le gain observé n'est
  pas une mesure isolant l'effet du code ni une garantie de coût par demande.
- **Mémoire automatique validée sur le build 60** : nouvelle préférence retenue
  sans confirmation individuelle puis retrouvée dans une nouvelle discussion.
  Modification, oubli et désactivation restent accessibles.
- **Journal fonctionnel validé** : météo, calendriers, contexte économique,
  annonces locales et transports sélectionnés/filtrés, notes et signalements,
  archivage et lecture par le copilote. Les archives se constituent ; leur
  absence ne signifie ni absence d'événement ni indisponibilité des ventes.
- **Moteur descriptif v1 validé dans son fonctionnement** : l'utilisateur fournit
  une réponse fondée sur 2 paires exploitables sur 42 jours et une semaine. Le
  refus de conclure et les exclusions sont acceptés. L'utilité sur un échantillon
  suffisant reste à mesurer ; aucune causalité, prévision ou stabilité empirique
  n'est déclarée validée par ce test.

## Pilotage quotidien livré ; contexte économique en cours

Les tâches commerciales, pense-bêtes privés et leur rappel facultatif sont
validés par le propriétaire. Ils ne constituent plus un lot en attente.

Le lot suivant ajoute les indices INSEE mensuels des catégories fruits/légumes
au collecteur et aux archives existantes, en conservant leurs périmètres exacts
et la compatibilité native. Voir [le lot](../qa/JOURNAL_PRODUCE_PRICES_2026_11_16.md)
pour les preuves et la distinction entre code, livraison et recette.

Les [évolutions restantes](PRODUCT_BACKLOG_2026_11_06.md) sont séparées des anciens
lots clôturés. Aucune nouvelle date de livraison ou dépense n'est engagée ici.

## Sources du point

- [Clôture M0–M6](M0_M6_PILOT_CLOSURE_2026_11_02.md).
- [Périmètre des sept chantiers M7](M7_WORKSTREAM_STATUS.md).
- [Clôture pilote M8 et réserve Atlas](M8_HARDENING_STATUS.md).
- [Mémoire automatique](../qa/COPILOT_AUTOMATIC_MEMORY_2026_11_14.md).
- [Accès direct au contexte et mesure réelle](../qa/COPILOT_CONTEXT_DISCOVERY_2026_11_14.md).
- [Moteur descriptif et acceptation fonctionnelle](../qa/JOURNAL_DESCRIPTIVE_ASSOCIATIONS_2026_11_14.md).

Ce point est documentaire : il ne modifie ni les données, ni la collecte, ni les
instructions IA, et ne déclenche aucun build ou déploiement.
