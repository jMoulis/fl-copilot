# M7 — suivi des sept chantiers V1

Mis à jour le 20 octobre 2026. Ce suivi reprend les sept chantiers convenus avec Julien. Leur périmètre reste stable ; les améliorations hors critère de sortie vont dans la roadmap suivante. Chaque PR doit préciser le chantier concerné, le résultat concret, le reste à faire et l’état de livraison. Le nombre de PR et les pourcentages ne sont pas des preuves d’avancement.

**Vocabulaire :** « à démarrer », « en cours », « code prêt », « livré », « validé ». Un code fusionné et testé reste « code prêt » tant qu’il n’est pas livré. La validation utilisateur sur iPhone est distincte des tests automatisés. Un chantier entier ne devient « code prêt » que lorsque son critère de sortie est couvert.

## Synthèse courante — 20 octobre 2026

**1 Actions/conflits en cours ; 2 Contre-promotion code prêt ; 3 Documents en cours ; 4 Expertise en cours ; 5 Recommandations en cours ; 6 Implantation en cours ; 7 UX/validation en cours.** La livraison groupée PR 291–301 est disponible sur API et iOS build 4, sans acceptation native encore consignée. La réception email reste non activée. PR 302–305 (Actions, inventaire physique, parité copilote et placement direct explicite) sont fusionnées et livrées sur l’API en `1e7684d` ; leur build iOS 5 est disponible, sans recette native acquise. PR 306–311 sont fusionnées et livrées côté API en `ace4c3e` : préparation, fichiers/cache et confirmation/traitement d’illustrations, ainsi que suppressions distantes connues, sans activation fournisseur ni appel réel. Aucun nouveau build natif de ce lot ; iOS 5 reste en `1e7684d`. PR 312 complète les choix après suppression locale conflictuelle et est fusionnée (`d5c3603`), sans livraison native. Le lot courant vérifie la conservation des données à travers toutes les versions du schéma SQLite (M8-T03). Les preuves des incréments ci-dessous priment sur les anciennes introductions de lots. Aucun pourcentage global ni fermeture de V1 n’est déduit des CI.

**État vérifié complémentaire :** PR 312 est fusionnée (CI push/PR finales vertes, 3 522 tests / 6 ignorés chacune) mais non livrée nativement. PR 313 est fusionnée, ses deux CI finales et la CI de `master` réussissent (3 648 / 6). Aucun changement runtime n’y a été ajouté. L’API reste `ace4c3e`, le binaire disponible iOS 5 reste `1e7684d` ; les paragraphes historiques ci-dessous sont datés et ne remplacent pas cette synthèse.

La matrice suivante conserve les critères de sortie et la base du suivi ; le journal daté précise les évolutions réellement vérifiées.

| Chantier                             | État du chantier | Acquis et lot courant                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Reste et critère de sortie                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Actions métier et conflits        | En cours         | Produits/identités, besoins/associations, observations et parcours commerciaux reliés au chat. Publication/correction de tickets : code prêt (PR 231–232). Choix d’un produit du catalogue hors suggestions de casse : code prêt. Import Mercalys traité dans le chat (PR 233). Choix d’un produit hors suggestions : code prêt (PR 235). Publication progressive Mercalys : code prêt (PR 237). Reprise des tickets : code prêt (PR 238). Conflits de signalement/réglages : code prêt (PR 239). Conflits des besoins/associations : code prêt (PR 240). Conflits d’offres/brouillons/plans : code prêt (PR 241). Conflits PDF/exécution : code prêt (PR 242). **Conflits de fiches produit, codes et alias dans le chat et Synchronisation (PR 243)**. Contrôles d’identité/collision, historique commun, réactivation distincte et protection des modifications locales à l’arrivée d’une version récente ; code prêt après contrôles, livraison groupée en attente.                                                                                                                                                                                                                                                                                                           | Compléter les décisions d’identité contradictoire, les corrections de lignes non prises en charge, les reprises hors périmètre (original non envoyé/non restauré, doublon distant seul, ticket volumineux) et les conflits hors périmètre sûr (suppression, cible distante absente ou réaffectation vers une autre fiche). Les anomalies de lecture et les conflits de chevauchement restent à traiter explicitement ; aucune publication automatique d’un fichier corrigé qui recouvre l’existant. Sortie : chaque action manuelle V1 de l’inventaire dispose d’un outil et d’un parcours testé, ou d’une exception expressément acceptée. |
| 2. Simulations de contre-promo       | Code prêt        | Calculateur partagé de seuil de volume et formulaire conversationnel d’hypothèses déclarées, avec correction ciblée des informations bloquantes (PR 228–229).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Livrer l’API groupée puis valider le dialogue réel. Sortie : simulation exploitable avec coût connu, unités compatibles et distinction explicite entre seuil calculé et prévision de ventes.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 3. Arrivée des documents             | En cours         | Import natif multiple/ZIP, originaux et annotation des publications existants. **Sélection directe XLSX/ZIP depuis le chat, publication progressive et questions dans la conversation : code prêt**. Bilan privé avec périodes/références pour les échanges suivants ; les chiffres distants restent vérifiés avec les outils. **Lots de photos indépendantes, ticket long en 2 à 5 vues ordonnées et prise de photo native depuis le chat : code prêt.** Aperçu, conservation des originaux, extraction commune et blocage des recouvrements incertains, sans publication automatique.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Réception Resend autorisée et restauration des originaux/manifests sur un autre appareil restent à couvrir. Sortie : fichiers → originaux conservés → traitement → données/revue ciblée → restitution au chat, y compris après reconnexion, sans doublon.                                                                                                                                                                                                                                                                                                                                                                                   |
| 4. Expertise métier structurée       | En cours         | Référentiel versionné de sept thèmes fruits/légumes, shopper et merchandising, consultable à la demande par le chat, avec sources primaires, hypothèses applicatives distinctes, périmètre et échéance de revue. Code prêt pour ce premier référentiel. Le contexte magasin et les instructions commerciales restent distincts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Élargir et évaluer le référentiel sur les situations métier du pilote, vérifier la pertinence des questions et tenir les sources à jour. Sortie : conseils contextualisés évalués, distinguant faits, hypothèses et recommandations, sans transformer une simple corrélation en causalité.                                                                                                                                                                                                                                                                                                                                                  |
| 5. Suivi des recommandations         | En cours         | Fondations de propositions/décisions, plans et déclarations d’exécution disponibles. **Bilan descriptif d’une tâche et décisions sur les conseils du chat : code prêt**. Le bilan peut consulter un choix privé exact à côté de la tâche sélectionnée. **Associations privées décision/déclaration : code prêt**, après comparaison et confirmation natives, conservées hors connexion et synchronisées ; retrait avec historique, sans modifier les deux données d’origine. La simple sélection de contexte par le modèle reste sans association implicite. Accepter/modifier/reporter/refuser, historique privé, conservation hors connexion, synchronisation et comparaison des choix contradictoires ; aucune exécution implicite. **PR 256 : détails réels déclarés (dates, prix/unité, emplacement) des tâches commerciales et lecture dans le bilan ; code prêt.** **PR 257 : déclaration privée de réalisation depuis un conseil, hors plan commercial, sans choix préalable obligatoire ; retrait/historique prêts dans le code.** **PR 258 : bilan avant/pendant/après de ces réalisations hors plan ; code prêt après contrôles.** **PR 259 : empreintes des lectures des nouvelles réponses, revérification ciblée et « À recalculer » si une source suivie change.** | Fermer la boucle recommandation → décision → exécution explicite → bilan qualifié, avec contexte daté et historique. Sortie : une recommandation réelle suivie de bout en bout, avec données manquantes et facteurs concurrents expliqués.                                                                                                                                                                                                                                                                                                                                                                                                  |
| 6. Implantation                      | En cours         | PR 266–270 : référentiel magasin, historique/Outbox/conflits, plan natif, placements/mobiles, contrôles géométriques et lecture sourcée du copilote. **PR 271 : retouche physique préparée dans le chat, comparaison/contrôle existants puis confirmation locale d’un brouillon. Dimensions/placements ciblés, mobiles ajoutés/associés/retirés, référence adoptée conservée, refus des sources obsolètes, reprise sans doublon après redémarrage. Code prêt, non livré.** **PR 272 : affectations proposées aux meubles/surfaces exacts et schéma natif lié à la référence adoptée ; carte privée conservée, consultation hors connexion et contrôle local des changements de sources. Code prêt, non livré.** **PR 273 : confirmation de l’implantation dans le brouillon hebdomadaire existant, conservation des notes/TG, synchronisation et reprise dans le plan commercial validé séparément. Sources recontrôlées à la validation ; anciens clients protégés. Code prêt, non livré.**                                                                                                                                                                                                                                                                                      | Illustration liée, contraintes manquantes, inventaire fixe/TG, manipulation directe, réparation et pilote mesuré. Adoption/abandon/restauration restent explicites dans le plan magasin. Sortie : proposition utile liée au référentiel, sans dimensions/capacité inventées ni déplacement implicite, acceptée sur le rayon réel.                                                                                                                                                                                                                                                                                                           |
| 7. Finition UX et validation globale | En cours         | Chat natif, streaming, étapes d’outils, sources, formulaires, multi-conversations, mémoire/compactage et suppression déjà travaillés. **PR 260 : découverte native d’outils. PR 261 : erreurs observables et secours sans chiffres hors sujet. PR 263 : accueil conservé selon la précision de Julien ; seul le bloc de secours quotidien hors sujet est visé (génération corrigée en PR 261, livraison API en attente). Recette iPhone groupée préparée ; incident et validation restent ouverts.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Livraison cohérente et validation des parcours complets, dont hors connexion/redémarrage/reconnexion. Sortie : scénario V1 complet accepté par Julien, sans régression critique ni nouvelle étape technique imposée dans le parcours métier.                                                                                                                                                                                                                                                                                                                                                                                                |

## Livraison observée à cette mise à jour

- API : livraison groupée PR 302–305, source `1e7684d`, `dpl_5V3PH6qHG9aw3xQaSX4SfgAwiTh3`, Ready sur `https://fl-copilot.vercel.app`. Santé JSON/base connectée et alias/source vérifiés. Prédécesseur conservé : `dpl_6Kb25ogrAZubQJc29Ka5EMEN5wTa`.
- Dernier binaire fourni : EAS `202ec9d8-041a-4eb9-9a15-c9f70e9b3206`, staging **0.1.0 / build 5**, source `1e7684d`, terminé le 20 octobre 15:53:57 UTC. Tableaux du chat, Actions et inventaire/placement sont inclus. Aucun résultat de recette du build 5 n’est présumé.
- Réception email livrée côté code/API mais fournisseur non activé. PR 306–308 restent fusionnées non livrées ; PR 308 a passé ses deux CI finales (3 449 tests / 6 ignorés, cinq scénarios Mongo), merge `0b7f9af`, branches supprimées. Le lot de rétention des illustrations est en préparation ; génération et validation native/M8 restent ouvertes.
- Aucun build EAS payant ni déploiement Vercel automatique par PR. Une fusion n’est jamais annoncée comme une mise à disposition sur le téléphone.

## Ordre de poursuite

Les sept chantiers ne sont pas des étapes strictement séquentielles. Le chantier actif et l’écart fermé sont précisés dans chaque lot ; le chantier 6 est actif sur le référentiel magasin et sa synchronisation. Les manques du chantier 1 restent ouverts dans l’inventaire. Préparer une livraison/acceptation groupée adaptée lorsque le périmètre livré est cohérent. Ne pas multiplier les PR de simples couches internes présentées comme des fonctionnalités utilisables. Les sept critères de sortie restent la référence commune jusqu’à clôture M7 ; M8 conserve ses exigences de mise en production.

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

## PR 262 — prochaine recette groupée (accueil rétabli en PR 263)

Chantier actif : **7 — UX et validation**. Le texte d’accueil « De quoi avez-vous besoin ? » et sa suggestion avaient été retirés à la suite d’une mauvaise interprétation, corrigée en PR 263 : Julien souhaite les conserver. Aucun message ni brouillon enregistré n’est supprimé. Le champ de saisie et les états de chargement, d’erreur, de réponse et de synchronisation restent gérés par le parcours existant.

La [recette du prochain build](../qa/M7_GROUPED_IPHONE_ACCEPTANCE.md) regroupe les tests prioritaires : nouvelle conversation/historique, comparaison novembre 2024/2025, lot Mercalys et reprise hors connexion. Casse/correction, décision/réalisation et usage quotidien complètent selon les données disponibles. API réellement livrée, binaire identifié et résultat réel sont trois vérifications distinctes. Le diagnostic de la PR 261 doit être présent côté API avant de valider les pannes. L’incident n’est pas déclaré résolu par ce changement d’affichage.

