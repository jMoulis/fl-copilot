# M7 — suivi des sept chantiers V1

Mis à jour le 19 octobre 2026. Ce suivi reprend les sept chantiers convenus avec Julien. Leur périmètre reste stable ; les améliorations hors critère de sortie vont dans la roadmap suivante. Chaque PR doit préciser le chantier concerné, le résultat concret, le reste à faire et l’état de livraison. Le nombre de PR et les pourcentages ne sont pas des preuves d’avancement.

**Vocabulaire :** « à démarrer », « en cours », « code prêt », « livré », « validé ». Un code fusionné et testé reste « code prêt » tant qu’il n’est pas livré. La validation utilisateur sur iPhone est distincte des tests automatisés. Un chantier entier ne devient « code prêt » que lorsque son critère de sortie est couvert.

| Chantier                             | État du chantier | Acquis et lot courant                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Reste et critère de sortie                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Actions métier et conflits        | En cours         | Produits/identités, besoins/associations, observations et parcours commerciaux reliés au chat. Publication/correction de tickets : code prêt (PR 231–232). Choix d’un produit du catalogue hors suggestions de casse : code prêt. Import Mercalys traité dans le chat (PR 233). Choix d’un produit hors suggestions : code prêt (PR 235). Publication progressive Mercalys : code prêt (PR 237). Reprise des tickets : code prêt (PR 238). Conflits de signalement/réglages : code prêt (PR 239). Conflits des besoins/associations : code prêt (PR 240). Conflits d’offres/brouillons/plans : code prêt (PR 241). Conflits PDF/exécution : code prêt (PR 242). **Conflits de fiches produit, codes et alias dans le chat et Synchronisation (PR 243)**. Contrôles d’identité/collision, historique commun, réactivation distincte et protection des modifications locales à l’arrivée d’une version récente ; code prêt après contrôles, livraison groupée en attente.                                                                                                                                                                                                                                                                                                           | Compléter les décisions d’identité contradictoire, les corrections de lignes non prises en charge, les reprises hors périmètre (original non envoyé/non restauré, doublon distant seul, ticket volumineux) et les conflits hors périmètre sûr (suppression, cible distante absente ou réaffectation vers une autre fiche). Les anomalies de lecture et les conflits de chevauchement restent à traiter explicitement ; aucune publication automatique d’un fichier corrigé qui recouvre l’existant. Sortie : chaque action manuelle V1 de l’inventaire dispose d’un outil et d’un parcours testé, ou d’une exception expressément acceptée. |
| 2. Simulations de contre-promo       | Code prêt        | Calculateur partagé de seuil de volume et formulaire conversationnel d’hypothèses déclarées, avec correction ciblée des informations bloquantes (PR 228–229).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Livrer l’API groupée puis valider le dialogue réel. Sortie : simulation exploitable avec coût connu, unités compatibles et distinction explicite entre seuil calculé et prévision de ventes.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 3. Arrivée des documents             | En cours         | Import natif multiple/ZIP, originaux et annotation des publications existants. **Sélection directe XLSX/ZIP depuis le chat, publication progressive et questions dans la conversation : code prêt**. Bilan privé avec périodes/références pour les échanges suivants ; les chiffres distants restent vérifiés avec les outils. **Lots de photos indépendantes, ticket long en 2 à 5 vues ordonnées et prise de photo native depuis le chat : code prêt.** Aperçu, conservation des originaux, extraction commune et blocage des recouvrements incertains, sans publication automatique.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Réception Resend autorisée et restauration des originaux/manifests sur un autre appareil restent à couvrir. Sortie : fichiers → originaux conservés → traitement → données/revue ciblée → restitution au chat, y compris après reconnexion, sans doublon.                                                                                                                                                                                                                                                                                                                                                                                   |
| 4. Expertise métier structurée       | En cours         | Référentiel versionné de sept thèmes fruits/légumes, shopper et merchandising, consultable à la demande par le chat, avec sources primaires, hypothèses applicatives distinctes, périmètre et échéance de revue. Code prêt pour ce premier référentiel. Le contexte magasin et les instructions commerciales restent distincts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Élargir et évaluer le référentiel sur les situations métier du pilote, vérifier la pertinence des questions et tenir les sources à jour. Sortie : conseils contextualisés évalués, distinguant faits, hypothèses et recommandations, sans transformer une simple corrélation en causalité.                                                                                                                                                                                                                                                                                                                                                  |
| 5. Suivi des recommandations         | En cours         | Fondations de propositions/décisions, plans et déclarations d’exécution disponibles. **Bilan descriptif d’une tâche et décisions sur les conseils du chat : code prêt**. Le bilan peut consulter un choix privé exact à côté de la tâche sélectionnée. **Associations privées décision/déclaration : code prêt**, après comparaison et confirmation natives, conservées hors connexion et synchronisées ; retrait avec historique, sans modifier les deux données d’origine. La simple sélection de contexte par le modèle reste sans association implicite. Accepter/modifier/reporter/refuser, historique privé, conservation hors connexion, synchronisation et comparaison des choix contradictoires ; aucune exécution implicite. **PR 256 : détails réels déclarés (dates, prix/unité, emplacement) des tâches commerciales et lecture dans le bilan ; code prêt.** **PR 257 : déclaration privée de réalisation depuis un conseil, hors plan commercial, sans choix préalable obligatoire ; retrait/historique prêts dans le code.** **PR 258 : bilan avant/pendant/après de ces réalisations hors plan ; code prêt après contrôles.** **PR 259 : empreintes des lectures des nouvelles réponses, revérification ciblée et « À recalculer » si une source suivie change.** | Fermer la boucle recommandation → décision → exécution explicite → bilan qualifié, avec contexte daté et historique. Sortie : une recommandation réelle suivie de bout en bout, avec données manquantes et facteurs concurrents expliqués.                                                                                                                                                                                                                                                                                                                                                                                                  |
| 6. Implantation                      | À démarrer       | Périmètre et contraintes attendues documentés.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Mesures et contraintes déclarées → schéma vérifié → illustration liée à ce même scénario. Sortie : cas pilote réalisable, obstacles/passages/capacités contrôlés et impossibilités signalées. L’image ne garantit pas les mesures.                                                                                                                                                                                                                                                                                                                                                                                                          |
| 7. Finition UX et validation globale | En cours         | Chat natif, streaming, étapes d’outils, sources, formulaires, multi-conversations, mémoire/compactage et suppression déjà travaillés. **PR 260 : découverte native d’outils. PR 261 : erreurs de génération/validation observables et réponse de secours sans chiffres hors sujet ; recette serveur encore ouverte.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Livraison cohérente et validation des parcours complets, dont hors connexion/redémarrage/reconnexion. Sortie : scénario V1 complet accepté par Julien, sans régression critique ni nouvelle étape technique imposée dans le parcours métier.                                                                                                                                                                                                                                                                                                                                                                                                |

