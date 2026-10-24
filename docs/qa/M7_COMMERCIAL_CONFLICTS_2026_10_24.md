# M7/M8 — comparaisons commerciales, 24 octobre 2026

## Défauts reproduits

Vingt-cinq attentes de refus échouaient avant correction sur SQLite jetable : choix d’offre, préparation, plan hebdomadaire, référence PDF et déclaration d’exécution acceptaient encore la capture v2 après un conflit ou pull v3 (deux choix par cas), et le maintien local acceptait une absence distante non vérifiée. Les services fermaient ensuite tout le groupe ; le fallback pouvait réinitialiser la version. Les versions de plan de ces preuves sont construites par le moteur partagé, avec leurs opérations/offres cohérentes. Une première tentative de fixture de plan incorrecte est conservée séparément et n’est pas comptée comme preuve.

## Comparaison commune et politiques distinctes

Les cinq writers canoniques gardent leurs transactions, formats, révisions et règles métier. Ils partagent désormais la revue complète utilisée par les écrans manuels et le chat : version locale actuelle, groupe OPEN, dernière version distante complète vérifiée, commandes actives et dépendances métier. L’empreinte est contrôlée de nouveau dans la transaction, avec le contexte actif et l’annulation. Un ancien aperçu serveur ne peut pas autoriser une nouvelle base distante.

Absence non vérifiée, payload/enveloppe incohérent, contradiction au même numéro, réaffectation de source/identité, origine différente, envoi actif ou limite dépassée ne permettent aucune résolution. Tous les conflits examinés sont résolus atomiquement ; au plus une commande stable utilise la précondition distante exacte. Les snapshots, commandes et versions précédentes restent conservés, ainsi qu’une base distante seulement reçue par pull avant son remplacement ultérieur par ACK. Aucun faux ACK ni création par défaut.

- **Offre** : les sources, le produit/unité et les doublons sont recontrôlés. Retenir une offre retirée requiert un consentement séparé, en manuel comme dans le chat.
- **Préparation** : elle reste un brouillon, avec ses offres et TG référencées. Une modification de source invalide l’ancien consentement ; elle peut toutefois rester un brouillon pour retravail lorsque sa propre politique l’autorise. Elle n’est jamais transformée en plan final par cette résolution.
- **Plan** : les offres/opérations sont reconstruites par le moteur partagé avec les validations, références PDF, unités et implantation qualifiées. Ce processus ne déclare aucune réalisation physique. Révisions et matérialisations restent dans la même transaction et sont annulées en cas d’échec.
- **Référence PDF** : le document choisi est conservé par identité, même lorsque les versions distantes sont présentées dans l’ordre inverse. Les deux originaux restent consultables et ne sont pas réécrits.
- **Exécution** : la déclaration reste attachée à la révision/checksum exacts de son plan, y compris une archive vérifiable. Retenir une déclaration conserve son état et sa date de réalisation ; cela ne constate pas une nouvelle réalisation ni un rattachement à un nouveau plan.

Les politiques de comparaison auparavant dans le contrôleur du chat sont déplacées dans le domaine commercial natif, sans nouvelle règle modèle. Deux lecteurs existants sont extraits et réutilisés pour éviter les dépendances circulaires avec les writers ; leurs exports antérieurs restent disponibles. Les produits associés sont lus uniquement dans le magasin concerné. Les contrôles complets bornés des dépendances ne deviennent pas des chargements périodiques de navigation.

## Pages natives

Les cinq pages réutilisent la durée de vie React existante et une présentation commune à la famille commerciale. Elles montrent les deux versions, les sources disponibles, les refus, le groupe et une relecture explicite. Aucun choix ni consentement n’est précoché. Réexaminer une offre retirée exige une confirmation distincte ; relecture/erreur/changement de contexte invalide le consentement.

Compte, magasin, cible, rôle, appareil, base locale et focus/démontage bornent les callbacks et transactions tardifs. Une erreur de synchronisation après commit local ne transforme pas l’enregistrement en échec. Aucun polling, permission nouvelle, writer universel ou nouveau prompt/tool modèle.

## Vérifications

- **276 tests ciblés** passent sur neuf suites avec les vrais services et SQLite : groupes et pulls plus récents, deux décisions, refus d’absence inconnue, cent conflits sans commandes multiples/orphelines, dépendances modifiées, consentements, rollback/annulation et reprise hors ligne/redémarrage.
- La suite commune monte **dix pages dans 122 cas**, avec ports natifs simulés et vrai writer SQLite. Les anciens cas Réglages/Événements/Besoins restent présents ; les cinq pages commerciales ajoutent double appui, erreur/relecture, changements tardifs de contexte/rôle, ancien callback et synchronisation échouant après commit. Ces preuves ne constituent pas une recette physique.
- Dix scénarios de groupe sont ajoutés à l’intégration Mongo transactionnelle existante : cinq domaines × deux choix, vrai conflit serveur → carte privée → SQLite → envoi canonique → seconde SQLite. Exécution dépendante de l’environnement Mongo de CI ; aucun fournisseur IA réel ni écriture métier de production.
- La suite locale complète passe **3 747 tests / 662 ignorés selon l’environnement**, avec lint/structure et dix projets strictement typés. Format/diff et contrôles push/PR du commit final, build API et exports natifs restent requis avant fusion. Les résultats finaux sont consignés dans la PR.

## Livraison et périmètre restant

La PR 348 est fusionnée après ses deux CI exactes vertes : **4 239 tests passés / 6 ignorés**, build API et exports iOS/Android. PR 345–348 et ce complément restent hors build 14 et attendent une prochaine livraison native groupée. API compatible inchangée ; aucun déploiement ni build EAS payant pour ce lot.

Ce travail ferme les comparaisons des cinq domaines identifiés ; il ne prouve pas une parité CRUD globale ni la clôture V1. Les absences/réaffectations et reprises non vérifiables ne deviennent jamais des réparations automatiques. Les sept chantiers restent : 1 Actions/conflits en cours ; 2 Contre-promotion code prêt ; 3 Documents, 4 Expertise, 5 Recommandations, 6 Implantation et 7 UX/validation en cours. Recettes réelles, canaux, mesures/illustrations approuvées et portes V1/M8 restent ouvertes.