Écart fermé dans le code : accueil non souhaité. Reste : livraison groupée et acceptation pilote, cause exacte des échecs si récurrence, autres critères de sortie du chantier. Pas de build EAS ni de génération payante dans ce lot ; les tests sur téléphone seront regroupés au prochain build utile.

États : **1 en cours ; 2 code prêt ; 3 en cours ; 4 en cours ; 5 en cours ; 6 à démarrer ; 7 en cours**. Aucun chantier supplémentaire n’est déclaré terminé.

## PR 263 — conserver l’accueil, retirer le secours hors sujet

Chantier actif : **7 — UX et validation**. L’accueil « De quoi avez-vous besoin ? » et sa suggestion sont rétablis. Le texte désigné par Julien est le bloc d’échec « L’analyse du copilote est momentanément indisponible », suivi du bilan quotidien et de codes AVAILABLE/UNAVAILABLE. La PR 261 empêche déjà sa production dans les nouvelles réponses conversationnelles ; l’API compatible doit être livrée pour que ce changement soit effectif.

La recette du prochain build conserve donc l’accueil et vérifie un nouveau tour de conversation après livraison : réponse pertinente, ou secours bref sans chiffres hors sujet. Les anciens messages enregistrés ne sont pas réécrits par cette modification de l’interface. Aucun déploiement, effacement d’historique, build EAS ou appel IA payant dans ce lot. Le diagnostic de l’incident reste ouvert.

Écart fermé dans le code : annulation du retrait d’accueil non souhaité et correction de la recette. Reste : livraison API/native groupée puis validation réelle. Les sept chantiers gardent leurs états : **1 en cours ; 2 code prêt ; 3 en cours ; 4 en cours ; 5 en cours ; 6 à démarrer ; 7 en cours**.

## PR 264 — premier contrôle des implantations TG/îlots

**Chantier actif : 6 — implantation.** Le chantier passe de « à démarrer » à « en cours ». Le chat peut appeler le moteur partagé pour tester un scénario rectangulaire provisoire : rotations de 0/90°, nombre de meubles, limites de zone, collisions, réservations d’entrées/passages, largeur minimale déclarée, hauteur et charge par meuble. Une donnée inconnue ne vaut pas zéro ; un inventaire inconnu ne vaut pas une absence d’obstacles. Les collisions connues restent signalées même si d’autres mesures manquent. Les résultats et points à vérifier utilisent les sources et étapes existantes, avec empreinte déterministe du scénario et du magasin.

Ce calcul n’enregistre ni mesure magasin confirmée, ni plan commercial, ni réalisation. Les arguments restent des hypothèses, y compris après un résultat sans anomalie géométrique. Le moteur ne déduit pas les mesures d’une photo et ne vérifie pas les normes, le cheminement entrée/sortie ou la stabilité. Les rectangles sont le seul périmètre pris en charge. Le formulaire générique existant permet de demander les dimensions manquantes ; aucune nouvelle campagne de saisie ou couche d’orchestration.

**Écart couvert :** absence de calcul déterministe des contraintes géométriques dans le chat. **Reste du chantier 6 :** provenance/confirmation des mesures, conservation d’un scénario éditable versionné, schéma visuel canonique, illustration liée et recette sur un cas pilote. Une empreinte de calcul n’est pas un historique de révisions modifiables. Le chantier reste en cours.

1. **Actions métier et conflits : en cours.** Reste de l’inventaire inchangé ; aucun nouveau droit d’écriture.
2. **Contre-promo : code prêt.** Livraison et acceptation groupées en attente.
3. **Documents : en cours.** Réception Resend et restauration distante restent ouvertes.
4. **Expertise structurée : en cours.** Corpus/évaluation à poursuivre.
5. **Suivi des recommandations : en cours.** Validité opérationnelle complète et boucle pilote restent ouvertes.
6. **Implantation : en cours.** Précontrôle rectangulaire prêt dans le code après contrôles ; schéma, scénario durable, illustration et pilote à faire.
7. **UX/validation : en cours.** Outil découvert par le catalogue SDK existant et liens de source compatibles ; dialogue réel/recette après livraison groupée. L’incident du chat n’est pas déclaré résolu.

Aucun déploiement API, build EAS, appel de modèle ou image payante. Pas de migration ni modification de données métier. L’API compatible reste à livrer ; aucun résultat sur iPhone n’est revendiqué. Voir [la recette dédiée](../qa/M7_IMPLANTATION_SCENARIOS.md).

## PR 265 — cadrage du plan physique dans la fiche magasin

**Chantier actif : 6 — implantation.** Le référentiel physique est magasin/partagé, pas une géométrie privée à ressaisir par conversation. Le point de départ est le modèle fleg à vérifier. Le lexique confirmé comprend deux îlots de huit éléments fixes chacun (quatre par face), chaque élément d’îlot avec son bac aluminium et sa propre étagère supérieure, trois éléments TG et des mobiles de vente seulement sous certains éléments. Les mobiles ont un emplacement habituel ; les déplacements restent volontaires.

La [spec canonique](../specs/STORE_LAYOUT_SPEC.md) distingue plan physique, affectation commerciale, illustration et réalisation. Elle décrit le plan 2D, la fiche d’élément en vue de face, les surfaces et mobiles, les brouillons/révisions, l’usage hors connexion et la synchronisation canonique. L’étagère continue visuellement reste un assemblage de surfaces distinctes. Les superpositions sous meuble ne sont pas des collisions latérales par défaut, sans pour autant prouver le passage en hauteur.

Écart fermé : modèle métier et ordre de livraison clarifiés avant d’ajouter une persistance de scénarios de chat qui doublerait le référentiel magasin. Reste du chantier 6 : contrats/migrations et stockage/sync, adaptation des contrôles au véritable inventaire, éditeur natif, outils, schéma/illustration et pilote. Les mesures exactes, mobiles et détails de surfaces sont à renseigner progressivement ; ils ne sont pas inventés.

1. **Actions métier/conflits : en cours.** Aucun nouveau CRUD livré.
2. **Contre-promo : code prêt.** Livraison/acceptation en attente.
3. **Documents : en cours.** Réception/restauration restent ouvertes.
4. **Expertise : en cours.** Corpus/évaluation à poursuivre.
5. **Recommandations : en cours.** Validité complète et boucle pilote restent ouvertes.
6. **Implantation : en cours.** Spec cadrée ; module physique non implémenté dans ce lot.
7. **UX/validation : en cours.** Parcours décrit, acceptance native et incident chat toujours ouverts.

Documentation uniquement : aucun code, contrat de données exécuté, migration, déploiement, appel IA/image ou build EAS. Contrôles locaux : cohérence des décisions, liens relatifs, diff et format ; pas de nouveaux tests fonctionnels pour une clarification documentaire. La CI standard reste la condition de fusion, sans valoir acceptation produit.

## Lot courant — affectations et schéma liés au plan (PR 272)

1. **Actions métier et conflits : en cours.** Aucun nouveau droit d’écriture métier ; les reprises et corrections hors périmètre restent ouvertes.
2. **Contre-promo : code prêt**, acceptation/livraison groupées inchangées.
3. **Documents : en cours.** Les offres affectées conservent dates et filiation PDF ; consultation de l’original réutilisée.
4. **Expertise métier structurée : en cours.** Raisons et hypothèses restent des propositions ; aucune capacité, quantité ou performance n’est inventée.
5. **Suivi des recommandations : en cours.** Cette carte contrôle ses sources locales propres ; elle ne clôt pas la fraîcheur générale ni le cycle décision/exécution/bilan.
6. **Implantation : en cours.** Proposition aux meubles/surfaces identifiés et schéma natif sur la même révision adoptée, conservés dans la discussion. Une nouvelle référence ou offre/fiche modifiée impose une revue ; une absence locale reste invérifiable. Une TG sans surfaces décrites reste affectable comme meuble entier, sans surface inventée. Restent illustration, lien avec le plan commercial approuvé et pilote réel.
7. **UX et validation globale : en cours.** Carte et feuille réutilisent le plan natif ; repères numérotés/liste accessible, consultation hors connexion, zoom conservé et actualisation sans effacement. Recette du futur binaire encore à faire.

Code prêt après contrôles, non livré sur iPhone. Pas de déploiement automatique, appel modèle/image ni build EAS payant. Voir `docs/qa/M7_STORE_LAYOUT_ALLOCATION_SCHEMATIC.md`.

## Lot courant — lier l’implantation à la préparation (PR 273)

1. **Actions métier et conflits : en cours.** Confirmation locale du lien et retrait explicite partagent les historiques/CAS/Outbox existants ; les autres reprises restent ouvertes.
2. **Contre-promo : code prêt**, livraison/acceptation groupées inchangées.
3. **Documents : en cours.** Aucune ingestion ajoutée ; les références PDF d’origine restent conservées.
4. **Expertise métier structurée : en cours.** Produits d’assortiment et offres restent distincts, sans capacité ni quantité déduite.
5. **Suivi des recommandations : en cours.** Enregistrer le brouillon ne valide pas le plan et ne déclare aucune exécution ; la fraîcheur générale reste ouverte.
6. **Implantation : en cours.** Proposition relue liée au brouillon, puis héritée par un plan validé séparément après recontrôle des sources. Restauration sur second appareil et refus des anciennes versions vérifiés. Restent illustration, contraintes/inventaire/gestes manquants et pilote mesuré.
7. **UX et validation globale : en cours.** Comparaison et confirmation dans la feuille du chat, consultation du lien depuis la préparation/plan, refus explicites et bonne semaine historique. Recette iPhone groupée encore à faire.

Code prêt après contrôles, non livré. **2 153 tests locaux et quatre cas Mongo réels réussis**, build API et exports iOS/Android passés ; pas de build EAS payant ni de déploiement. Voir `docs/qa/M7_STORE_LAYOUT_COMMERCIAL_LINK.md`.

## Lot courant — Explorer analytique natif et première navigation UX (PR 274)

1. **Actions métier et conflits : en cours.** Les tâches commerciales existantes sont accessibles depuis Actions ; aucune nouvelle mutation métier ni clôture des exceptions CRUD.
2. **Contre-promo : code prêt**, livraison et dialogue réels encore à valider.
3. **Documents : en cours.** Semaine, tickets et imports restent accessibles dans la nouvelle navigation ; réception/restauration des sources encore ouvertes.
4. **Expertise métier structurée : en cours.** Aucune nouvelle connaissance métier ni conclusion causale déduite par l’interface.
5. **Suivi des recommandations : en cours.** Le suivi réel des tâches du plan est réutilisé ; acceptation d’un conseil et exécution restent distinctes.
6. **Implantation : en cours.** Socle PR 273 conservé ; illustrations et contraintes/gestes/pilote encore ouverts.
7. **UX et validation globale : en cours.** Premier Explorer Jour/Semaine/Mois/Année sur les montants canoniques SQLite, sélection contextuelle, comparaison ISO N−1 ou civile qualifiée, graphique et drill/retour. État privé période/métrique/historique/scroll conservé après redémarrage ; thème sombre commun et cinq domaines natifs avec le chat à l’ouverture. Restent filtres/contributions/liens profonds, cohérence des autres écrans, médias et recette native groupée.

14 nouveaux cas réussis (moteur + SQLite sur disque). Les vérifications complètes et les deux CI exactes sont consignées dans la PR. Aperçu local des composants avec données de test, distinct de la recette téléphone. **Code non livré**, aucun build EAS payant ni déploiement API. Voir `docs/qa/M7_UX_ANALYTICS_EXPLORER.md`, l’audit et la décomposition UX ; les sept chantiers et le périmètre V1 complet sont conservés.

## Lot courant — filtres, contributions et liens Analytics (PR 275)

1. **Actions métier et conflits : en cours.** Les liens des fiches sont de la consultation ; aucune nouvelle mutation ni clôture des exceptions CRUD.
2. **Contre-promo : code prêt**, livraison/recette inchangées.
3. **Documents : en cours.** Agrégats canoniques réutilisés ; aucune nouvelle ingestion ni clôture de réception/restauration.
4. **Expertise métier structurée : en cours.** Classification actuelle explicite ; aucune nature déduite du canal source ni causalité inventée.
5. **Suivi des recommandations : en cours.** Détail monétaire et comparaisons consultables, sans déclaration d’exécution ou conclusion d’impact implicite.
6. **Implantation : en cours.** Illustration, contraintes/gestes et pilote encore ouverts.
7. **UX et validation globale : en cours.** Filtres catégorie/nature/produit, catégories et montants par produit paginés, navigation Mois → semaine ISO complète → Jour → retour, contexte filtre/page/deux défilements restauré. Accès depuis Aujourd’hui et une fiche produit ; les citations du chat, gestes natifs, autres écrans/médias et recette globale restent ouverts.