## Livraison observée à cette mise à jour

- Production API : dernière livraison enregistrée issue de la PR 210, SHA `efc49a468b3e6441c50486db8c8fb17e228e389d`. Relire le journal et l’état réel de production avant tout déploiement ; ce suivi ne déclenche aucune livraison.
- Dernier binaire iOS livré : build EAS `ff8a26ba-49ce-4733-bead-0f4a9b69235a`, basé sur la PR 221. Le correctif de synchronisation a été confirmé par Julien.
- Les lots suivants restent en attente de livraison groupée ; les nouvelles cartes natives exigent un futur binaire compatible. Les anciennes versions ne reçoivent pas les nouveaux outils de décision d’identité et de correction/publication de tickets, protégés par des capacités distinctes.
- Aucun build EAS payant ni déploiement Vercel automatique par PR. Une fusion n’est jamais annoncée comme une mise à disposition sur le téléphone.

## Ordre de poursuite

Les sept chantiers ne sont pas des étapes strictement séquentielles. Le chantier actif et l’écart fermé sont précisés dans chaque lot ; le chantier 5 est actif sur les derniers lots. Les manques du chantier 1 restent ouverts dans l’inventaire. Préparer une livraison/acceptation groupée adaptée lorsque le périmètre livré est cohérent. Ne pas multiplier les PR de simples couches internes présentées comme des fonctionnalités utilisables. Les sept critères de sortie restent la référence commune jusqu’à clôture M7 ; M8 conserve ses exigences de mise en production.

## Lot courant — reprises d’envoi et refus compréhensibles (18 octobre 2026)

- **1. Actions métier et conflits : en cours.** Les refus de commandes sont consultables et orientent vers l’espace métier à examiner. Une commande durablement refusée n’est pas renvoyée aveuglément. La correction générique des commandes refusées, les cibles distantes absentes/supprimées et les autres reprises restent ouvertes.
- **2. Simulations de contre-promo : code prêt**, livraison/acceptation groupées inchangées.
- **3. Arrivée des documents : en cours.** Reprise des tâches d’envoi Mercalys/PDF existantes, depuis Synchronisation et la feuille de fichiers du chat ; le bouton PDF manuel partage les contrôles. Pas de nouvelle publication ni de relance d’analyse déjà reçue. Restauration des originaux, reprises distantes et autres canaux restent à traiter.
- **4. Expertise métier structurée : à démarrer.**
- **5. Suivi des recommandations : en cours.**
- **6. Implantation : à démarrer.**
- **7. Finition UX et validation globale : en cours.** Explications et actions distinctes pour envois interrompus/refus métier, pagination, actualisation, erreurs sûres et protection des données privées. Validation du futur binaire toujours à faire.

