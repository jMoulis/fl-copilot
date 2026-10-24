# M7/M8 — besoins et associations, 24 octobre 2026

## Défauts reproduits et périmètre

Quinze attentes de refus échouaient sur SQLite jetable avant ce lot : besoins, appartenances produit/besoin et substitutions dirigées acceptaient une comparaison v2 après réception d’un conflit ou pull v3 (deux choix par cas), et pouvaient conserver le local face à une absence distante non vérifiée. Les services fermaient alors tout le groupe et le fallback pouvait réinitialiser la version. Aucune donnée de production n’a été modifiée pour ces preuves.

## Une comparaison, trois writers existants

Les trois services canoniques conservent leurs transactions et leurs payloads propres. Ils exposent une revue complète : référence/magasin, version locale actuelle, groupe OPEN et dernière version distante complète vérifiée, commandes actives et règles métier. La politique auparavant réservée au contrôleur de chat est déplacée dans le domaine natif des besoins et partagée avec les écrans manuels. Les fiches parentes et leurs libellés sont lus uniquement dans le magasin concerné.

Chaque confirmation exige l’empreinte exacte de la revue, un contexte encore actif et l’absence d’annulation. Une nouvelle version, modification locale, commande ou fiche parente impose une relecture. Absence non vérifiée, payload/enveloppe incohérent, contradiction au même numéro, réaffectation, origine différente, envoi actif ou limite dépassée ne permettent aucune résolution. Une base seulement reçue par pull reste conservée dans l’historique avant son remplacement ultérieur par ACK.

Tous les conflits examinés sont résolus atomiquement ; au plus une nouvelle commande stable utilise la dernière précondition distante. Les anciens snapshots, historiques et commandes sont conservés. Aucun faux ACK, création par défaut, réécriture de source ou observation chiffrée.

Les règles des besoins restent spécifiques : code synchronisé conservé pour retenir le local ; parent inactif/conflictuel ou identité invalide bloque la réémission d’une association ; l’adoption explicite d’une version distante valide reste possible lorsque la politique l’autorise. Réactiver une association rejetée exige un consentement séparé dans les deux interfaces. Le couple source → substitut reste dirigé ; retenir les déclarations locales reprend exactement les derniers scores/observations appris synchronisés. Aucun apprentissage n’est généré ni renversé ici.

## Parcours natifs

Les trois pages réutilisent la durée de vie React déjà testée pour Réglages et Événements ; elle ne contient ni permission métier ni writer. Une page commune de cette famille remplace les lectures/actions dupliquées et les chargements de catalogues entiers. Les deux versions, les noms disponibles, le groupe, les refus et une action de relecture sont visibles. Comparaison et éventuelle réactivation sont initialement non confirmées ; relecture, échec ou nouveau contexte invalide le consentement. Double appui et callbacks tardifs restent bornés au compte, magasin, cible, appareil, base locale et focus courants. Un changement de rôle invalide aussi la décision en cours, sans créer une nouvelle permission manuelle.

## Vérifications

- Les tests métier utilisent les vrais services et SQLite : anciennes comparaisons/pulls, refus d’absence inconnue, deux décisions, cent conflits sans commandes orphelines, conservation des commandes et scores, reprise hors ligne/redémarrage, révocation/annulation et rollback.
- La suite montée commune conserve les cas Réglages/Événements et couvre aussi les trois pages de besoins : choix, consentements, erreurs/relecture, changements tardifs de contexte/rôle et double appui. Les ports natifs simulés ne prouvent pas une validation physique.
- Six scénarios de groupe sont ajoutés à l’intégration Mongo transactionnelle existante : trois familles × deux choix, vrai conflit serveur → carte privée → transaction SQLite → envoi canonique → seconde SQLite. Leur exécution dépend de l’environnement Mongo de CI ; aucun fournisseur IA réel n’est appelé.
- La suite locale complète passe **3 593 tests / 652 ignorés selon l’environnement**, avec lint/structure et dix projets typés strictement. Les deux contrôles CI exacts, le build API et les exports natifs restent requis avant fusion. Les résultats finaux sont consignés dans la PR.

## Livraison et limites

La PR 347 est fusionnée après les contrôles push/PR exacts verts : 4 133 tests passés / 6 ignorés, build API et exports iOS/Android. Les PR 345–347 et ce complément sont hors build 14 ; ils attendent une prochaine livraison native groupée. API compatible inchangée, aucun déploiement propre ni build EAS payant pour ce lot.

Les conflits commerciaux gardent leurs politiques et limites propres ; aucune résolution universelle ni nouveau tool/prompt modèle n’est ajouté. Les sept chantiers restent : 1 Actions/conflits en cours ; 2 Contre-promotion code prêt ; 3 Documents, 4 Expertise, 5 Recommandations, 6 Implantation et 7 UX/validation en cours. Le périmètre V1/M8 complet et les recettes physiques iOS/Android restent ouverts.