PR 274 fusionnée sur `2b40dc0` après succès push/PR exacts, branche supprimée. Pour ce lot : **2 178 tests locaux réussis**, build/import API et exports natifs réussis ; contrôle visuel de composants avec données de test et mesure locale synthétique de 107 310 lignes. **Code non livré sur téléphone**, aucun build EAS payant ni déploiement. Voir `docs/qa/M7_UX_ANALYTICS_FILTERS.md`. Les sept critères de sortie restent inchangés.

## Lot courant — sources chiffrées du chat vers Analytics (PR 276)

1. **Actions métier et conflits : en cours.** Navigation de consultation uniquement ; aucune mutation ou clôture des exceptions CRUD.
2. **Contre-promo : code prêt**, livraison/recette inchangées.
3. **Documents : en cours.** Les valeurs et sources citées restent immuables ; autres canaux et restauration encore ouverts.
4. **Expertise métier structurée : en cours.** Sommes/moyennes, bases de calcul, J−7 et références explicites restent distincts, sans causation inventée. Aucun supplément d’instructions ou de métadonnées de navigation envoyé au modèle.
5. **Suivi des recommandations : en cours.** Les bilans qui réutilisent les résultats de période héritent des destinations ; la navigation ne déclare aucune réalisation et ne change pas les empreintes de faits.
6. **Implantation : en cours.** Illustration et autres portes restantes inchangées.
7. **UX et validation globale : en cours.** Sources monétaires structurées vers dates/métrique/périmètre exacts, y compris période libre et moyenne ; base rayon/produits, univers de couverture et J−7 conservés. Restent transport compact des très longues citations, recette native des liens/gestes/formulaires, cohérence des autres écrans/médias et portes M7/M8.

PR 275 fusionnée sur `d20bac7` après succès des CI push/PR exactes, branche supprimée. Pour ce lot : **2 192 tests locaux réussis**, preuve de chaîne serveur/citation/cache/SQLite et contrôle visuel séparé. Code non livré ; build/API/export et CI consignés dans la PR. Aucun déploiement, appel modèle/image ou build EAS payant. Voir `docs/qa/M7_UX_ANALYTICS_SOURCE_LINKS.md`.

## Lot courant — catalogue et édition protégée (19 octobre 2026)

1. **Actions métier et conflits : en cours.** L’éditeur manuel relit et compare la fiche courante avant une mutation locale atomique ; changement concurrent, conflit, cible indisponible et identifiant déjà associé restent explicites. Les autres reprises et la recette distante restent ouvertes.
2. **Contre-promo : code prêt**, livraison et acceptation groupées à faire.
3. **Documents : en cours.** Aucun canal ou original restauré supplémentaire dans ce lot ; réception Resend et autres portes L8 restent ouvertes.
4. **Expertise métier : en cours.** Évaluation des cas réels et compléments L7 à poursuivre.
5. **Recommandations : en cours.** Parcours complet jusqu’au bilan réel et fraîcheur restent à accepter.
6. **Implantation : en cours.** Illustration, contraintes et validation physique restent ouvertes.
7. **UX/validation : en cours.** L5 avance avec catalogue recherchable/filtrable, détail lisible, contexte restaurable et protection des saisies. Tests locaux et contrôle visuel décrits dans `../qa/M7_UX_PRODUCTS.md`. Gestes natifs, autres écrans, bibliothèque visuelle et livraison/recette M8 restent ouverts.

La PR 276 précédente est fusionnée après succès des deux contrôles exacts (`39325701435`, `39325707792`), merge `1aa550736e4b49c9359447fc24158b43274eb7f8`. Ses liens vers les sources analytiques restent non livrés sur téléphone. Ce lot Produits ne déclenche aucun déploiement ni build EAS payant.

## Lot courant — Actions et signalements réels (19 octobre 2026)

1. **Actions/conflits : en cours.** Les tâches sont visibles en premier, filtrables et liées à la semaine choisie. Conflits/refus restent signalés ; les règles de résolution ne changent pas.
2. **Contre-promo : code prêt**, livraison/acceptation groupées à faire.
3. **Documents : en cours**, réception et restauration restantes inchangées.
4. **Expertise : en cours**, évaluation et cas réels restants.
5. **Recommandations : en cours.** La réalisation reste une déclaration explicite ; éditeur préservé pendant l’évolution du plan. Recette jusqu’au bilan réel toujours ouverte.
6. **Implantation : en cours**, illustration/contraintes/validation terrain restantes.
7. **UX/validation : en cours.** Semaine des actions et signalements réels d’Aujourd’hui améliorés. Autres écrans, médias et recette native/M8 restent ouverts.

Preuves/limites : `../qa/M7_UX_ACTIONS.md`. Aucun déploiement API ou build EAS payant. Une fusion ne vaut pas validation sur téléphone.

Le lot Actions/Aujourd’hui inclut aussi le lien exact de la casse au prix d’achat vers Analyses, séparé du prix de vente. Calcul connu/estimé et qualification réutilisés du moteur partagé, sans ajout d’instructions IA. Tests locaux rayon/produit et non-régression Aujourd’hui passés ; recette native encore ouverte. Le chantier 7 reste en cours. La PR 277 Produits précédente est fusionnée après ses deux CI exactes réussies (`39327121525`, `39327128020`), merge `2245ff3d1a49a9ea7d789d09c81319b681a1df41`, branche distante supprimée, toujours en attente de livraison groupée.

## Lot courant — sources lisibles et retrouvables (19 octobre 2026)

1. **Actions/conflits : en cours.** Conflits/refus de tickets distingués d’un envoi en attente et reliés à Synchronisation ; aucune résolution automatique ajoutée. Autres reprises et recette restent ouvertes.
2. **Contre-promo : code prêt**, livraison et acceptation groupées à faire.
3. **Documents : en cours.** Recherche/filtres de tickets et fichiers, publications réellement enregistrées, originaux PDF consultables depuis la liste et présentation progressive. Réception Resend/restauration/acceptation restent ouvertes.
4. **Expertise : en cours**, évaluation des cas réels restante.
5. **Recommandations : en cours**, aucune réalisation ou causalité inférée ; parcours jusqu’au bilan réel encore à accepter.
6. **Implantation : en cours**, illustration, contraintes et validation terrain restantes.
7. **UX/validation : en cours.** L5 progresse sur Casse/Imports/Documents et les états accessibles. Formulaires détaillés, autres écrans, médias et recette native/M8 restent ouverts.

La PR 278 précédente est fusionnée après ses deux CI exactes réussies (`39328076827`, `39328085774`), merge `a1fba2a2dd017f40f23de123a543fda0ed6cf6f3`, branche distante supprimée. Les nouveaux parcours restent en attente de livraison groupée, sans déploiement ou build EAS payant. Preuves et limites de ce lot : `../qa/M7_UX_SOURCE_LISTS.md`.

## Lot courant — sources analytiques longues conservées (19 octobre 2026)

1. **Actions/conflits : en cours.** Les liens de présentation ne changent pas la fraîcheur d’une recommandation ; les décisions et déclarations gardent leurs contrôles et confirmations. Autres corrections/conflits et recette restent ouverts.
2. **Contre-promo : code prêt**, livraison et acceptation groupées à faire.
3. **Documents : en cours.** Sources et citations restent lisibles sur les builds installés ; réception Resend et restauration d’originaux restantes inchangées.
4. **Expertise : en cours.** Aucune surcharge d’instructions ni nouvel outil dans ce lot ; évaluation métier restante.
5. **Recommandations : en cours.** Une destination ajoutée à un message identique ne périme pas un conseil ; un changement de contenu reste détecté. Parcours jusqu’au bilan réel toujours à accepter.
6. **Implantation : en cours.** Illustration, contraintes et validation terrain restent ouvertes.
7. **UX/validation : en cours.** Transport compact des liens exacts Analytics, compatibilité, historique et redémarrage vérifiés localement ; Mongo transactionnel et exports finaux en CI. Recette native et autres portes V1 restent ouvertes.

Preuves/limites : `../qa/M7_COMPACT_ANALYTICAL_SOURCES.md`. PR 279 fusionnée sur deux CI exactes réussies, merge `28c593b82cdbafa1f7aadd1705d3483e6ec410fc`, branche distante supprimée. Le correctif reste à livrer avec API compatible puis binaire groupé ; aucun build EAS ou appel IA payant.

## Lot courant — réglages protégés et thème des formulaires (20 octobre 2026)

1. **Actions/conflits : en cours.** Mon magasin refuse atomiquement une saisie fondée sur une ancienne configuration ; les autres corrections/conflits et tests deux appareils restent ouverts.
2. **Contre-promo : code prêt**, livraison et acceptation groupées à faire.
3. **Documents : en cours**, réception Resend/restauration et acceptation restantes inchangées.
4. **Expertise : en cours**, évaluation métier restante.
5. **Recommandations : en cours**, décision/réalisation/bilan réel et fraîcheur restent à accepter.
6. **Implantation : en cours.** Retour du plan vers les réglages sans effacer la saisie ; illustration, contraintes et validation terrain restent ouvertes.
7. **UX/validation : en cours.** Protection des réglages, erreurs françaises, zone accessible, thème web et classes d’erreur corrigés. Autres écrans, médias et recette native/M8 restent ouverts.

PR 280 fusionnée après succès des CI exactes push `39331362090` et PR `39331396389`, tête `3517647f`, merge `6689432990c54ff618b3f72db63a8c26fbf101eb`, branche distante supprimée. Sources analytiques encore non livrées sur téléphone. Preuves du lot courant : `../qa/M7_UX_STORE_SETTINGS.md` ; aucune livraison automatique, aucun appel IA ou build EAS payant.

## Lot courant — correction de tickets préservée et ciblée (20 octobre 2026)

1. **Actions/conflits : en cours.** Correction manuelle fondée sur une version vérifiée ; publication concurrente et cibles retirées refusées. Le copilote conserve sa transaction révisée. Les autres reprises/conflits et recette deux appareils restent ouverts.
2. **Contre-promo : code prêt**, livraison et acceptation groupées à faire.
3. **Documents : en cours.** Originaux repliables mais accessibles, extraction incomplète distincte de zéro ligne, statuts publié/conflit/refus et corrections conservées. Réception Resend/restauration et autres portes ouvertes.
4. **Expertise : en cours**, évaluation métier restante ; aucune instruction ou fournisseur supplémentaire.
5. **Recommandations : en cours**, décision/réalisation/bilan réel restent à accepter.
6. **Implantation : en cours**, illustration, contraintes et validation terrain restantes.
7. **UX/validation : en cours.** Casse avec aperçu, garde de saisie et raccourcis vers les champs bloquants ; tests SQLite et contrôle visuel locaux passés. Catalogue hors candidats, autres écrans, chat, médias et recette native/M8 restent ouverts.

PR 281 fusionnée après succès des CI exactes push `39332367255` et PR `39332407247`, tête `e4cc1285`, merge `f0942e173a194a61fe49d191e75f6d57d2221db3`, branche distante supprimée. Preuves/limites du lot courant : `../qa/M7_UX_RECEIPT_REVIEW.md`. Code non livré sur téléphone ; aucun appel payant, déploiement ou build EAS.

### 20 octobre — choix manuel du catalogue dans la casse

Chantiers 1 et 7 : recherche et confirmation d’un produit hors propositions, création par le formulaire existant puis retour à la sélection/ticket, contrôles atomiques des snapshots de ligne et d’identité, aucune publication ni mémoire implicite. Voir `../qa/M7_UX_RECEIPT_CATALOGUE.md`. Les sept états restent : **1 en cours ; 2 code prêt ; 3 en cours ; 4 en cours ; 5 en cours ; 6 en cours ; 7 en cours**. La PR 282 est fusionnée (deux CI finales réussies, branches supprimées) ; la recette native groupée et les autres engagements V1/M8 restent ouverts. Pas de déploiement, appel IA ou EAS payant.

### 20 octobre — bibliothèque visuelle en construction

L6/M7 7 : contrats, métadonnées locales/Outbox, négociation et premiers contrôles de synchronisation sont en cours sur une branche dédiée. Aucune génération ou recherche d’image à l’import, aucun produit commercial fusionné avec une identité visuelle. Le module reste ouvert pour fichiers privés/cache/gestion native, conflits et preuve complète sur un autre appareil ; voir `../qa/M7_VISUAL_LIBRARY.md`. Les sept états ne changent pas. La PR 283 est fusionnée après ses CI finales push `39336067334` et PR `39336074077` réussies, merge `ab5e2bfde03b4558ab2ac295be9b0ae660493ce5`, branches supprimées. Code fusionné ne signifie pas livré sur téléphone.