Ce lot reste du code prêt, non livré. Aucun déploiement API ni build EAS payant n’est lancé ; le plan de livraison groupée et son ordre API/native restent inchangés.

## Lot courant — retrouver un original manquant (18 octobre 2026)

1. **Actions métier et conflits : en cours.** La restauration refuse les publications en conflit/échec et conserve les commandes existantes ; la correction générique des refus reste ouverte.
2. **Contre-promo : code prêt**, livraison et acceptation groupées à faire.
3. **Documents : en cours.** Resélection d’un original Mercalys/PDF manquant, vérifié par empreinte et taille, sans refaire l’import. Les références du chat/ZIP et les lignes publiées sont conservées. Manifestes perdus, photos de casse, originaux uniquement distants et reprises d’analyse restent à traiter.
4. **Expertise métier structurée : à démarrer.**
5. **Suivi des recommandations : en cours.**
6. **Implantation : à démarrer.**
7. **UX et validation globale : en cours.** Action « Retrouver l’original » et messages explicites ; tests automatisés passés, validation sur le futur binaire encore à faire.

Code prêt ne signifie ni livré ni validé sur iPhone. Aucun build EAS payant ni déploiement Vercel n’est lancé ; la livraison groupée conserve son ordre API/native existant.

## Lot courant — suivre et reprendre une analyse PDF (18 octobre 2026)

1. **Actions métier et conflits : en cours.** Une demande explicite de reprise est persistée et rejouable ; les résultats reçus, refus définitifs et budgets ne sont pas remis à zéro. Les autres corrections/conflits hors périmètre restent ouverts.
2. **Contre-promo : code prêt**, livraison et acceptation groupées à faire.
3. **Documents : en cours.** Suivi des étapes et reprise des analyses PDF commerciales confirmées depuis le chat et Ma semaine, avec cache hors connexion et envoi durable. Originaux photos, originaux uniquement distants, manifestes perdus et réception/lots des autres canaux restent à couvrir.
4. **Expertise métier structurée : à démarrer.**
5. **Suivi des recommandations : en cours.**
6. **Implantation : à démarrer.**
7. **UX et validation globale : en cours.** Distinguer demande enregistrée, demande transmise, résultats partiels et analyse reçue ; actualisation à la demande pour limiter les appels. Validation du futur binaire encore à faire.

Ce lot est du code prêt pour livraison groupée, pas une fonctionnalité déjà livrée sur iPhone. Il requiert l’API compatible avant le binaire natif. Aucun déploiement automatique, appel IA payant ou build EAS n’est lancé.

## Lot courant — lots de photos de casse depuis le chat (18 octobre 2026)

1. **Actions métier et conflits : en cours.** Capture reliée au même brouillon/contrôles de casse ; aucun chiffre publié avant décision. Les autres corrections et conflits hors périmètre restent ouverts.
2. **Contre-promo : code prêt**, livraison et acceptation groupées à faire.
3. **Documents : en cours.** Sélection de plusieurs photos depuis le chat, une photo par ticket, avec copies durables, détection des doublons et suivi par pièce jointe. Regroupement de vues d’un ticket long, caméra dans le chat, originaux distants/manifests et réception Resend restent à couvrir.
4. **Expertise métier structurée : à démarrer.**
5. **Suivi des recommandations : en cours.**
6. **Implantation : à démarrer.**
7. **UX et validation globale : en cours.** Import depuis le menu existant, conservation du texte/PDF et des succès partiels, états explicites ; validation sur le futur binaire encore à faire.

Code prêt ne signifie ni livré ni validé sur iPhone. Ce lot suit la livraison groupée API/native déjà requise, sans déploiement automatique ni build payant.

## Lot courant — un ticket long en plusieurs photos (18 octobre 2026)

- **1 — Actions métier et conflits : en cours.** Le groupe suit le parcours canonique de casse. Les refus d’analyse nécessitant une revue arrêtent le travail local, préservent les photos et ne proposent pas un reset des tentatives. Les autres écarts du chantier restent ouverts.
- **2 — Contre-promo : code prêt.** Livraison et validation du dialogue réel restent en attente.
- **3 — Documents : en cours.** « Un ticket en plusieurs photos » permet un aperçu, l’ordre haut → bas et la suppression de vues avant confirmation. Une seule source, un seul ticket et une seule pièce jointe, 2 à 5 originaux. Envoi canonique et extraction groupée avec provenance par vue ; code prêt après contrôles. Resend vérifié, caméra et récupération sur un autre appareil restent ouverts.
- **4 — Expertise structurée : à démarrer.** Aucun élargissement dans ce lot.
- **5 — Suivi des recommandations : en cours.** Aucun élargissement dans ce lot.
- **6 — Implantation : à démarrer.** Aucun élargissement dans ce lot.
- **7 — UX et validation : en cours.** Photos ordonnées dans la fiche et explications des blocages ; tests automatisés hors connexion, redémarrage et reprise. La qualité de lecture sur de vraies vues et le parcours natif restent à accepter sur iPhone.

