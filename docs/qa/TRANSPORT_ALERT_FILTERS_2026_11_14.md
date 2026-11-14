# Types d’alertes transport — 14 novembre 2026

Le propriétaire valide le build 57 et demande des filtres sur les **effets sur le trafic**, pas sur les causes (travaux, grèves…).

## Fonctionnement

Mon magasin → Transports : six interrupteurs — Interruptions, Service réduit, Retards, Déviations, Modifications de service, Informations et autres. Tout est sélectionné par défaut. La sélection se sauvegarde avec les lignes, via StoreContextSettings, SQLite/Outbox, versions et résolution canonique des conflits. Un champ absent ou null signifie tous les types ; une liste vide masque les messages, sans signifier un trafic normal. La comparaison de conflit affiche aussi les types.

Correspondance déterministe des codes `severity.effect` Navitia : NO_SERVICE, REDUCED_SERVICE, SIGNIFICANT_DELAYS, DETOUR, MODIFIED_SERVICE/ADDITIONAL_SERVICE ; autres codes, absents et inconnus dans Informations et autres. Aucune déduction de cause ou classement IA à partir du texte.

Documentation officielle : https://doc.navitia.io/ ; https://prim.iledefrance-mobilites.fr/jeux-de-donnees/idfm-navitia-line_reports-v2

## Données et compatibilité

Le fournisseur est interrogé comme auparavant pour les lignes activées. Le filtrage s’applique aux projections du Journal et du Copilote, après conservation des relevés, pas aux archives originales ni au cache partagé entre magasins. Les dates de capture, d’application et les états de fraîcheur restent inchangés. Les historiques de chaque ligne sont filtrés de la même façon. Les extraits sources restent bornés et qualifiés comme partiels lorsqu’ils sont tronqués ou filtrés ; il ne s’agit pas d’un historique exhaustif du réseau.

Aucune collection, table, migration, commande métier, appel IA, agent ou outil supplémentaire. Le champ optionnel `transportAlertTypes` appartient aux réglages existants. La capacité indépendante `transportAlertFilters` protège les anciens lecteurs stricts : ACK/conflit, pull et bootstrap omettent ce champ sans capacité ; un ancien écrivain qui l’omet ne l’efface pas. Le nouveau client adopte la capacité par un bootstrap canonique avant d’avancer son curseur, et conserve sa base si l’API ne la connaît pas.

API compatible avant livraison native. Le build 57 validé ne contient pas ces filtres. La recette physique reste à faire sur une prochaine version : désélectionner Retards, enregistrer/synchroniser, revenir au Journal, puis réactiver pour retrouver les messages déjà collectés. Une absence de message dans la sélection n’est jamais annoncée comme un trafic normal.

## Vérification

70 tests ciblés réussis avec Mongo isolé en replica set, dont transactions et conflits entre appareils, projections legacy/capables, conservation des préférences après écriture legacy, archive intacte et réactivation sans fournisseur. Tests natifs SQLite/Outbox, adoption de capacité et correspondance des codes. Fournisseurs simulés dans ces tests ; aucun résultat PRIM réel ou recette iPhone n’est inventé.