### 20 octobre — fichiers de bibliothèque visuelle et protections hors connexion

L6/M7 7 avance sur la branche non livrée : routes privées, vérification des octets/provenance, aperçu orienté sans EXIF, manifeste lié à l’asset, transfert mobile et registre SQLite de fichiers. Les scénarios de reprise, compte différent, révocation, téléchargement incomplet, espace insuffisant et conservation d’originaux sont testés localement. Restent le raccordement aux mutations/écrans et au réveil de synchronisation, l’éviction physique coordonnée, les conflits et la preuve complète sur un autre appareil. Les tests Mongo dédiés attendent la CI ; aucune recette native ni livraison n’est déduite des tests locaux. Les sept états restent **1 en cours ; 2 code prêt ; 3 en cours ; 4 en cours ; 5 en cours ; 6 en cours ; 7 en cours**. Aucun coût fournisseur, build EAS ou déploiement.

### 20 octobre — gestion des images dans Produits, travail durable et contrôle UX

L6/M7 7 : affichage local/placeholder dans le catalogue, ajout/choix avec aperçu et confirmation dans la fiche, droits/source progressifs, retrait du lien et révocation. L’affectation et son travail de transfert sont atomiques avec l’Outbox ; le moteur existant reprend les fichiers après les métadonnées, avec compte, bail, backoff et erreurs visibles. Le contrôle visuel à largeur téléphone passe avec données synthétiques et racine web corrigée pour ne pas monter les rappels natifs. Voir `../qa/M7_VISUAL_LIBRARY.md`. Restent les conflits, l’éviction coordonnée, les autres surfaces, la preuve multiappareil et la recette native. Les sept états restent **1 en cours ; 2 code prêt ; 3 en cours ; 4 en cours ; 5 en cours ; 6 en cours ; 7 en cours**. Code de branche, aucune livraison, génération d’image ou construction EAS payante.

### 20 octobre — première preuve Mongo et nettoyage protégé des visuels

La tête `abd8d78` a passé la CI push `39342687296` : 2 813 tests, les cinq nouveaux scénarios Mongo exécutés, builds et exports réussis. Le lot suivant raccorde le nettoyage physique à cible souple 64 Mio et la préférence locale hors connexion, avec protection des originaux non envoyés, sources retirées, preuves et références partagées, et coordination des écritures/évictions. Voir `../qa/M7_VISUAL_LIBRARY.md`. Les critères conflits et multiappareil, autres surfaces et recette native sont toujours ouverts ; les sept états ne changent pas (**1 en cours ; 2 code prêt ; 3 en cours ; 4 en cours ; 5 en cours ; 6 en cours ; 7 en cours**). Rien de ce module n’est fusionné ou livré sur téléphone.

### 20 octobre — conflits de visuels et créations simultanées

L6/M7 1 et 7 : le module encore non livré utilise des UUID communs par magasin/hash et magasin/produit, sans modifier les IDs du catalogue. Le choix entre versions est relié à Synchronisation avec comparaison relue dans la transaction, confirmations distinctes de remise en diffusion/droits, historique et Outbox conservés. Le séquencement des révisions évite l’envoi d’un choix derrière son conflit non résolu. Voir `../qa/M7_VISUAL_LIBRARY.md`. Preuves de branche en cours ; autres surfaces, chaîne complète SQLite/Mongo/autre appareil et acceptation native restent ouvertes. Les sept états ne changent pas : **1 en cours ; 2 code prêt ; 3 en cours ; 4 en cours ; 5 en cours ; 6 en cours ; 7 en cours**. Aucun déploiement, appel fournisseur ni build EAS payant.

### 20 octobre — reprise des choix d’images refusés

L6/M7 1 et 7 : refus d’enregistrement reproduit et reprise explicite depuis Produits ou Synchronisation, avec nouvelle commande, versions strictement contrôlées, possibilité de retirer un brouillon inerte, source/pin et motifs historiques conservés. Le formulaire distingue droits, réactivation et validation de reprise, sans réarmer un fichier retiré. La CI du checkpoint précédent `bf6e100` est verte (2 838 tests dont six scénarios Mongo visuels exécutés) ; les nouveaux contrôles de cette reprise et la recette native ne sont pas déduits de ce résultat. Les sept états restent **1 en cours ; 2 code prêt ; 3 en cours ; 4 en cours ; 5 en cours ; 6 en cours ; 7 en cours**. Voir `../qa/M7_VISUAL_LIBRARY.md`. Aucune fusion, livraison, dépense fournisseur ou construction EAS.

### 20 octobre — visuels dans Analyses, Actions et le chat

L6/M7 7 : les surfaces réutilisent les associations explicites du catalogue réel et les petits aperçus locaux, sans recherche approximative par nom. État partagé, références stables entre rafraîchissements, récupération asynchrone des miniatures absentes via la file existante avec backoff conservé. Le contrôle local à largeur téléphone couvre visuel générique/placeholder, bouton d’exploration et carte du chat ; benchmark synthétique de 5 001 produits, sans mesure native revendiquée. La CI précédente `c6ea8ca` a exécuté les sept scénarios Mongo visuels (2 853 tests passés / 6 ignorés). Le nouveau parcours SQLite A → Mongo → SQLite B/restauration attend sa propre exécution CI ; la recette native reste ouverte. Voir `../qa/M7_VISUAL_LIBRARY.md`. Sept états inchangés : **1 en cours ; 2 code prêt ; 3 en cours ; 4 en cours ; 5 en cours ; 6 en cours ; 7 en cours**. Branche non fusionnée, aucun déploiement ou build EAS.

### 20 octobre — bibliothèque visuelle fusionnée, cohérence du chat

La PR 284 est fusionnée en `51ebd03beef883b485b49bca2a7bc31798694652`, branche supprimée, après succès des contrôles exacts push `39349059475` et PR `39349097430` sur `f95e041` : **2 859 tests réussis / 6 ignorés**, dont les huit scénarios Mongo visuels réellement exécutés et le nouveau parcours complet entre bases locales. Aucun déploiement API ou natif ; la recette groupée reste ouverte.

L5/M7 7 : contraste des cartes et saisies du chat, raccourci de nouvelle conversation, radios lisibles et accessibles, retour aux derniers messages et distinction du défilement volontaire face à la croissance d’une réponse. Contrôle local à largeur téléphone avec données synthétiques et deux régressions de suivi ; voir `../qa/M7_UX_COPILOT.md`. Les services métier, l’autorisation d’exécution et les instructions de l’IA ne changent pas. Sept états inchangés : **1 en cours ; 2 code prêt ; 3 en cours ; 4 en cours ; 5 en cours ; 6 en cours ; 7 en cours**. Le nouveau lot de chat est encore sur branche ; la recette réelle du chat et les autres engagements V1/M8 restent ouverts.

### 20 octobre — photos du rayon dans la conversation

La PR 285 du chat est fusionnée en `7f8a8112c152d720f1e714f27299db5853b91e18`, après succès des contrôles exacts push `39350715994` et PR `39350742786` sur `0bee3ef` : **2 861 tests réussis / 6 ignorés**. Branches supprimées ; aucune livraison native n’est déduite de cette fusion.

L7 : entrée explicite « Photos du rayon », copies originales locales et brouillon/tâche d’envoi atomiques liés au propriétaire, contrôles de changement de compte avant/après autorisation réseau, consultation de l’original et suivi distinct des tickets. L’agent existant reçoit les pixels vérifiés par un outil multimodal borné, sans seconde analyse IA à l’import et sans nouvelle autorité d’écriture. Les chiffres officiels restent canoniques ; les constats visuels sont des interprétations à confirmer. Voir `../specs/STORE_PHOTO_SPEC.md` et `../qa/M7_STORE_PHOTOS.md`.

1. **Actions/conflits : en cours.** Aucun nouveau droit d’exécution ; exceptions CRUD et recette multi-appareils ouvertes.
2. **Contre-promo : code prêt**, livraison/acceptation groupées restantes.
3. **Documents : en cours.** Photo de rayon séparée de la casse, envoi commun et reprise locale. Réception Resend, restauration distante des originaux/manifests et autres reprises restent ouvertes en L8.
4. **Expertise : en cours.** Lecture visuelle branchée sur le même agent ; qualité des conseils sur photos réelles encore à évaluer avec les cas métier.
5. **Recommandations : en cours**, boucle réelle décision/réalisation/bilan et fraîcheur ouvertes.
6. **Implantation : en cours.** Une photo n’est pas une mesure validée ni une illustration de scénario ; L10 demeure ouvert.
7. **UX/validation : en cours.** Menu et erreurs ciblés contrôlés en rendu téléphone ; Photos/iOS/Android, original, reprise réseau et qualité réelle de l’agent restent à accepter sur le futur binaire.

Ce lot est encore sur branche. Aucun déploiement API, appel IA payant ni build EAS ; la livraison reste groupée, API compatible avant le binaire. Aucun critère V1/M8 n’est clos par ces seules preuves.

### 20 octobre — photos de rayon fusionnées, restauration des originaux

La PR 286 est fusionnée en `7440f9acf55ae8bc2c67bc160ae5672e494e25b7`, branche locale/distante supprimée, après les contrôles exacts push `39354854659` et PR `39354858260` réussis sur `5c6a559` : **2 913 tests réussis / 6 ignorés**, API compilée et exports Hermes iOS/Android vérifiés. La propriété des photos est conservée dans les tâches et recontrôlée autour du réseau ainsi que côté API. Code fusionné seulement : pas de déploiement/API/natif ni de recette sur téléphone.

L8/M7 3 : démarrage de la récupération distante des originaux déjà confirmés, sans reconstituer les octets depuis les observations ni relancer un import. Contrats et critères définis dans `../specs/SOURCE_ORIGINAL_RECOVERY_SPEC.md` ; le parcours natif, la reprise durable, les reçus multivues et les preuves multi-appareils restent à implémenter. Le nouvel accès conserve la confidentialité magasin des originaux métier et la portée du propriétaire pour une photo de rayon ; il ne change pas la politique du lien PDF existant. Sept états inchangés : **1 Actions/conflits en cours ; 2 Contre-promo code prêt ; 3 Documents en cours ; 4 Expertise en cours ; 5 Recommandations en cours ; 6 Implantation en cours ; 7 UX/validation en cours**. Aucun sous-module n’est déclaré livré par ces contrats.

### 20 octobre — récupération vérifiée des originaux, socle natif et preuve Mongo

L8/M7 3 avance sur branche : contrats des cinq canaux, endpoints authentifiés de manifeste/lien privé, recontrôle source/envoi/Blob/autorisation, cache SQLite 51, transfert natif borné et tâches durables propriétaires raccordées au moteur de synchronisation. Les originaux déjà présents restent lisibles localement, y compris avant envoi, sans appel réseau. Les bundles de tickets retrouvent leurs vues originales ordonnées. Aucun import, publication, analyse ni commande Outbox ne découle de cette récupération ; les données métier manquantes restent attendues de leur synchronisation normale.

Preuves : **2 966 tests réussis / 6 ignorés** dans la suite complète avec Mongo local ; **11 tests ciblés rejoués** après le dernier ajustement de priorité à la copie locale. Les dix projets TypeScript, lint et compilation/import du bundle API passent. La chaîne testée capture dans SQLite A, confirme par le service d’envoi/Mongo, récupère dans SQLite B, redémarre et relit hors connexion. Blob/HTTP et adaptateurs natifs sont simulés dans ces preuves ; aucune dépense fournisseur. Voir `../qa/M7_SOURCE_ORIGINAL_RECOVERY.md` pour la portée précise et les gates ouvertes.

Le lot reste ouvert : actions et états dans les écrans, rattachement aux sources reçues après restauration, dernières contradictions de vues, recette visuelle et validation réelle iPhone/Android. Aucune PR, fusion, livraison API/native ou construction EAS de ce lot n’est déduite du socle. Les sept chantiers gardent leurs états : **1 Actions/conflits en cours ; 2 Contre-promo code prêt ; 3 Documents en cours ; 4 Expertise en cours ; 5 Recommandations en cours ; 6 Implantation en cours ; 7 UX/validation en cours**. Réception Resend et autres engagements V1/M8 restent ouverts.

### 20 octobre — consultation commune des originaux et raccordement aux sources restaurées