Livraison : API compatible avant le futur binaire groupé. Ni déploiement de production, ni build EAS, ni analyse payante réelle dans ce lot. Les contrôles sont consignés dans M7_COPILOT.md ; une fusion ne rend pas ce parcours disponible sur le téléphone.

## Lot courant — photographier un ticket depuis le chat (18 octobre 2026)

1. **Actions métier et conflits : en cours.** La confirmation caméra rejoint les reçus canoniques existants ; extraction et publication restent distinctes. Les corrections et conflits hors périmètre restent ouverts.
2. **Contre-promo : code prêt**, livraison et acceptation groupées à faire.
3. **Documents : en cours.** Prise native d’une photo ou de 2 à 5 vues du même ticket, aperçu, reprise, ordre et suppression avant « Joindre ce ticket ». Une confirmation conserve un seul ticket et une seule pièce jointe avec les originaux. Réception Resend vérifiée et récupération des originaux/manifests sur un autre appareil restent ouvertes.
4. **Expertise métier structurée : à démarrer.**
5. **Suivi des recommandations : en cours.**
6. **Implantation : à démarrer.**
7. **UX et validation globale : en cours.** Permissions, cadrage, flash, interruptions et conservation des vues après un échec d’enregistrement sont pris en charge. La session de cadrage avant confirmation reste temporaire ; seul le ticket confirmé est conservé durablement.

Validation : 25 nouveaux tests, 1 671 tests locaux réussis et 411 tests dépendants d’un environnement ignorés localement. Code prêt après contrôles, livraison groupée et validation iPhone à faire. L’API de traitement multi-vues de la PR 248 doit précéder le futur binaire compatible. Aucun appel de modèle payant, build EAS ou déploiement Vercel n’est lancé.

## Lot courant — associer un produit du catalogue à une ligne de casse (18 octobre 2026)

1. **Actions métier et conflits : en cours.** Le copilote peut préparer le choix explicite d’un produit existant du magasin, même hors suggestions d’extraction. La carte compare la ligne et affiche la fiche cible avec ses codes avant confirmation. Les anciens messages restent limités à leurs candidats ; les fiches retirées, étrangères ou en conflit sont refusées. Création d’un produit, apprentissage d’alias et publication restent des actions distinctes. Les autres corrections/conflits hors périmètre restent ouverts.
2. **Contre-promo : code prêt**, livraison et acceptation groupées à faire.
3. **Documents : en cours.** Les originaux, candidats et montants d’extraction ne sont pas réécrits par un choix d’identité. Réception Resend vérifiée et récupération distante des originaux/manifests restent ouvertes.
4. **Expertise métier structurée : à démarrer.**
5. **Suivi des recommandations : en cours.**
6. **Implantation : à démarrer.**
7. **UX et validation globale : en cours.** Codes conservant leurs zéros, nature/unité affichées et refus d’une confirmation devenue périmée. Une fiche incomplète n’impose pas de nettoyage du catalogue dans ce parcours.

Code prêt après contrôles, livraison groupée API puis binaire compatible et validation iPhone à faire. Aucun déploiement Vercel, appel de modèle payant ou build EAS dans ce lot.

## Lot courant — repères métier consultables par le copilote (18 octobre 2026)

1. **Actions métier et conflits : en cours.** Aucun nouveau droit d’écriture ; les actions restent dans leurs parcours de confirmation existants.
2. **Contre-promo : code prêt**, livraison et acceptation groupées à faire.
3. **Documents : en cours.** Réception Resend vérifiée et récupération distante des originaux/manifests restent ouvertes.
4. **Expertise métier structurée : en cours.** Premier référentiel daté et versionné : critères de choix, besoins d’achat, associations, substitutions, visibilité, saisonnalité et diagnostic de casse. L’outil consulte au plus deux thèmes, sépare enseignements publiés et hypothèses applicatives et conserve les liens primaires. Une édition périmée ne fournit plus de cartes utilisables. Ce lot démarre le chantier ; l’évaluation de vrais dialogues métier et l’élargissement du corpus restent à faire.
5. **Suivi des recommandations : en cours.** Une piste métier ne devient ni une décision ni une preuve d’exécution ou d’effet.
6. **Implantation : à démarrer.** Les repères de visibilité ne garantissent ni dimensions ni faisabilité d’une TG.
7. **UX et validation globale : en cours.** Sources progressives dans le chat, dates françaises, distinction référentiel/recherche web, conservation des références dans l’historique privé. Validation sur le futur binaire à faire.

Code prêt pour ce lot, livraison groupée API puis app compatible et acceptation iPhone en attente. Aucun build EAS, déploiement de production, appel de modèle ou recherche web payante de l’application n’est lancé ; les sources ont été consultées lors de la préparation du référentiel.

