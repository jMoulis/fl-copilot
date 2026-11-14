# Types d’alertes transport — 14 novembre 2026

Le propriétaire valide le build 57 et demande des filtres sur les **effets sur le trafic**, pas sur les causes (travaux, grèves…).

## Fonctionnement

Mon magasin → Transports : six interrupteurs — Interruptions, Service réduit, Retards, Déviations, Modifications de service, Informations et autres. Tout est sélectionné par défaut. La sélection se sauvegarde avec les lignes, via StoreContextSettings, SQLite/Outbox, versions et résolution canonique des conflits. Un champ absent ou null signifie tous les types ; une liste vide masque les messages, sans signifier un trafic normal. La comparaison de conflit affiche aussi les types.

Correspondance déterministe des codes `severity.effect` Navitia : NO_SERVICE, REDUCED_SERVICE, SIGNIFICANT_DELAYS, DETOUR, MODIFIED_SERVICE/ADDITIONAL_SERVICE ; autres codes, absents et inconnus dans Informations et autres. Aucune déduction de cause ni classement IA. Le correctif ci-dessous précise le cas des équipements de station mal codés comme retards par la source.

Documentation officielle : https://doc.navitia.io/ ; https://prim.iledefrance-mobilites.fr/jeux-de-donnees/idfm-navitia-line_reports-v2

## Données et compatibilité

Le fournisseur est interrogé comme auparavant pour les lignes activées. Le filtrage s’applique aux projections du Journal et du Copilote, après conservation des relevés, pas aux archives originales ni au cache partagé entre magasins. Les dates de capture, d’application et les états de fraîcheur restent inchangés. Les historiques de chaque ligne sont filtrés de la même façon. Les extraits sources restent bornés et qualifiés comme partiels lorsqu’ils sont tronqués ou filtrés ; il ne s’agit pas d’un historique exhaustif du réseau.

Aucune collection, table, migration, commande métier, appel IA, agent ou outil supplémentaire. Le champ optionnel `transportAlertTypes` appartient aux réglages existants. La capacité indépendante `transportAlertFilters` protège les anciens lecteurs stricts : ACK/conflit, pull et bootstrap omettent ce champ sans capacité ; un ancien écrivain qui l’omet ne l’efface pas. Le nouveau client adopte la capacité par un bootstrap canonique avant d’avancer son curseur, et conserve sa base si l’API ne la connaît pas.

API compatible avant livraison native. Le build 57 validé ne contient pas ces filtres. La recette physique reste à faire sur une prochaine version : désélectionner Retards, enregistrer/synchroniser, revenir au Journal, puis réactiver pour retrouver les messages déjà collectés. Une absence de message dans la sélection n’est jamais annoncée comme un trafic normal.

## Vérification

70 tests ciblés réussis avec Mongo isolé en replica set, dont transactions et conflits entre appareils, projections legacy/capables, conservation des préférences après écriture legacy, archive intacte et réactivation sans fournisseur. Tests natifs SQLite/Outbox, adoption de capacité et correspondance des codes. Fournisseurs simulés dans ces tests ; aucun résultat PRIM réel ou recette iPhone n’est inventé.

## Correctif après recette du build 58 — équipements de station

La sélection enregistrée du magasin exclut bien INFORMATION, mais plusieurs
messages PRIM « Panne d’un ascenseur » portent SIGNIFICANT_DELAYS. Le filtre
initial, fondé uniquement sur cet effet, les laisse passer. Les liens d’une
station dans un line_report peuvent aussi faire remonter ces messages sur
plusieurs lignes voisines ; ne pas supprimer tous les liens de station, qui
portent également de vraies fermetures ou suppressions d’arrêt.

Réutiliser INFORMATION pour les messages explicitement limités à une panne,
indisponibilité ou maintenance d’ascenseur/escalator/escalier mécanique. Une
mention de localisation ne constitue pas un effet sur la circulation. Un
message mixte annonçant également interruption, retard, déviation, station
fermée ou arrêt non desservi conserve le groupe de son effet source. La
reconnaissance textuelle est déterministe et prudente : ce n’est ni une nouvelle
catégorie fournie par PRIM ni un classement IA. Les cas ambigus restent sous
l’effet original. Les textes, effets, identifiants et dates archivés ne changent
pas ; les projections courantes et historiques appliquent le même helper.

Avant la borne existante de huit messages, conserver les avis de circulation en
priorité, puis les avis d’équipement, sans modifier l’ordre à l’intérieur des
deux groupes. Une capture tronquée reste partielle. Les anciennes captures
bornées ne permettent pas de retrouver les messages déjà omis ; les nouvelles
captures bénéficient du nouvel ordre lors du prochain appel fournisseur normal,
sans invalider le cache ni réécrire les archives.

Livraison API uniquement, compatible build 58. Recette iPhone encore non
validée : actualiser le Journal avec Informations et autres désactivé, vérifier
la disparition des pannes d’ascenseur seules, puis réactiver cette catégorie
pour retrouver les messages conservés. La présence d’une alerte ne prouve pas
un impact sur la fréquentation du magasin.

Vérification du correctif : 44 tests ciblés passent, dont la lecture des archives
sur Mongo isolé sans appel fournisseur. Le défaut a été reproduit avant la
correction (équipement affiché comme retard et vraie interruption évincée de la
borne). Les huit occurrences réelles échantillonnées dans l’archive du magasin
sont reconnues comme avis d’équipement seuls ; ce sont des doublons possibles
entre lignes, pas huit incidents distincts. Cela ne constitue pas une validation
physique du build par le propriétaire.