L8/M7 3 et 7 : actions natives communes PDF/XLSX/photos/tickets multivues, feuille de consultation, lecture locale prioritaire, attente hors connexion, annulation du transfert et reprise explicite. Un original récupéré est rattaché quand sa source métier arrive par le pull habituel, sans publication ni modification des corrections/versions. Les hashes sont lus par blocs de 1 Mio ; les photos privées gardent leurs limites de décodage et leur propriétaire. Source/fichier/compte sont recontrôlés après lecture asynchrone. L’ancien lecteur de photo redondant est retiré. Le partage natif utilise la dépendance correspondant au SDK Expo 57, avec garde d’absence dans les anciens binaires.

Preuves locales du nouvel état : **136 tests ciblés réussis / 2 ignorés**, incluant les courses de lecture, l’annulation, l’arrivée tardive des sources et les limites de photos. La suite complète précédente avec Mongo reste une preuve du socle, pas de cette nouvelle tête. Contrôle visuel à largeur téléphone avec états synthétiques : feuille, vues ordonnées, retours, scroll et focus conservés ; partage OS et geste natif non revendiqués. Voir `../qa/M7_SOURCE_ORIGINAL_RECOVERY.md`. Le lot est encore sur branche ; aucun déploiement, appel fournisseur ni build EAS.

Sept chantiers : **1 Actions/conflits en cours ; 2 Contre-promo code prêt ; 3 Documents en cours ; 4 Expertise en cours ; 5 Recommandations en cours ; 6 Implantation en cours ; 7 UX/validation en cours**. Réception Resend, autres lots V1 et recette M8 demeurent ouverts.

### 20 octobre — originaux fusionnés ; réception Resend démarrée

La PR 287 est fusionnée en `5bcb752ba86b2d24b73f482adaa80193ba257018` après succès des deux CI exactes push `39360965569` et PR `39360987957` sur `2b4fc43a559f3b9a3e90a6e54bc9c38c6d3eae69`. Les deux suites comptent **2 992 tests réussis / 6 ignorés**, dont la récupération SQLite A → Mongo → SQLite B/relecture hors connexion. Exports Hermes iOS/Android réussis. Branches locale/distante supprimées. Le code est fusionné, sans déploiement ni validation sur téléphone ; les limites de la preuve et la recette groupée restent dans `../qa/M7_SOURCE_ORIGINAL_RECOVERY.md`.

L8 : nouvelle branche de réception Resend. Signature sur corps brut, métadonnées bornées, routage destinataire/expéditeur sans nouvelle autorité, route POST Fastify encapsulée et admission durable attendue avant accusé de réception : **26 tests locaux passent**, types API/lint passent. Aucune route activée dans l’application, tâche Mongo, pièce jointe téléchargée, réception configurée ou livraison n’est déduite de ce premier contrôle. Le compte ne contient pas de webhook ; l’adresse de réception gérée a été demandée au propriétaire après vérification de l’accès disponible. Les autres travaux continuent indépendamment. Voir `../specs/RESEND_SOURCE_INTAKE_SPEC.md`.

Sept chantiers : **1 Actions/conflits en cours ; 2 Contre-promo code prêt ; 3 Documents en cours (originaux fusionnés, réception mail en construction) ; 4 Expertise en cours ; 5 Recommandations en cours ; 6 Implantation en cours ; 7 UX/validation en cours (consultation commune fusionnée, recette native ouverte)**. Aucun build EAS, appel IA payant, changement de compte ou configuration système.

### 20 octobre — réception Resend durable, parcours de livraison vérifié

L8/M7 3 avance sur branche locale : migration Mongo 45, adresses opaques non réaffectables, révocation explicite, admission atomique des métadonnées d’email et identités stables des pièces jointes. Rejeux concurrents, contradictions/quarantaine, perte de droits, conversation supprimée/archivée et échec d’enregistrement sont contrôlés. Les routes privées et le client typé sont branchés ; la réception reste désactivée sans configuration explicite complète. **90 tests ciblés distincts**, dix projets TypeScript, lint/format et bundle API passent. Le premier contrôle global a trouvé six délais de préparation Mongo de 10 secondes ; les 33 tests concernés passent après adaptation du délai de préparation, et la suite globale complète est rejouée. Voir `../qa/M7_RESEND_SOURCE_INTAKE.md`. Aucun original n’est encore téléchargé par ce nouveau canal ; conservation des octets, travail durable et confirmation SQLite/Outbox dans le chat restent dans le même lot avant livraison.

La vérification en lecture seule confirme l’API publique Ready du 17 octobre (`dpl_8wxufurZhFMng4GU8bvEyT96WKDi`, santé 200/base connectée) et le dernier artefact iOS fini `ff8a26ba-49ce-4733-bead-0f4a9b69235a`, commit `d0b40ca9c1d1e5a7f4d738f837d546eb6677fffa`, version 0.1.0/build 1. Ce dernier état ne prouve pas la version installée sur le téléphone. Une branche séparée prépare une recette groupée du code déjà fusionné, avec incrément du numéro natif staging pour tracer le prochain binaire ; elle n’intègre pas le chantier Resend inachevé. Aucun déploiement ni build EAS n’a été déclenché par ces lectures/préparations.

Les sept chantiers restent : **1 Actions/conflits en cours ; 2 Contre-promo code prêt ; 3 Documents en cours ; 4 Expertise en cours ; 5 Recommandations en cours ; 6 Implantation en cours ; 7 UX/validation en cours**. La prochaine recette du socle UX/médias/originaux requiert une livraison API compatible puis un binaire iOS groupé ; les autres engagements V1/M8 ne sont pas retirés du périmètre.

### 20 octobre — contrôle global Resend passé ; préparation du binaire fusionnée

Le socle d’enveloppes de réception `15fc0c8` passe la suite globale avec Mongo réel : **3 041 tests réussis / 6 ignorés**. Les délais de préparation de bases froides sont désormais adaptés à l’historique complet des migrations ; les assertions et délais métier ne changent pas. L’adaptateur de pièces jointes ajoute ensuite **32 tests ciblés réussis**, types/lint API passés ; il reste à le raccorder au stockage privé durable, au travail de traitement et à la confirmation SQLite/Outbox dans le chat. Aucun email ni original réel n’est téléchargé par ces tests.

La PR 288 est fusionnée en `c8a16987ed6c558b20bd2f52fa761c9095a2982b`, après CI finales push `39363231191` et PR `39363260997` réussies sur `923f6372746a206b941f61dcc5dde72435c7f92d` : **2 992 tests réussis / 6 ignorés**, bundle API et exports natifs passés. Branches supprimées. Elle prépare l’identité native distincte des builds staging et la recette groupée dans `../qa/V1_GROUPED_NATIVE_ACCEPTANCE_2026_10_20.md`. Ce changement de configuration n’a déclenché ni build EAS ni livraison API. La CI du nouveau master est encore à vérifier avant une livraison depuis cette tête.

Les sept états restent **1 en cours ; 2 code prêt ; 3 en cours (enveloppes/transport de mail sur branche) ; 4 en cours ; 5 en cours ; 6 en cours ; 7 en cours (préparation de recette fusionnée, livraison/acceptation restantes)**. La V1 complète, réception mail et autres engagements M8 inclus, reste l’objectif.

### 20 octobre — API groupée livrée, build iOS de recette lancé

La CI de master `c8a1698` (`39363869583`) a réussi. Le lot déjà fusionné est déployé en production : `dpl_AkaifXtDr139PinPy2W4HQVmeT9o`, même artefact préparé, contrôlé puis promu. Santé publique 200/base connectée ; routes originaux, visuels et historique protégées par la session. Aucun appel IA payant, changement de configuration de réception mail ou remplacement des données métier. L'ancien déploiement est conservé. La recette ne prétend pas encore valider les opérations authentifiées de l'utilisateur sur son téléphone.

Un seul build iOS staging autonome est lancé : `dd32fb48-c423-4ab7-a444-fe0fb4e0de0e`, source `c8a1698`, **0.1.0 / build 2**, certificats gelés et iPhone Air déjà provisionné. Achèvement, installation et retour utilisateur restent à vérifier. Les CLI utilisées pour cette livraison sont temporaires et épinglées ; aucune mise à jour système du Mac. Détails et limites dans `../qa/V1_GROUPED_NATIVE_ACCEPTANCE_2026_10_20.md`.

Les sept chantiers restent **1 en cours ; 2 code prêt ; 3 en cours (originaux livrés côté API, réception Resend encore sur branche) ; 4 en cours ; 5 en cours ; 6 en cours ; 7 en cours (API livrée, binaire et recette en attente)**. Cette livraison réduit l'écart entre code fusionné et produit disponible, sans retirer la réception mail, les illustrations ni les autres engagements V1/M8.

### 20 octobre — binaire groupé prêt ; conservation privée des emails testée

Le build iOS `dd32fb48-c423-4ab7-a444-fe0fb4e0de0e` est **FINISHED** (03:42:55 UTC), version **0.1.0 / 2**, source `c8a1698`. La livraison API de ce même lot reste en production. Le retour de recette sur l'iPhone a été demandé ; aucune installation ou validation sur appareil n'est encore attestée. Resend n'est pas inclus dans ce binaire.

Sur la branche Resend, les originaux sont désormais pris en charge par des jobs durables par pièce jointe : conservation privée immuable, preuve SHA-256/taille, bail, reprises bornées et réutilisation d'Inngest. Un échec de file reste retriable après enregistrement atomique ; les bons fichiers ne sont pas effacés si un autre échoue. **149 tests ciblés**, types, lint et bundle API passent. Aucun email réel, upload Blob ou appel IA n'a été effectué. L'accès aux originaux depuis le chat, la confirmation SQLite/Outbox et les pipelines métier restent à raccorder dans ce même lot avant PR/livraison.

États des sept chantiers : **1 en cours ; 2 code prêt ; 3 en cours (transport/conservation mail testés localement, intégration native restante) ; 4 en cours ; 5 en cours ; 6 en cours ; 7 en cours (API et binaire livrés/disponibles, recette sur appareil ouverte)**. La roadmap complète et les exigences M8 restent inchangées.

### 20 octobre — accès privé aux originaux reçus par email

La branche Resend fournit maintenant les contrats, routes authentifiées et client typé de récupération d'un original prêt : contrôle du compte/magasin/conversation/fichier, empreinte des métadonnées, vérification du stockage et lien privé éphémère. Un ZIP reçu n'est pas présenté comme une vente, une casse ou un PDF métier avant classification. **165 tests ciblés** passent, ainsi que les types des dix projets, lint et bundle API. Aucun service réel n'a été appelé par ces tests. La conservation locale et la confirmation SQLite/Outbox dans le chat restent à implémenter avant la PR complète.

Les sept états restent **1 en cours ; 2 code prêt ; 3 en cours ; 4 en cours ; 5 en cours ; 6 en cours ; 7 en cours**. API et build iOS 2 du lot fusionné sont disponibles ; le retour de recette sur appareil et le reste de la V1/M8 demeurent ouverts. Aucun nouveau build payant ou déploiement supplémentaire.

### 20 octobre — retour iPhone et reprise de la fidélité visuelle

Le build staging **0.1.0 / 2** (`dd32fb48-c423-4ab7-a444-fe0fb4e0de0e`, source `c8a1698`) est installé et examiné par Julien : l’application lui convient mais le design est jugé insuffisamment fidèle aux maquettes. La recette UX reste ouverte. Ce retour devient la priorité du chantier 7 ; le travail Resend reste conservé sur sa branche, sans activation.

Premier lot de correction : hiérarchie compacte Aujourd’hui/Analyses/Produits, surfaces et navigation, montants et graphique réunis, explications dépliables avec couverture toujours visible, listes et accès secondaires plus discrets, sélecteur de semaine Actions compact. Les composants réels sont examinés localement à 390 et 320 points, avec jeux de test identifiés et sans publication. **1 371 tests réussis / 7 ignorés** sur le mobile et le moteur analytique. Le détail des preuves et des manques visuels restants est dans `../qa/NATIVE_DESIGN_FIDELITY_2026_10_20.md` ; aucune nouvelle validation iPhone ni livraison de ces corrections n’est revendiquée.

Sept chantiers : **1 Actions/conflits en cours ; 2 Contre-promo code prêt ; 3 Documents en cours ; 4 Expertise en cours ; 5 Recommandations en cours ; 6 Implantation en cours ; 7 UX/validation en cours**. Ce lot avance le chantier 7, sans crédit supplémentaire sur les six autres ni fermeture de V1/M8.

## Lot prioritaire — stabilité du chat et des images (20 octobre 2026)