## Lot courant — bilan d’une mise en place depuis le chat (18 octobre 2026)

1. **Actions métier et conflits : en cours.** Ce bilan est une lecture, sans décision ni mutation ; les corrections/conflits hors périmètre restent ouverts.
2. **Contre-promo : code prêt**, livraison et acceptation groupées à faire.
3. **Documents : en cours.** Réception Resend vérifiée et restauration distante des originaux/manifests restent ouvertes.
4. **Expertise métier structurée : en cours.** Premier référentiel prêt ; élargissement et évaluation de vrais dialogues à poursuivre.
5. **Suivi des recommandations : en cours.** Un outil du chat relie une tâche courante d’affichage/TG et ses déclarations au bilan d’un produit effectivement associé dans le plan. Périodes explicites avant/pendant/après facultatif, calculs partagés, couverture, signalements et liens de source. Sans déclaration, réalisation inconnue ; DONE reste une déclaration. Une variation ne devient pas un effet causal, un gain incrémental ou un ROI. Le lien durable à la recommandation/décision initiale et le parcours complet d’acceptation restent à fermer ; ce lot ne clôture pas le chantier.
6. **Implantation : à démarrer.**
7. **UX et validation globale : en cours.** Progression « comparaison » et restitution naturelle/tableau avec sources dans le chat existant. Dialogue réel et parcours sur iPhone restent à valider.

Code prêt après contrôles, livraison API groupée et acceptation à faire. La lecture utilise les citations déjà comprises par l’app ; elle ne nécessite aucun nouveau module natif. Ni déploiement de production, ni build EAS payant, ni appel de modèle réel dans ce lot.

## Lot courant — conserver les décisions sur les conseils du chat (18 octobre 2026)

1. **Actions métier et conflits : en cours.** Un nouveau choix privé suit SQLite/Outbox et la comparaison explicite des versions concurrentes, dans le chat et Synchronisation. Les autres écarts de l’inventaire restent ouverts.
2. **Contre-promo : code prêt**, livraison et acceptation groupées à faire.
3. **Documents : en cours.** Réception Resend vérifiée et restauration distante des originaux/manifests restent ouvertes.
4. **Expertise métier structurée : en cours.** Premier référentiel prêt ; évaluation métier et élargissement à poursuivre.
5. **Suivi des recommandations : en cours.** Une carte conserve un extrait exact d’un conseil antérieur du chat et les décisions Accepter/Modifier/Reporter/Refuser. Les cartes répétées pour le même conseil partagent une identité et un historique. Le copilote peut consulter les choix synchronisés et préparer leur révision. Il s’agit de pistes conversationnelles dont le contexte n’est pas revalidé, pas de recommandations opérationnelles nouvellement déclarées éligibles. Le lien à une exécution réelle, l’invalidation des faits métier changés et le parcours complet avec bilan restent ouverts.
6. **Implantation : à démarrer.**
7. **UX et validation globale : en cours.** Choix simples, calendrier français, formulaire adapté au choix, historique progressif et comparaison sans sélection implicite. Recette du futur binaire et dialogue réel à faire.

Code prêt après contrôles, livraison API puis binaire groupé compatible nécessaire. La fusion ne livre rien sur le téléphone. Aucun appel de modèle réel, déploiement Vercel ou build EAS payant dans ce lot.

## Lot courant — revoir un choix à côté d’une tâche déclarée (18 octobre 2026)

1. **Actions métier et conflits : en cours.** Aucun statut métier n’est modifié par ce bilan ; les conflits et reprises hors périmètre restent ouverts.
2. **Contre-promo : code prêt.** Livraison et acceptation groupées inchangées.
3. **Documents : en cours.** Aucun élargissement dans ce lot ; réception Resend et récupération des originaux hors appareil restent ouvertes.
4. **Expertise métier structurée : en cours.** Les connaissances et leurs sources existantes sont conservées.
5. **Suivi des recommandations : en cours.** Un bilan ciblé peut rappeler le dernier choix synchronisé exact (identifiant/version), son action modifiée et son origine privée, puis présenter séparément déclaration et chiffres déterministes avant/pendant/après. Un choix absent/étranger, changé ou d’origine invérifiable n’est pas utilisé. Une conversation archivée reste une source historique explicitement qualifiée. Le rapprochement n’enregistre pas de lien durable et ne valide aucune équivalence sémantique ; le parcours d’exécution lié et l’invalidation métier restent à terminer.
6. **Implantation : à démarrer.** Aucun élargissement dans ce lot.
7. **UX et validation globale : en cours.** Réponse naturelle/tableau et liens sources existants ; contrôle de confidentialité, relecture du choix et refus des lectures incohérentes. Dialogue réel et parcours iPhone restent à accepter après livraison groupée.

