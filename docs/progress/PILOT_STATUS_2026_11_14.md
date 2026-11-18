# État courant — pilote iPhone, actualisé le 18 novembre 2026

**Correctif build 80 — 18 novembre :** PR 540 fusionnée, CI push/PR/master
vertes, archive compilée localement et vérifiée, envoi accepté par Apple.
Corrige le refus de la capacité PA dans le bootstrap mobile. Disponible en
TestFlight privé : `VALID` / `IN_BETA_TESTING`, non expiré, groupe propriétaire seul. Les blocages tactiles intermittents
restent non expliqués et non déclarés corrigés ; capture propriétaire attendue.

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

## Version utilisée

- Nouveau build **0.1.0 (79)** : PR 539, source
  `6f67d2a701d77923b07ec71aa4f64fd5970b7c1a`, compilé localement et vérifié,
  envoi accepté par Apple. TestFlight privé `VALID` / `IN_BETA_TESTING` ; recette propriétaire
  en attente. Lot PA quotidiens, incluant les évolutions du build 78.
- API courante : même source PR 539, déploiement
  `dpl_4WGdCzjpJc47sCrb1QE3q2eUUwYn`, région `cdg1`, alias
  `https://fl-copilot.vercel.app`. Santé/base connectée et refus privé 401 vérifiés.
  Déploiement antérieur conservé : `dpl_2RknNqVV9fa3ajnMemx14sfrjaBS`.

Les versions suivantes décrivent les livraisons antérieures :

- Nouveau build **0.1.0 (78)** : PR 538 fusionnée, CI push/PR/master vertes,
  archive compilée localement et vérifiée, envoi accepté par Apple. Source
  `a6fc7c3aec3f626db4546ca8a74f795bd334f23e`. Lot Analyses/graphiques et navigation ;
  recette propriétaire encore en attente. Build 77 reste la référence acceptée.

- iOS **0.1.0 (77)**, compilé localement sur le Mac, distribué dans le groupe
  TestFlight privé habituel. Source native
  `aa94fcfbdd6d26a729807936612d2aa7fa8b0ad8`. La navigation « Repères du jour »
  est acceptée : « Super ça fonctionne parfaitement ». Les actualités nationales sont
  acceptées (« tout fonctionne »). Le lot INSEE et sa restitution
  corrigée côté serveur sont acceptés par le propriétaire le 17 novembre.
  Le build 76 reste la précédente version acceptée ; les finitions Réglages,
  Mon magasin et Synchronisation du build 74 restent clôturées.
- API en service : `adb7efb80278a3ebf0e6b36b56444f6ab574ff26` (PR 536),
  déploiement `dpl_2RknNqVV9fa3ajnMemx14sfrjaBS`, région `cdg1`,
  `https://fl-copilot.vercel.app`. État public et base connectée vérifiés ;
  accès privé non authentifié refusé. Le correctif INSEE PR 534 reste acquis.
  Le build 76 ajoute la rubrique native d’actualités, testée par le propriétaire.
  Les erreurs internes des deux lectures Apple antérieures restent consignées
  comme telles, sans remettre en cause ce retour d’usage.
- Pas de nouvelle recette générale M0–M8 demandée sans régression identifiée.

## Socle validé

| Périmètre               | Statut courant                                                        | Réserve conservée                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| M0–M6                   | Clôturés pour le pilote iPhone                                        | La qualification multiplateforme reste distincte.                                                                                 |
| M7, chantiers 1/3/4/5/7 | Clôturés pour leur périmètre fonctionnel pilote                       | Les nouvelles évolutions ne rouvrent pas les recettes acceptées.                                                                  |
| M7, chantier 2          | Conseil qualitatif accepté ; approfondissement numérique reporté      | PA quotidiens livrés (recette build 79 en attente) ; simulations futures reportées. Les calculateurs existants restent conservés. |
| M7, chantier 6          | Contexte magasin déclaré disponible ; implantation détaillée reportée | Plan merchandising du groupement, mesures et faisabilité physique.                                                                |
| M8                      | Pilote iPhone clôturé                                                 | Sauvegarde serveur Atlas et restauration isolée explicitement reportées.                                                          |
| M9                      | Non démarré, reporté                                                  | Android et qualification dédiée d'accessibilité.                                                                                  |

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

## Pilotage quotidien et indices INSEE clôturés

Les tâches commerciales, pense-bêtes privés et leur rappel facultatif sont
validés par le propriétaire. Ils ne constituent plus un lot en attente.

Les indices mensuels fruits/fruits à coque et légumes/tubercules/bananes à cuire/
légumineuses sont collectés et archivés par les services existants. Leurs
périmètres officiels restent plus larges que le rayon frais. Le propriétaire
confirme « Oui c'est fixé » après le correctif de restitution PR 534 : ce lot
est clôturé. Voir [la fiche du lot](../qa/JOURNAL_PRODUCE_PRICES_2026_11_16.md).

## Lot Analyses livré — recette iPhone en attente

Le propriétaire valide la maquette des graphiques et ses ajustements de catégories,
répartition circulaire et navigation. Voir [le lot Analyses](../qa/ANALYTICS_POLISH_2026_11_18.md).
L’upload quotidien des PA est désormais livré en PR 539/build 79, sans lever
le report des simulations chiffrées.

## Derniers lots acceptés

Le propriétaire a approuvé le premier périmètre des actualités nationales le
17 novembre : mouvements sociaux et restrictions utiles aux déplacements ou à
l’approvisionnement. Le premier incrément est implémenté et vérifié localement,
avec collecte/archives existantes, compatibilité build 75 et affichage natif.
PR 536 fusionnée avec CI push/PR/master vertes ; API publiée et saine. Le build
76 est compilé localement, vérifié, envoyé à Apple et accepté par le propriétaire.
La réorganisation approuvée regroupe les rubriques sur une page
« Repères du jour » ; météo compacte et analyse restent dans le Journal.
PR 537 fusionnée, CI push/PR/master vertes. Build local 77 vérifié et envoyé
à Apple, confirmé `VALID` / `IN_BETA_TESTING` dans TestFlight. Le propriétaire
confirme « Super ça fonctionne parfaitement » : lot UX clôturé, sans nouvelle
recette à demander hors régression.
Voir [le lot UX](../qa/JOURNAL_CONTEXT_PAGE_2026_11_18.md). Voir la
[fiche du lot](../qa/JOURNAL_NATIONAL_NEWS_2026_11_17.md) pour les preuves et limites
(dates incertaines, couverture partielle, déduplication par URL).
Le [backlog actif](PRODUCT_BACKLOG_2026_11_06.md) conserve les reports explicites.

## Sources du point

- [Clôture M0–M6](M0_M6_PILOT_CLOSURE_2026_11_02.md).
- [Périmètre des sept chantiers M7](M7_WORKSTREAM_STATUS.md).
- [Clôture pilote M8 et réserve Atlas](M8_HARDENING_STATUS.md).
- [Mémoire automatique](../qa/COPILOT_AUTOMATIC_MEMORY_2026_11_14.md).
- [Accès direct au contexte et mesure réelle](../qa/COPILOT_CONTEXT_DISCOVERY_2026_11_14.md).
- [Moteur descriptif et acceptation fonctionnelle](../qa/JOURNAL_DESCRIPTIVE_ASSOCIATIONS_2026_11_14.md).

Ce point est documentaire : il ne modifie ni les données, ni la collecte, ni les
instructions IA, et ne déclenche aucun build ou déploiement.