- **1 — Actions/conflits : en cours**, inchangé.
- **2 — Contre-promo : code prêt**, dialogue réel encore à valider.
- **3 — Documents : en cours.** Le pont natif partagé évite aussi le chargement des modules obsolètes à la lecture d’une photo de rayon ou d’un original. Réception email et restauration complète restent ouvertes.
- **4 — Expertise/dialogue : en cours.** Une analyse valide de 241 références peut aller de la lecture déterministe à l’enregistrement de la réponse ; le plafond du contexte initial reste distinct du résultat des outils. Test Mongo de persistance/rejeu et contrôles des faits conservés. La dernière question utilisateur n’a pas pu être lue via le connecteur Mongo, et la recette du dialogue réel reste nécessaire.
- **5 — Recommandations : en cours**, inchangé.
- **6 — Implantation : en cours**, inchangé.
- **7 — UX/validation : en cours.** Correction du crash Sentry lors du changement d’image produit, test de régression et règle de lint. Ce lot doit être livré avec la fidélité visuelle PR 289 dans un build groupé, puis accepté sur appareil. Les autres écarts UX/M8 restent ouverts.

Voir `../qa/CHAT_IMAGE_STABILITY_2026_10_20.md`. Codé/testé, fusionné, déployé et validé sur iPhone restent des états distincts ; aucun chantier entier n’est déclaré terminé par ce correctif.

## Lot courant — défilement des tableaux du chat (20 octobre 2026)

**7 — UX/validation : en cours.** Suppression du capteur d’appui long autour des réponses du copilote ; menu conservé sur le texte et les cellules. Largeur du tableau bornée au message et défilement natif configuré pour les deux axes imbriqués. Contrôles locaux du composant à 320/390/844 px, brouillon et source conservés ; tests des contrôleurs existants. Le blocage iPhone n’a pas été reproduit dans le navigateur : recette native encore nécessaire après livraison groupée. Le build 3 précédent ne contient pas ce changement. Aucun déploiement API ni nouveau build EAS payant pour ce correctif isolé. Chantiers 1/3/4/5/6 inchangés, en cours ; 2 reste code prêt. Voir `../qa/CHAT_TABLE_SCROLL_2026_10_20.md`.

## Réception email — état consolidé au 20 octobre

**Chantiers : 1 en cours ; 2 code prêt ; 3 en cours ; 4 en cours ; 5 en cours ; 6 en cours ; 7 en cours.** Le lot avance principalement sur **3 (Documents)**, avec contrôles de reprise et d’accès relevant de **7**. Aucun autre chantier entier n’est déclaré terminé.

- **Fusionné, non livré :** fondation des enveloppes/originaux (PR 292), confirmation SQLite + Outbox et conflits privés (PR 293, `fc79b9d`), restauration de 500 confirmations par pages bornées (PR 294, `b6b6852`), puis écran/captures/raccordement natif (PR 295, `a36d259`). Les deux CI finales de chaque PR ont été vérifiées avant fusion ; branches supprimées. La PR 294 compte 3 207 tests passés / 6 ignorés. Les preuves détaillées et identités des CI restent dans `../qa/M7_RESEND_SOURCE_INTAKE.md`.
- **Fusionné en PR 295, non livré :** écran de réception/configuration depuis le chat (`cc3ad5c`) et raccordement Mercalys (`5efdb70`). Sélection du lot et ADMIT/DISMISS utilisent les dépôts existants ; le brouillon reste conservé. La recette d’écran à 320/390 points utilise les composants réels avec ports explicitement simulés, sans preuve UIKit revendiquée. Les 658 tests de contrôleurs/cache, types et exports de ce checkpoint sont distincts de l’acceptation native.
- **Captures fusionnées en PR 295 (checkpoint `68b8f40`) :** PDF, photos de rayon et tickets de casse passent par les captures canoniques existantes. La migration 54 ajoute seulement une référence de travail privée, atomique avec la capture et sa tâche d’envoi. Une image AUTO reste sans destination tant que son usage n’est pas précisé ; un ticket multi-photo exige un regroupement explicite. Dates, caissier, associations et publication ne sont pas inventés. Reprise SQLite/fichiers, doublons, chevauchement corrigé, refus de portée et bail perdu sont contrôlés. Le lecteur ZIP commun borne/vérifie l’expansion du classeur avant analyse ; le writer du bundle conserve les originaux lors d’une interruption.
- **Lecture de reprise disponible dans le code :** l’API authentifiée retrouve un ancien email par son identité, hors de la première page et même avec la réception désactivée. Pas de capacité Blob délivrée par cette lecture. Le client typé et le rafraîchissement du cache natif sont raccordés à cette route.
- **Vérification du checkpoint `68b8f40` :** 183 tests ciblés passent dans treize fichiers, avec Mongo/SQLite/fichiers réels selon les cas ; fournisseur et décodage natif d’image restent simulés. Types des dix projets, lint/format, bundle/import API et exports locaux iOS/Android passent. La première suite globale compte 3 252 passes, six ignorés et un seul délai de 30 secondes dépassé sur un test Mongo de casse existant. Ses vingt scénarios passent isolément en 8,87 secondes. La nouvelle suite complète à quatre workers passe **3 253 tests / 6 ignorés**, 389 fichiers passés et un ignoré, en 282,12 secondes, sans modifier les assertions, délais ou CI.

- **Raccordement fusionné aux traitements (PR 295) :** la synchronisation ensemence désormais la file `SourceOriginalJobs` depuis les accords ADMIT acquittés. La migration 55 rend unique chaque groupe de traitement. Reprises bornées, compteurs de tentative monotones, bail, arrêt et choix d’usage persistants réutilisent cette file ; aucun agent, timer ni moteur financier supplémentaire. Un traitement accepté et déjà local peut avancer avant une tentative de synchronisation réseau. Mercalys/ZIP passent par le même contrôleur d’import que le chat ; PDF/photos/tickets par les mêmes dépôts et tâches d’envoi. Le nom ou le MIME déclaré d’un fichier ne détermine pas son format réel. Les rôles lecteurs gardent la synchronisation ordinaire sans prendre les travaux email.
- **Contrôles inline fusionnés (PR 295) :** état par fichier, choix ticket/photo du rayon, arrêt et reprise sont visibles dans la liste. « Transmis au traitement métier » ne prétend pas publier ni terminer l’analyse. Les composants réels à 320/390 pixels ont été exercés avec ports simulés ; SQLite/fichiers réels prouvent séparément la reprise et les effets canoniques. Le budget total du parseur de classeurs est vérifié avant allocation des cellules, en plus des plafonds lignes/colonnes. Ce checkpoint ajoute des scénarios de lot de 25 photos, reprise froide, ancien email, source encore en conservation, rôle lecteur, bail perdu et exécution concurrente carte/job. Les nouveaux messages sont relus au retour de la réception et après synchronisation, sans redémarrer la livraison d’une réponse ni remplacer le brouillon en cours. La vérification ciblée passe 229 tests dans treize fichiers ; la nouvelle suite complète sur Mongo isolé passe **3 271 tests / 6 ignorés**, 390 fichiers passés et un ignoré, en 287,70 secondes. Types des dix projets, lint/format, structure, bundle/import API et exports locaux iOS/Android passent. La recette du rafraîchissement utilise des ports simulés et constate zéro appel d’annulation, le texte progressif et le brouillon conservés.

- **Complément ZIP fusionné (PR 296) :** les membres décodés/vérifiés conservent une identité et une position même si leur copie manque. Le pointeur absent reste explicitement `null`, uniquement avec une archive conservée ; un original n’est jamais inventé. Une copie ultérieure remplit ce pointeur dans la transaction habituelle sans changer le manifeste de la carte, ses empreintes, l’ordre ou les chiffres déjà publiés. Les fichiers valides avancent pendant les reprises ; les fichiers illisibles restent visibles. Écritures temporaires vérifiées et renommage pour les membres natifs, sans écraser un fichier final contradictoire. Les contrôles ZIP continuent de vérifier bornes/tailles/CRC, y compris les membres vides diagnostiqués individuellement. La vérification locale passe **229 tests dans treize fichiers**, les types des dix projets, lint/format/structure, bundle/import API et exports iOS/Android. Les CI finales push `39414710482` et PR `39414738923` ont réussi sur `72ffa45`, avec **3 282 tests passés / 6 ignorés**, avant fusion en `fad1f64` ; branches locale/distante supprimées. Les exclusions explicites, l’acquittement distant, la livraison et la recette complète restent à faire.

- **Choix des photos fusionnés en PR 297, non livrés :** avant ADMIT, le formulaire peut former plusieurs tickets de 2 à 5 vues, traiter les photos comme des tickets séparés et choisir une photo du rayon indépendamment. AUTO reste indépendant par défaut ; nom/MIME n’accordent aucune intention métier. Les groupes suivent l’ordre original des fichiers, pas l’ordre des clics. Les choix survivent au repli/à la virtualisation dans cet écran et restent modifiables avant confirmation ; seule la confirmation passe dans le dépôt SQLite/Outbox existant. Après confirmation, un groupe ne répète plus ses commandes de traitement sur chaque vue. **154 tests ciblés dans sept fichiers**, types des dix projets, lint/format/structure et exports locaux iOS/Android passent. Recette du composant réel à 320/390 pixels avec ports simulés : deux tickets (3 et 2 vues) et une photo du rayon dans le même email, séparation/regroupement avant confirmation, limite de cinq vues et alerte corrigée, aucun débordement horizontal. La sélection réelle passe aussi par une décision acquittée puis les captures canoniques sur SQLite/fichiers de test. Fournisseur et décodage natif d’image restent simulés ; ce complément est fusionné en `d9d691b` après les CI finales push `39417005318` et PR `39417033929` réussies sur `eef1d19` (**3 293 tests passés / 6 ignorés**) ; branches supprimées. Il n’est pas livré ni validé sur iPhone.

- **Sources média liées au chat fusionnées en PR 298, non livrées :** après ADMIT acquitté, la capture PDF/photo/ticket ajoute sa référence canonique à la conversation dans la même transaction que la capture, sa tâche d’envoi et le raccordement. Les identités et le dépôt de messages/Outbox existants sont réutilisés ; une pièce jointe par groupe explicite, brouillon inchangé, aucun tour IA créé. Les lecteurs et composants habituels affichent ensuite les états réels. Des tests sur SQLite/fichiers contrôlent les quatre formats, la reprise, la panne d’Outbox et le changement de compte pendant l’écriture ; l’acquittement distant, la restauration sur un autre appareil et la lisibilité des gros lots ne sont pas déclarés validés. **170 tests ciblés dans huit fichiers**, types des dix projets, lint/format/structure et exports iOS/Android passent ; les CI finales push `39419185359` et PR `39419193798` ont réussi sur `92d1eca` (**3 300 tests passés / 6 ignorés**), avant fusion en `f0aa6dc` ; branche supprimée.

- **Même PR 298 — preuve de reprise sur appareil vierge :** le scénario photo du rayon passe de la confirmation SQLite acquittée au raccordement média, au message réellement poussé, à l’enregistrement distant de l’upload, puis au contexte documentaire du copilote. Un second stockage SQLite récupère confirmation/message et original exact, puis reste lisible après fermeture/réouverture hors ligne. Mongo et fichiers/SQLite sont réels et isolés ; enveloppe reçue, Blob et décodage natif sont des ports de test. Une seule photo et cet exemple de restauration sont démontrés, pas la réception fournisseur ni tous les formats. **168 tests ciblés dans huit fichiers** passent, dont les 22 scénarios d’intégration de confirmations/historique/original. Cette preuve est fusionnée dans la PR 298 ; la restauration complète de la V1 et la recette native restent ouvertes.

- **Limites de réception fusionnées en PR 299, non livrées :** réservations quotidiennes de téléchargement, par application et propriétaire, après métadonnées vérifiées et avant lecture des octets. Les compteurs Mongo partagent la transaction du bail ; refus différé via la file existante, sans nouveau poller. Une source attendue conserve son échéance serveur et la reprise native prévue ; les attentes de quota ne remettent pas à zéro les vrais échecs et les compteurs de réclamation restent monotones. Il s’agit de limites de réservation de cette application, pas d’un plafond monétaire de l’ensemble du compte Resend. **237 tests ciblés dans dix fichiers**, types des dix projets, lint/format/structure, bundle/import API et exports locaux iOS/Android passent. Fournisseur, déploiement et recette native restent non activés. Les CI finales push `39421197328` et PR `39421255651` ont réussi sur `2c78360` (**3 307 tests passés / 6 ignorés**), avant fusion en `2f5d038` ; branche supprimée.