Code prêt seulement après contrôles et CI ; aucun déploiement, build EAS ou appel de modèle payant. L’API compatible et le binaire des cartes de décision restent à livrer dans le groupe prévu. La lecture du bilan seul est rétrocompatible, sans nouvelle carte, migration ou donnée partagée.

## Lot courant — conserver une association décision/déclaration (18 octobre 2026)

1. **Actions métier et conflits : en cours.** L’association et son retrait ont leur Outbox atomique. Rejouer une carte est idempotent ; des instantanés forgés sont refusés, les données locales restent conservées. Les autres reprises/conflits du chantier restent ouverts.
2. **Contre-promo : code prêt.** Livraison et acceptation groupées inchangées.
3. **Documents : en cours.** Aucun élargissement dans ce lot ; réception Resend et récupération des originaux hors appareil restent ouvertes.
4. **Expertise structurée : en cours.** Périmètre inchangé.
5. **Suivi des recommandations : en cours.** Un aperçu compare un choix exact et une déclaration commerciale déjà enregistrée. L’utilisateur confirme leur correspondance ; un lien privé indépendant conserve les versions et dates, se restaure sur un autre appareil et se retire depuis sa carte d’origine sans effacer l’historique. Le copilote peut retrouver ces liens et les rapprocher d’un bilan descriptif. Une acceptation n’exécute toujours rien. Exécutions générales avec prix/emplacement effectifs, invalidation métier et parcours pilote complet restent à terminer.
6. **Implantation : à démarrer.** Aucun élargissement dans ce lot.
7. **UX et validation globale : en cours.** Carte de comparaison, confirmation sans présélection, retrait, états locaux/synchronisés et protections de session. Validation réelle du dialogue et du futur binaire à faire.

Code prêt après contrôles/CI, livraison groupée encore attendue. L’API compatible (migration Mongo 40) doit précéder le binaire (SQLite 47 et capacité `x-copilot-execution-links: 1`). Aucun déploiement, build EAS ou appel IA payant n’est lancé.

## Lot courant — renseigner la réalisation commerciale (PR 256)

1. **Actions métier et conflits : en cours.** Détails réels des tâches commerciales via la déclaration existante ; statut, note et détails partagent les versions/conflits et la transaction locale/Outbox. Les autres manques restent inchangés.
2. **Contre-promo : code prêt.** Livraison et validation groupées en attente.
3. **Documents : en cours.** Aucun élargissement de ce lot.
4. **Expertise structurée : en cours.** Aucun élargissement de ce lot.
5. **Suivi des recommandations : en cours.** Dates réelles, prix/unité et emplacement déclarés des tâches affichage/TG : code prêt après contrôles. Le chat prépare, l’utilisateur confirme ; aucune valeur prévue n’est copiée. Le bilan cite les détails et signale un décalage de fenêtre sans recalcul causal. Les associations privées existantes restent figées. Exécutions génériques hors tâches commerciales, invalidation des faits/éligibilité, retraits depuis un nouveau sujet ou une carte archivée et acceptation pilote restent ouverts.
6. **Implantation : à démarrer.**
7. **UX et validation : en cours.** Confirmation lisible, calendrier français et champs facultatifs dans la fiche de tâche ; erreurs/données inconnues, conservation hors connexion et compatibilité des anciens clients contrôlées. Validation iPhone en attente du binaire groupé.

**Code prêt ≠ livré ≠ validé sur iPhone.** API compatible avant le binaire groupé ; aucun déploiement Vercel, build EAS payant ou appel modèle réel. Le suivi de livraison précédent reste inchangé. QA : `docs/qa/M7_EXECUTION_ACTUALS_SCENARIOS.md`.

## Lot courant — déclarer une réalisation hors plan commercial (PR 257)

1. **Actions métier et conflits : en cours.** Nouvelle déclaration privée séparée du conseil ; synchronisation, refus et retrait à sens unique testés. Les autres manques métier restent inchangés.
2. **Contre-promo : code prêt.** Livraison et validation groupées à faire.
3. **Documents : en cours.** Aucun élargissement dans ce lot.
4. **Expertise structurée : en cours.** Aucun élargissement dans ce lot.
5. **Suivi des recommandations : en cours.** Réalisation d’un conseil du chat hors tâches d’affichage/TG, sans Accept obligatoire, avec données réelles inconnues conservées nulles, confirmation explicite, historique privé et retrait : code prêt après contrôles. L’identité rejoint le même conseil suivi, sans créer ni modifier de choix. Actions sans conseil source, corrections/retraits depuis un autre sujet ou une carte archivée, production formellement éligible/invalidation des faits et acceptation pilote restent ouverts.
6. **Implantation : à démarrer.**
7. **UX et validation : en cours.** Carte de réalisation avec confirmation initialement décochée, états locaux et retrait conservant l’historique. Parcours complet entre deux SQLite et MongoDB testé ; dialogue réel/iPhone encore à accepter.