- **Reprise d’un original échoué fusionnée en PR 300, non livrée :** le bouton relance désormais la conservation côté serveur via la file locale existante et le journal de commandes idempotent. Demande persistée hors ligne, nonce stable après accusé perdu, droits et bail recontrôlés ; seul le traitement parent bloqué par cette source est réarmé, sans annuler un arrêt volontaire ni une question en attente. Compteurs réels/quotas conservés ; une source encore en réception attend sans épuiser les six vraies erreurs. La migration 56 protège l’identité de l’action et l’unicité active par fichier. Un parcours Mongo/SQLite/fichiers vérifie jusqu’à une capture canonique unique, avec fournisseur/Blob/décodage natif simulés. Recette du composant réel à 320/390 px : demande locale distincte de l’original conservé, fichier indépendant et choix préservés. **186 tests ciblés dans sept fichiers**, types des dix projets, lint/format/structure, bundle/import API et exports locaux Hermes iOS/Android passent. Contrôles et limites dans `../qa/M7_EMAIL_ORIGINAL_RETRY.md`. Chantiers **3 et 7 en cours**, aucun autre chantier clôturé. Les CI finales push `39424948892` et PR `39425021979` ont réussi sur `835964b` (**3 332 tests passés / 6 ignorés**), avant fusion en `226c7a6` ; branches supprimées. Non livré ni accepté sur appareil.

**Reste du même lot avant livraison complète :** livraison/recette du regroupement des vues et des cas ZIP partiels, exclusions explicites des membres, accès du Copilote aux sources liées, résultats réellement acquittés par fichier, restauration froide/deux appareils complète, livraison des budgets de réception, configuration Resend réelle et recette fournisseur/native. Les primitives `ATTACHED`/`CAPTURED` et un job de raccordement terminé ne signifient ni analyse, ni publication, ni email terminé. Le lot natif de la PR 295 est fusionné et non livré ; la preuve globale de 3 253 tests reste celle du checkpoint antérieur ; la nouvelle exécution compte 3 271 passes. Les CI finales push `39412594071` et PR `39412656025` ont réussi sur `11477df`, avant fusion en `a36d259` ; les branches locale/distante sont supprimées. Les nouveaux compléments ci-dessous ne font pas partie de cette preuve.

**Versions :** API `dpl_7DUEQBoYCrBeVJek8GPo361NRRtL`, santé JSON/Mongo OK lors de la dernière vérification ; iOS staging build **3**, source `8ec75c6`. Les travaux email et le correctif de défilement PR 291 n’y sont pas présents. Aucun nouveau déploiement, build EAS, envoi de mail, appel IA payant, accès `.env` ou changement système. La V1/M8 et l’acceptation UX restent ouvertes.

## Fiche produit — lecture métier et continuité Analytics (20 octobre)

**Chantier 7 en cours**, lots UX L5/L6 : visuel en tête et placeholder compact, résumé de l’identité/synchronisation, chiffres réels et graphique commun avec l’Explorer, référentiel dépliable et actions préservées. Une sélection issue d’Analyses conserve sa période/comparaison ; les préférences par produit survivent à une réouverture hors ligne sans modifier la sélection globale. Les sommes, moyennes, jours manquants et écarts sur référence nulle gardent les mêmes règles déterministes. **1 537 tests passent / 7 ignorés** sur le mobile et le moteur analytique ; revue des composants réels à 320/390 px avec ports simulés, dont défilement horizontal et refus d’image obsolète sans perte du contexte. Le sélecteur photo, les gestes et la fidélité complète restent à accepter sur appareil. Vérifications finales et limites dans `../qa/PRODUCT_DETAIL_OVERVIEW_2026_10_20.md`.

PR 301 fusionnée en `9c2f66b` après réussite des deux CI finales sur `970ee32` (3 344 tests passés / 6 ignorés), branches supprimées. Livraison groupée API puis iOS build 4 terminée ; recette native encore ouverte. Chantiers **1/3/4/5/6 en cours ; 2 code prêt ; 7 en cours**. Aucun traitement IA payant, accès `.env` ou réglage système dans cette livraison. Le reste des onze lots et de M8 est conservé.

## Lot courant — liste Actions et déclaration progressive (20 octobre)

**7 — UX/validation : en cours.** Les tâches du plan deviennent une liste compacte avec progression calculée par le moteur existant. Statut et synchronisation restent distincts. Une feuille native ouvre la déclaration ; détails réels facultatifs dépliables, conservation des saisies, erreurs au bon endroit et refus d’enregistrement visible dans la feuille. Les gardes de version, transactions/Outbox, conflits et compteurs métier ne changent pas. Préparation/plan/document restent accessibles ; les entrées de gestion sont progressives.

Revue des composants réels avec ports simulés à 320/390 px et tests existants ; limites et recette native dans `../qa/ACTION_TASK_OVERVIEW_2026_10_20.md`. Le dialogue de confirmation JS a bloqué l’automatisation : annulation/poignée/clavier et accessibilité restent à accepter sur appareil. Ce lot n’est pas inclus dans le build 4 déjà fourni et ne déclenche aucun nouveau build ou déploiement. **1/3/4/5/6 restent en cours ; 2 code prêt ; 7 en cours.** Le suivi complet des recommandations, le CRUD restant, réception réelle, implantation, fidélité et M8 restent ouverts.

## Lot courant — inventaire fixe, copies et surfaces du plan (20 octobre)

**6 — Implantation et 7 — UX/validation : en cours.** Ajout explicite d’îlot/fixe/TG/mobile, copie avec identités neuves et mesures inconnues ou reprises comme déclarées, composition volontaire des TG, retrait réversible et conservation des mobiles/historiques. Les formulaires restent dans le brouillon ; enregistrement/adoption, Outbox, géométrie et conflits réutilisent le flux existant. Tests SQLite de redémarrage/annulation et synchronisation transactionnelle jusqu’à une base vierge passent. Revue du rendu à 320/390 px ; la recette interactive est encore ouverte, l’outil n’ayant pas activé même un bouton QA indépendant lorsque le Mac était signalé verrouillé.

La création/copie/retrait d’inventaire depuis le copilote reste à relier à son outil existant avant clôture du CRUD. Manipulation directe, illustration ancrée à la référence, budget/mesures et recette native restent ouverts ; aucun nouveau modèle d’agent ou moteur de KPI. Voir `../qa/STORE_LAYOUT_INVENTORY_2026_10_20.md`. **1/3/4/5 en cours ; 2 code prêt ; 6/7 en cours.** Ce lot n’est pas dans le build 4 et ne lance aucun nouveau build payant ni livraison API.

## Lot courant — parité de l’inventaire physique dans le chat (20 octobre 2026)

**1 actions/CRUD et 6 implantation : en cours.** Ajout fixe/îlot/TG/surface, copie et retrait réutilisent le moteur PR 303 et la carte/confirmation existantes. Identités attribuées côté serveur puis rejouées exactement dans SQLite ; aucun nouveau moteur d’écriture ni autre agent. Capacité négociée séparément, anciens outils et cartes mobile conservés. Proposition sans écriture, sauvegarde de brouillon distincte de l’adoption et de la réalisation. Tests ciblés des contrats, fichier SQLite fermé/rouvert, SDK simulé et nouveau parcours Mongo → SQLite A → confirmation/Outbox/Mongo → SQLite B. Voir `../qa/M7_COPILOT_LAYOUT_INVENTORY.md`. CI finales/livraison groupée et recette native restent nécessaires. Chantiers **1/3/4/5/6/7 en cours ; 2 code prêt** ; aucun chantier entier ni V1/M8 fermé.

## Lot courant — déplacement direct dans le plan (20 octobre 2026)

**6 implantation et 7 UX/validation : en cours.** Mode de placement explicite, cible choisie, aperçu éphémère et une seule étape d’annulation à la fin du geste. Conversion écran/zoom/pan et moteur de translation existants ; refus des coordonnées inconnues, aucun fallback enregistré, mobiles/descendants transformés une fois. 60 tests ciblés dont fichier SQLite avec fermeture/reprise et réessai idempotent. Recette des vrais composants à 390/320 px : exploration/placement, zoom/pan, refus, annulation, sauvegarde explicite et sortie après perte de droits, avec ports simulés. Contrôles finaux et CI restent nécessaires ; gestes et performances natives ne sont pas acceptés. Voir `../qa/STORE_LAYOUT_DIRECT_PLACEMENT_2026_10_20.md`. Dernière livraison inchangée : API/iOS build 4 `9c2f66b`. **1/3/4/5/6/7 en cours ; 2 code prêt**. Illustration liée, activation/budget fournisseur, relevés en rayon et V1/M8 restent ouverts.

### 20 octobre — source et adaptateur d’illustration liés au plan

Chantier 6 en cours, sans changement de périmètre des sept chantiers : compilation d’un schéma PNG numéroté depuis la révision physique historique et la carte privée d’affectation ; vérification des cibles/qualifications et refus des mesures manquantes ou collisions. Adaptateur Responses isolé, désactivé/non raccordé au runtime, borné à une image avec zéro retry. Les originaux, sources et provenance sont distingués, les sorties invalides ou interrompues après envoi sont incertaines et ne doivent pas être répétées automatiquement. Tests réels du SDK avec transport local intercepté, sans appel payant ni nouveau prompt global. Le schéma de QA utilise uniquement des mesures synthétiques clairement signalées.

Code préparé ; demande locale durable, Outbox/sync, stockage privé/cache, interface de comparaison, budget/activation et recette en rayon restent à implémenter avant toute annonce de génération utilisable. Voir `../qa/STORE_LAYOUT_ILLUSTRATION_SOURCE_2026_10_20.md`. La livraison groupée précédente ne contient pas cet adaptateur ; aucun build supplémentaire n’est déclenché par ce lot.

### 20 octobre — préparation d’illustration durable, sans génération

**6 implantation et 7 UX/validation en cours.** Le scénario privé et sa référence physique historique sont conservés dans une préparation immuable SQLite/Outbox/Mongo. Réessais et accusés, isolation des comptes, restauration paginée et migration précèdent l’usage natif. La feuille existante affiche À synchroniser/Synchronisée et bloque les sources périmées ou les mesures indispensables manquantes. Aucun lancement payant à l’enregistrement ou à la reconnexion. Revue web des composants réels à 320/390 px avec ports simulés ; 13 tests mobiles et deux tests backend, quatre scénarios Mongo à vérifier dans les CI transactionnelles. Voir `../qa/STORE_LAYOUT_ILLUSTRATION_PREPARATIONS_2026_10_20.md`.

Code en contrôle, non livré ; API et iOS 5 restent sur `1e7684d`. Budget/autorisation séparée, génération et récupération, stockage privé/cache/comparaison et recette en rayon restent à terminer. **1/3/4/5/6/7 en cours ; 2 code prêt**, aucune fermeture V1/M8 ni nouveau build payant.

### 20 octobre — originaux et comparaison d’illustration privés

**6 implantation et 7 UX/validation en cours.** Le lot PR 307 précédent est fusionné en `39552fa` après deux CI finales réussies sur `b988382` (**3 431 tests passés / 6 ignorés** chacune), branche supprimée, sans livraison supplémentaire. Le lot courant conserve séparément schéma/données sources, original fournisseur et image normalisée. Point de reprise privé avant conservation, restitution après interruption depuis le même original, et refus de regénérer quand il est absent. Lecture authentifiée par propriétaire ; une révocation ou suppression logique masque le résultat sans perdre les octets déjà produits.

Récupération dans un cache SQLite/fichiers privé, réouverture hors ligne et comparaison dans la feuille existante ; avertissement historique, images conservées malgré un échec réseau. Revue des composants réels à 320/390 px avec pixels/ports synthétiques et tests locaux ; cinq scénarios Mongo transactionnels restent à confirmer dans les CI. Voir `../qa/STORE_LAYOUT_ILLUSTRATION_FILES_2026_10_20.md`. Code en contrôle, non livré ; API/iOS 5 restent en `1e7684d`. Autorisation/budget, worker de génération et résultats incertains, limites du cache et recette en rayon restent ouverts. **1/3/4/5/6/7 en cours ; 2 code prêt**, périmètre V1/M8 inchangé.

### 20 octobre — copies d’illustration bornées et conservation hors connexion

Chantiers **6 et 7** : limite de 64 MiB par magasin/compte, mesure des fichiers réels, récupération des anciennes copies via leur manifeste, conservation locale explicite et durable. Les copies protégées et la préparation consultée ne sont pas évincées ; les originaux métier et données/commandes restent intacts. Refus avant téléchargement si la place manque, reprise des transferts partiels, changement de compte et copie endommagée couverts. SQLite 59 prolonge la table existante ; aucune nouvelle synchronisation ni autorisation payante. Voir `../qa/STORE_LAYOUT_ILLUSTRATION_CACHE_2026_10_20.md`.

**1/3/4/5 en cours ; 2 code prêt ; 6/7 en cours.** Ce lot sera livré dans un prochain ensemble cohérent. Génération/quotas d’essais et décision de coût, worker durable, activation du fournisseur et recette magasin/iOS/Android restent à couvrir ; aucun critère V1 n’est retiré ni déclaré satisfait par la seule CI.

## Lot courant — confirmation et traitement d’une illustration (20 octobre 2026)

Chantiers **6 et 7** : devis privé signé valable cinq minutes, décision SQLite/Outbox, admission idempotente et réservations transactionnelles par journée UTC, appel unique par décision puis récupération du même original. Les plafonds limitent les confirmations et leur estimation ; ils ne garantissent pas la facture fournisseur. Suivi/restauration via la synchronisation canonique, progression reçue avant ACK conservée, refus ciblés et comparaison précédente préservée pendant un téléchargement interrompu. Aucun nouvel agent, prompt global ou cron. Activation désactivée, modèles et coût réel non choisis, aucun appel IA payant ni build EAS. QA et portes encore ouvertes : `../qa/STORE_LAYOUT_ILLUSTRATION_GENERATION_2026_10_20.md`. Les sept états restent **1/3/4/5/6/7 en cours ; 2 code prêt** ; ni livraison ni acceptation sur appareil ne sont présumées.

## Lot courant — accepter une suppression du référentiel déjà synchronisée (20 octobre 2026)

Chantiers **1 et 7** : un produit, code ou alias dont la version synchronisée est supprimée peut être comparé puis accepté explicitement, sans réactivation ni nouvel envoi. Valeurs locales/distantes et anciennes commandes conservées sur cet appareil, compteurs actifs nettoyés par le mécanisme existant, reprise après redémarrage. Une absence distante, une identité réaffectée ou une version plus récente ne vaut pas preuve de suppression et reste bloquante. QA : `../qa/M7_CATALOGUE_DELETION_CONFLICTS_2026_10_20.md`. Code en contrôle, pas encore livré ; aucune clôture du CRUD/conflits ni du chantier UX. Les sept états restent **1/3/4/5/6/7 en cours ; 2 code prêt**.

Retour utilisateur consigné : « Le slide fonctionne 👍 » valide le défilement horizontal des tableaux sur l’iPhone. Le numéro de build installé n’a pas été confirmé dans ce retour ; copie, sources, clavier, autres gestes et Android ne sont pas présumés validés. Les preuves sont conservées dans les artefacts de recette.

### 20 octobre — suppression locale conflictuelle du référentiel

**1 Actions/conflits et 7 UX/validation : en cours.** Comparaison explicite des fiches/codes/alias : maintenir la suppression locale prépare un unique DELETE canonique sur la version distante exacte ; annuler adopte la version synchronisée sans nouvel envoi. Consentement de ce choix distinct de la comparaison et des réactivations ; historique/anciennes commandes conservés, pas de cascade ni de modification des observations. Le contrôleur utilise des consentements nommés plutôt qu’une suite de booléens. Recette du vrai composant sur états SQLite synthétiques à 320/390 px et tests fichier fermé/rouvert/rollback ; six scénarios Mongo supplémentaires doivent passer dans les CI transactionnelles. QA : `../qa/M7_CATALOGUE_LOCAL_DELETION_CONFLICTS_2026_10_20.md`. CI finales et livraison/acceptation native restent nécessaires. **1/3/4/5/6/7 en cours ; 2 code prêt** ; aucune fermeture de V1/M8 ni consommation fournisseur/build supplémentaire.

### 20 octobre — M8-T03, conservation à travers les versions SQLite

**7 UX/validation : en cours.** 60 versions exercées par le vrai moteur de migration, 59 interruptions/rollback/reprise et 7 SIGKILL avant COMMIT puis récupération WAL : 126 scénarios ciblés locaux passés. Commandes/identités, tentatives, fichiers et octets, conflits, curseurs et compteurs conservés ; reprise des envois interrompus avec les mêmes UUID et sans toucher un autre magasin. Aucun défaut trouvé dans ce périmètre, aucune modification runtime ou migration ajoutée. QA : `../qa/M8_SQLITE_UPGRADE_PRESERVATION_2026_10_20.md`. CI finales, mise à jour réelle iPhone/Android, corruption/backup/restauration et autres portes V1/M8 restent ouvertes. **1/3/4/5/6/7 en cours ; 2 code prêt.** API `ace4c3e`, iOS 5 `1e7684d` inchangés ; aucun déploiement ni build payant.

### 20 octobre — reprise de démarrage après corruption locale

**7 UX/validation : en cours.** Conservation vérifiée du triplet SQLite avant fermeture, isolation privée de l’ancienne copie, nouvelle base migrée après confirmation, reconnexion et bootstrap canonique. Les erreurs de verrouillage/IO/disque/migration ne déclenchent pas de remplacement. Les modifications non envoyées restent conservées et explicitement hors des compteurs de la nouvelle base ; récupération de leurs métadonnées et ré-enregistrement propriétaire restent ouverts, tout comme la recette native/M8. Tests sur vrais fichiers SQLite et vrais octets, ports Expo/SecureStore simulés et composant réel revu à 320/390 px. QA : `../qa/M8_LOCAL_DATABASE_RECOVERY_2026_10_20.md`. Code en vérification, non livré ; API/binaire inchangés, aucune consommation fournisseur/EAS. Les sept états restent **1/3/4/5/6/7 en cours ; 2 code prêt**.

### 20 octobre — conservation native des fichiers avant restitution

**3 Documents, 6 Implantation et 7 UX/validation : en cours.** Les membres ZIP, bundles de tickets multiphotos, originaux téléchargés et copies d’illustration attendent leur déplacement natif avant de fournir une URI finale ou de nettoyer leur temporaire. Les originaux et illustrations revérifient l’autorité après installation. Quatre reproductions échouent sur le runtime précédent ; 76 tests ciblés passent avec le correctif, dont quatorze nouveaux cas. Aucun contrat, migration, prompt IA, envoi ou publication ajouté. QA : `../qa/M8_NATIVE_FILE_RELOCATION_2026_10_20.md`. Code en vérification, non livré sur téléphone ; recette native et autres portes M7/M8 ouvertes. Les états restent **1/3/4/5/6/7 en cours ; 2 code prêt**.

PR 314 précédente fusionnée : deux CI finales vertes sur `5914566` (3 687 tests / 6 ignorés chacune), branches supprimées, API et binaire inchangés. L’isolation au démarrage ne clôture pas la récupération des données non envoyées.

Le contrôle ultérieur de `master` pour PR 314 a échoué sur le délai unitaire de 5 s du scénario d’intégration de reconstruction de deux bases. Le lot courant porte ce seul délai à 30 s, assertions inchangées, et le soumet aux contrôles complets du commit final. Aucun délai de l’application n’est allongé.

## Priorité incident — 22 octobre 2026 : imports, sauvegardes et synchronisation

Le retour utilisateur (ralentissements après photos/modifications, 93 éléments en attente, imports Mercalys en échec et chiffres absents) suspend les ajouts fonctionnels au profit de la stabilisation. Le lot réduit les écritures catalogue inchangées, limite la publication aux sources concernées, isole la réparation historique et empêche le chevauchement de cycles complets de synchronisation. Il ajoute des diagnostics locaux/Sentry sans données métier et un test de conservation exacte après échec d’une correction d’import. Voir [preuves et limites](../qa/M8_IMPORT_STABILITY_2026_10_22.md).

Chantiers **3 Documents** et **7 UX/validation**, avec M8 : progression de fiabilité, sans clôture. Les sept états restent 1 en cours / 2 code prêt / 3 en cours / 4 en cours / 5 en cours / 6 en cours / 7 en cours. La capture comporte également un filtre produit et une période en 2025 ; la disparition réelle des observations et l’hypothèse de quota Inngest ne sont pas démontrées. Recette native, contrôle de l’historique local/distant et résolution complète de l’incident restent nécessaires. Aucun effacement/rejeu de données utilisateur n’est effectué. Code et livraison/acceptation restent à distinguer.

## Stabilisation mesurée — navigation Produits, 22 octobre 2026

La PR 316 est fusionnée en `84e1e44` (deux CI finales vertes), sans livraison native à ce stade. Julien confirme le filtre dans Analyses et recentre le blocage sur la dégradation progressive des navigations/sauvegardes. Le lot suivant reproduit la rétention des écrans avec l’Expo Router installé et les hooks React/SQLite réellement montés : 301 écrans/abonnements de galerie après 100 cycles avant correction, contre un seul au retour liste sur 500 cycles corrigés. Au même jalon de 100 cycles, les appels SQL passent de 110 661 à 7 211. Les retours retrouvent les écrans existants et les galeries masquées cessent de relancer leurs lectures. Les détails, contraintes et mesures sont dans [le compte rendu](../qa/M8_PRODUCT_NAVIGATION_STRESS_2026_10_22.md).

Chantier **7 UX/validation** et M8 : cause cumulative reproduite, correction et endurance locale ; recette native restant obligatoire. Les sept états restent 1 en cours / 2 code prêt / 3 en cours / 4 en cours / 5 en cours / 6 en cours / 7 en cours. Aucun chantier n’est clôturé par les seules mesures Node. Le lot sera regroupé avec les corrections d’import dans un seul build de recette, sans nouvelle dépense IA ni redéploiement API.

## 22 octobre — tickets locaux lisibles pendant la synchronisation

Le propriétaire confirme une nette amélioration de navigation sur le build 6, mais signale 16 éléments en attente et la liste Casse bloquée sur « Lecture des tickets… ». Le défaut reproduit de la route est corrigé : lecture SQLite indépendante du statut réseau, résultat conservé pendant les transitions de synchronisation, lectures lentes partagées plutôt qu’empilées, isolation au changement de compte/magasin. Six tests montent la route réelle. Le détail des 16 éléments reste demandé ; aucun effacement/rejeu ni résolution de ce second problème n’est présumé. Voir `../qa/M8_RECEIPT_LOCAL_READ_2026_10_22.md`.

Chantiers 3 Documents et 7 UX/validation, avec M8 : fiabilité en cours. Les sept états restent 1/3/4/5/6/7 en cours et 2 code prêt. Correction en vérification, sans nouveau build EAS ni déploiement API ; prochaine recette native groupée après diagnostic des éléments en attente.

## 23 octobre — calculs locaux indépendants du réseau

La capture précise le blocage : **17 calculs d’indicateurs locaux et une commande à envoyer**, et non 18 envois distants. Le fournisseur réel reproduit l’attente des calculs derrière le réseau ; le correctif fait avancer le même ordonnanceur local avant et pendant cette attente, avec notifications de progression. Sur 17 tâches recouvrant 600 couples produit/date, 10 217 transactions de projection deviennent moins de 100, sans changer les formules ni effacer les tâches. Les requêtes JSON de synchronisation ont un délai par requête, conservent les commandes à la reprise et exposent leur code sûr si nécessaire. Voir [preuves et limites](../qa/M8_LOCAL_ANALYTICS_BACKLOG_2026_10_23.md).

Chantier **7 UX/validation**, avec M8 : stabilisation en cours ; **1/3/4/5/6/7 en cours, 2 code prêt**. PR 318 est fusionnée mais non incluse dans le build 6 ; ce lot doit être regroupé avec elle dans une seule recette native après contrôles complets et deux CI finales vertes. L’hypothèse Inngest n’est pas démontrée. La correction du code ne vaut ni livraison sur téléphone ni acceptation ; aucun chantier complet n’est clôturé.

## 23 octobre — imports Mercalys et accès aux corrections

Le parcours devient **Imports → lot → fichier**, avec feuilles natives, historique nommé/daté, recherches, pages bornées et retour au même contexte du lot. La comparaison n’est plus limitée aux vingt premières différences ; les ambiguïtés exposent leurs motifs et les produits se confirment dans une section dédiée. Les publications partielles reconnues comme doublons restent visibles et réutilisent la reprise canonique des seules lignes restantes. Les chevauchements demandent toujours une décision explicite sur une comparaison sûre. Voir [preuves et limites](../qa/M8_MERCALYS_IMPORT_NAVIGATION_2026_10_23.md).

Chantiers **3 Documents** et **7 UX/validation**, avec M8 : en cours. Les sept états restent **1/3/4/5/6/7 en cours, 2 code prêt**. Le lot exact `21102026.zip` du téléphone n’a pas été inspecté directement ; la reproduction locale ne prétend pas avoir résolu tous ses motifs. Code contrôlé localement, distinct de la fusion, du futur binaire et de la recette iPhone. Le build 7 contient les correctifs précédents, pas cette nouvelle navigation ; aucun chantier complet ni critère V1 n’est clôturé.