**Code prêt ≠ livré ≠ validé sur iPhone.** API compatible (Mongo 41) avant binaire (SQLite 48, capacité dédiée). Aucun déploiement Vercel, appel modèle réel ou build EAS payant. Livraison groupée précédente inchangée. QA : `docs/qa/M7_ACTION_EXECUTION_SCENARIOS.md`.

## Lot courant — bilan d’une réalisation hors plan (PR 258)

**Chantier actif : 5 — suivi des recommandations.** Ce lot ferme l’écart « réalisation déclarée hors tâche commerciale → bilan observé ». L’outil relit une déclaration privée exacte, son état/version, un produit et des périodes explicites. Il réutilise les comparaisons déterministes avant/pendant/après et les signalements, sans exiger une acceptation ou un plan. Retrait ou changement de déclaration bloque le bilan ; une modification pendant la lecture invalide le résultat. Le produit sélectionné est un contexte de lecture, pas une association validée ou enregistrée.

**Reste avant la fin du chantier 5 :** invalidation des recommandations opérationnelles lorsque leurs faits changent, puis livraison cohérente et parcours pilote complet accepté. Les améliorations de correction/retrait depuis d’autres conversations restent visibles dans la roadmap ; ce lot ne les transforme pas en nouveaux critères de sortie.

1. **Actions métier et conflits : en cours.** Périmètre inchangé ; ce bilan est en lecture seule.
2. **Contre-promo : code prêt.** Livraison et acceptation groupées en attente.
3. **Documents : en cours.** Réception Resend et récupération des originaux hors appareil restent ouvertes.
4. **Expertise structurée : en cours.** Évaluation métier et corpus à poursuivre.
5. **Suivi des recommandations : en cours.** Bilan hors plan couvert dans le code ; invalidation métier et acceptation pilote restent ouvertes.
6. **Implantation : à démarrer.**
7. **UX et validation globale : en cours.** Tableau naturel, sources et progression « comparaison » existants ; validation réelle après livraison.

**Livraison :** code prêt après contrôles et CI ; ni API déployée, ni binaire livré, ni acceptation iPhone pour ce lot. Réutilise les déclarations de la PR 257 et sa capacité ; aucune migration ni dépendance native supplémentaire. Livraison API groupée prévue, sans build EAS ni appel de modèle payant.

## Lot courant — revérifier les lectures d’un conseil (PR 259, 19 octobre 2026)

**Chantier actif : 5 — suivi des recommandations.** Ce lot couvre l’écart « une source métier suivie a changé → À recalculer » pour les nouvelles réponses. Les empreintes de lectures serveur acceptées sont conservées atomiquement avec la réponse, dans une collection privée. Les lecteurs existants peuvent être rejoués : derniers chiffres du rayon, journée/J-7, périodes, évolutions produit, catalogue, signalements et plan/déclarations. Le résultat distingue lectures inchangées, sources modifiées, vérification incomplète et source masquée/indisponible. Les paramètres des lectures permettent au copilote de rafraîchir les bonnes données sans les redemander inutilement.

Un nouveau suivi d’un conseil aux lectures modifiées ne prépare aucune carte : il faut reprendre le conseil avec les données actuelles. Un suivi ancien ou hors connexion conserve son intention et son historique ; aucune exécution n’est déduite. Les anciens messages sans empreinte et les documents/autres outils/contexte non couverts ne sont jamais déclarés encore valides par défaut. Les empreintes portent conservativement sur les lectures de la réponse entière, pas sur la pertinence exacte de chaque phrase.

**Reste avant clôture du chantier 5 :** couvrir les autres dépendances des recommandations opérationnelles et leurs états de validité, puis livraison cohérente et scénario pilote complet accepté. Une comparaison inchangée des lectures couvertes n’est pas une autorisation métier ni une éligibilité opérationnelle. Aucun nouveau critère de sortie ajouté.

1. **Actions métier et conflits : en cours.** Intentions historiques conservées ; le reste de l’inventaire demeure ouvert.
2. **Contre-promo : code prêt.** Livraison/acceptation groupées en attente.
3. **Documents : en cours.** Réception Resend et restauration des originaux hors appareil restent ouvertes.
4. **Expertise structurée : en cours.** Évaluation et corpus à poursuivre.
5. **Suivi des recommandations : en cours.** Invalidation ciblée des lectures couvertes prête dans le code après contrôles ; couverture opérationnelle complète et pilote restent ouverts.
6. **Implantation : à démarrer.**
7. **UX et validation globale : en cours.** Message naturel, étapes et sources existants, sans nouvel écran ; dialogue et validation iPhone après livraison groupée.

**Livraison :** migration Mongo 42 pour les métadonnées privées de provenance. Aucune migration SQLite, nouveau module natif, nouveau provider ou build EAS. API non déployée par cette PR, livraison groupée et acceptation iPhone en attente. Aucun appel réel de modèle ni modification d’une base métier dans les tests.

## Lot courant — consolider l’agent sans ajouter d’orchestrateur (PR 260, 19 octobre 2026)

**Chantier actif : 7 — consolidation et validation transversale.** Julien demande de simplifier l’existant et de laisser le copilote composer ses outils, sans empiler des couches ni programmer une réponse pour chaque demande. Ce lot remplace les rappels spécialisés dupliqués par un guide court, conserve les consignes métier dans les descriptions d’outils et emploie `toolSearch`/`deferLoading` du SDK déjà installé. Aucun routeur maison, sous-agent, nouvelle dépendance ou migration. Les définitions métier sont structurellement inchangées, vérifiées par comparaison AST.

Au-delà de huit outils autorisés, seuls recherche d’outils, demande d’information et historique disponible sont exposés initialement. La recherche charge au plus cinq correspondances pour l’étape suivante ; le modèle peut élargir à un autre domaine. Un outil non découvert ne s’exécute pas, même demandé simultanément à la recherche. Les petits catalogues gardent leur accès direct. Les capacités du client et les contrôles d’acteur restent canoniques ; découverte n’est ni donnée métier ni droit d’écriture. Limite de six étapes pour les grands catalogues avec une dernière étape réservée à la réponse ; budgets des lectures métier, délai global et confirmations existants conservés.

**Résultat mesuré :** les rappels spécialisés ajoutés aux instructions générales passent de 7 829 à 530 octets ; ce n’est pas une mesure du contexte total, des tokens facturés ou de la qualité du raisonnement. Le fichier de production est raccourci de 31 lignes ; le gros déplacement du catalogue dans le diff est essentiellement sa sortie de la construction de l’agent, sans modification des définitions métier. Une recherche peut ajouter un aller-retour modèle : le gain réel de qualité/latence/coût reste à évaluer en dialogue pilote. Aucun appel de modèle payant dans les tests.

1. **Actions métier et conflits : en cours.** Inventaire et contrôles existants inchangés.
2. **Contre-promo : code prêt.** Livraison/acceptation groupées restent à faire.
3. **Documents : en cours.** Import local/ZIP et traitement existants conservés ; réception/restauration restent ouvertes.
4. **Expertise structurée : en cours.** L’outil se découvre selon le besoin ; évaluation/corpus restent à poursuivre.
5. **Suivi des recommandations : en cours.** Aucune nouvelle clôture métier de ce chantier ; ses manques restent ceux consignés précédemment.
6. **Implantation : à démarrer.**
7. **UX et validation globale : en cours.** Ce lot ferme la surcharge du catalogue initial pour les grands ensembles et les doublons de consignes identifiés. Le dialogue réel et le parcours V1 complet restent à accepter après livraison.

**Livraison :** code prêt après contrôles/CI ; aucune API déployée, aucun binaire livré ou validation iPhone dans ce lot. Pas de build EAS, de nouveau modèle/provider ou de nouvelle architecture de données. Le test réel ne sera pas présenté comme acquis par les tests de transport simulé.

## PR 261 — priorité à la fiabilité du chat

Chantier actif : **7**, fiabilité ; les ajouts fonctionnels sont suspendus pour ce diagnostic. La conversation pilote consultée le 19 octobre contient trois réponses de secours à la comparaison novembre 2024/2025, avec un bilan du 16 octobre hors sujet. Une réponse ultérieure a effectivement pu consulter les deux mois : cela ne démontre pas une résolution durable. L’alias de production pointe toujours sur `dpl_8wxufurZhFMng4GU8bvEyT96WKDi` (17 octobre). Les erreurs historiques ne contiennent pas leur cause ; l’accès aux logs Vercel via le connecteur est refusé, et la lecture Sentry par CLI a été empêchée par une panne du service d’examen automatique d’autorisation.

Écart corrigé dans le code : le chat ne remplace plus une analyse en échec par le bilan quotidien par défaut. Les échecs connus produisent un diagnostic serveur borné (génération/validation, code, délai, caractère réessayable, identifiant technique), séparé du message et des données privées. Les erreurs inattendues après ouverture du flux sont signalées sans contenu brut. Aucun nouvel agent, prompt, outil métier, stockage, migration ou retry automatique payant.

Reste avant résolution de l’incident : livraison de l’API compatible, observation de la cause exacte d’un éventuel nouvel échec et validation réelle de la comparaison demandée. Aucun build iPhone n’est nécessaire pour ces seules modifications serveur ; la livraison native groupée des autres lots demeure distincte. Les tests simulés et transactionnels ne prouvent pas la réussite du vrai modèle. Ni build EAS ni appel de modèle payant dans ce lot.

Les sept chantiers restent : **1 en cours ; 2 code prêt ; 3 en cours ; 4 en cours ; 5 en cours ; 6 à démarrer ; 7 en cours**. L’incident de chat n’est pas déclaré clos.
