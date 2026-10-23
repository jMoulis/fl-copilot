# Roadmap V1 restante — bilan au 19 octobre 2026

Objectif de Julien : V1 testable pour la présentation du **28 octobre**, avec l’UX intégrée et sans contourner la logique métier. Base examinée : PR 273 / `824cf4c`. Cet ordre est une proposition d’exécution issue de l’audit ; il ne supprime aucun engagement V1 et ne déclare aucun lot livré. Voir `AUDIT.md` pour les arbitrages.

## Point courant — 23 octobre : données et email livrés, finition UX en validation

La livraison iOS groupée **0.1.0/build 12** est terminée sur `6a7fbf4` (PR 328 et 330 incluses) ; son acceptation humaine du réimport et des filtres reste ouverte. Le recalcul distant après correction d’unité est livré et ses observations sources sont conservées. L’API courante est `8f40e0d` ; Resend est configuré sur le domaine de développement fourni par Julien, avec webhook signé et processeur de conservation enregistré. Un vrai email → original → traitement confirmé → conversation et la restauration sur un autre appareil restent à vérifier, sans assimiler la configuration à la recette.

La PR 331 est fusionnée après les deux CI exactes vertes : fraîcheur d’Aujourd’hui après pull, relectures coalescées et qualification directe des cumuls partiels. Elle n’est pas dans le build 12. Le lot suivant réutilise les visuels produit existants sur les priorités/mouvements et conserve la semaine/le filtre d’Actions par magasin/utilisateur ; première lecture locale pendant la synchronisation et rétention du contenu en erreur. Ce lot est en validation, destiné à une livraison native groupée ultérieure sans build payant isolé. Voir `../qa/M7_UX_TODAY_ACTIONS_CONTEXT_2026_10_23.md`.

La PR 332 est fusionnée sur `fc3ee74` après les deux CI exactes vertes (3 885 tests / 6 ignorés), sans nouveau binaire. Le lot suivant reprend la validation Casse : un seul formulaire d’occurrence à la fois, aperçus et corrections progressifs, saisies conservées après repli, blocage de publication inchangé. Le parcours de 140 lignes et 100 changements d’éditeur est vérifié dans la route réelle avec dépôts isolés ; il ne constitue pas une mesure sur téléphone ni une simulation de 100 écritures SQLite. Voir `../qa/M7_UX_RECEIPT_PROGRESSIVE_REVIEW_2026_10_23.md`.

Le premier vrai mail est reçu et rattaché à la conversation ; sa conservation d’original a épuisé les six tentatives et le fichier est `FAILED / PROVIDER_UNAVAILABLE`, sans source créée. Les logs Resend confirment HTTP 401 / `restricted_api_key` : clé serveur limitée à l’envoi. La PR 334, fusionnée en `6e77057` après les deux CI exactes vertes, prépare une clé dédiée à la réception et accepte le format CDN réellement observé ; elle n’est pas encore déployée. L’activation de la clé Full access attend l’accord explicite du propriétaire ; après livraison, la reprise passe par l’action authentifiée existante. Aucun import complet ni restauration n’est encore prouvé. Voir `../qa/M7_RESEND_RECEIVING_ACCESS_2026_10_23.md`.

La finition du formulaire produit est fusionnée en PR 335 (`b8e4332`), non livrée sur appareil : détails optionnels repliables, saisies/codes préservés, focus vers les erreurs et blocage pendant une sauvegarde. Le vrai formulaire a été vérifié à 390/320 points et dans six tests montés ; le clavier et les gestes physiques restent à accepter sur appareil. Voir `../qa/M7_UX_PRODUCT_FORM_2026_10_23.md`. Ce travail ne réduit aucun autre engagement V1.

La lecture des listes/fiches Produits est maintenant en validation pour supprimer les invalidations dues au seul avancement de la synchronisation et aux travaux locaux sans commande. Lecture au focus/retour et après écriture conservée ; scénario de 500 modifications rejoué. Ce sont des mesures SQL dans le banc Node, pas une recette de performance iPhone/Android. Voir `../qa/M8_PRODUCT_SYNC_READS_2026_10_23.md`.

Les cinq domaines UX, formulaires, gestes, parcours documents/casse/réglages et les recettes complètes M7/M8 restent dans le périmètre. Les sections L1–L11 ci-dessous conservent le découpage initial du 19 octobre ; lire leurs anciens statuts avec le journal courant et le suivi des sept chantiers, sans les interpréter comme une liste actuelle de fonctions absentes.

## Ordre des lots et critères de sortie

### L1 — Socle visuel et navigation native — à construire/adaptations importantes

Thème sombre cohérent, en-têtes, champs/boutons, badges/sources, tableaux et feuilles ; cinq domaines natifs avec piles indépendantes. Replacer les parcours semaine/casse/imports/réglages existants sans les perdre. Chat visible, conservation des discussions et des liens. Les gestes sont natifs et possèdent une alternative visible. Dépendance : arbitrages de l’audit. Sortie : navigation réelle, thèmes et retours cohérents avec clavier, données locales et formulaire non enregistré.

### L2 — Périodes et comparaisons métier communes — moteurs existants à compléter

Types Jour/Semaine/Mois/Année, identifiants ISO, déplacements d’une unité, ancrage, sélection N−1, politiques J−7 explicites, couverture/jours clos/importés/fermetures, directions sémantiques des deltas. Tests de fin d’année, 53e semaine, zéro, manquant, mois/année partiels. Mêmes résultats pour chat, KPI et graphiques. Sortie : des périodes exactes et aucune comparaison artificiellement précise. Ce lot ne refait pas les formules déjà validées.

### L3 — Premier parcours Analytics natif — à construire

Semaine → KPI réel SQLite → comparaison semaine ISO N−1 → graphique par jour → Jour → retour exact. État période/métrique/filtres/scroll conservé entre onglets ; valeur disponible hors connexion. Dépendances : L1/L2. Sortie : première tranche de l’UX utilisable sur téléphone, pas une maquette avec données fictives. C’est le premier jalon à livrer pour réduire le risque.

### L4 — Explorer complet — à construire sur L3

Mois et Année, sélecteurs contextuels, année→mois, mois→semaine/jour, filtres catégorie/produit, contributions et détails, couverture lisible, liens profonds depuis Aujourd’hui/chat. Pas de courbe horaire fictive. Mesurer les requêtes locales sur l’historique réel. Sortie : les quatre granularités et les scénarios de navigation/date du ZIP sont validés.

### L5 — Mise en cohérence des écrans métier — fonctions présentes, UX à reprendre

Aujourd’hui : KPI/signes utiles et trois priorités au plus, liens vers analyses contextualisées. Produits : recherche, filtres, liste compacte, détail et accès aux éditeurs/besoins/associations. Actions : tâches, semaine/plan/TG et réalisations séparées des recommandations. Casse/imports/PDF/réglages : entrées stables, présentation progressive, messages ciblés et conservation des formulaires. Chat : adapter la nouvelle identité visuelle sans perdre la simplicité, streaming, tableaux, sources, fichiers et menus. Sortie : parcours complets cohérents, aucune fonction enterrée dans des menus de test ou perdue au changement d’onglet.

### L6 — Bibliothèque visuelle produit — module nouveau

Audit des médias, contrats/migrations minimaux, assets partagés, identités visuelles et liens/overrides produit, hash de déduplication, stockage privé, métadonnées/provenance, revue manuelle, Outbox/sync/cache hors connexion et révocation. Placeholder utile avant enrichissement. Sortie : une image approuvée réutilisable, correction manuelle conservée après réimport/sync et imports jamais bloqués. Recherche sous licence/génération automatique constituent ensuite un sous-lot optionnel contrôlé ; génération désactivée par défaut. Dépendances : L1 et conventions de stockage déjà présentes. Ne bloque pas L3.

### L7 — Copilote métier : fermer les manques réellement constatés — partiellement codé

Vérifier l’inventaire des actions manuelles contre les outils effectivement exposés ; compléter les décisions d’identité contradictoire, corrections et reprises hors périmètre, conflits à cible absente/supprimée/réaffectée. Évaluer les questions et l’expertise shopper/merchandising sur nos cas ; préserver mémoire/compactage, sources et autorisations. Vérifier la prise en charge d’une photo de rayon : ne pas l’envoyer au pipeline ticket de casse par défaut. Sortie : les opérations V1 représentatives se font dans le chat, seules les ambiguïtés pertinentes demandent une intervention ; exceptions explicites plutôt qu’une promesse de CRUD complet non démontré.

### L8 — Arrivée et restauration des sources — partiellement codé

ZIP/fichiers/photos/PDF depuis le chat : vérifier la reprise de bout en bout et la restauration d’originaux/manifests sur un autre appareil. Ajouter la réception Resend autorisée avec originaux, état durable, extraction et retour dans le bon magasin/chat, signatures/expéditeur et déduplication chat/mail ; provisionner réellement l’adresse de réception, sans confondre expéditeur de test et boîte entrante. Les canaux commerciaux, ventes et casse gardent leurs règles de publication/réconciliation. Sortie : fichier reçu→original conservé→données/revue→discussion reprise, même après reconnexion, sans doublon. Dépendances externes/quotas à vérifier avant activation ; pas d’envoi ni de réglage de compte dans cet audit.

### L9 — Recommandation, décision, exécution et bilan — beaucoup de code prêt, recette complète ouverte

Conserver le choix d’un conseil sans déclarer sa réalisation ; réalisation explicite et contexte daté ; bilan avant/pendant/après avec limites et changements de sources. Tester un cas réel, les contradictions entre appareils, le redémarrage et l’invalidation/actualisation des données. Compléter la fraîcheur des dépendances non couvertes. Sortie : une recommandation réelle suivie jusqu’au bilan, sans causalité ni exécution inventée. Dépendance : livrer les lots déjà prêts et L7 pour les manques constatés.

### L10 — Implantation et illustration liées — socle avancé, complément important

Référence physique, schéma et lien commercial existent. Restent illustration ancrée à cette même référence/scénario, provenance/cache, activation fournisseur et budget, contraintes physiques manquantes, édition structurée de l’inventaire fixe/TG, gestes/retouches et réparations utiles, pilote avec mesures réelles. Conserver deux îlots de huit éléments, trois TG et les mobiles présents seulement où déclarés. Sortie : scénario faisable ou limites clairement identifiées, schéma/illustration traçables, aucune dimension/capacité inventée, validation en rayon. Dépendance : L1 pour l’intégration visuelle ; ne bloque pas L3.

### L11 — Livraison, fiabilité et acceptation V1 — ouverte, pas un simple bouton de build

Reprendre l’incident de comparaison dans le chat avec la version réellement déployée ; livrer l’API compatible puis le binaire autonome et identifier leurs SHA. Recette iPhone complète : import→analyse→échange→correction→plan→décision/réalisation→bilan, avec UX finale. Regrouper les builds EAS selon de vrais besoins de test et garder un retour arrière. Inclure les contrôles M8 pertinents : matrice réseau/redémarrage, conflits deux appareils, migrations et restauration de DB/fichiers, sécurité/accès/URLs, cache et stockage, performance, accessibilité iOS/Android, suivi Sentry/sync/jobs et sauvegarde/restauration. Valider Android séparément pour annoncer une V1 multiplateforme. Sortie : zéro défaut bloquant du parcours présenté, versions livrées identifiées, données récupérables et validation humaine consignée. Les garanties M8 non exercées restent ouvertes et ne sont pas annoncées acquises.

## Correspondance avec les sept chantiers M7

1. **Actions/conflits — en cours :** L7, et validation L11.
2. **Contre-promo — code prêt :** intégrer L5 puis dialogue réel L11 ; coût connu et simulation distincte d’une prévision.
3. **Documents — en cours :** L8, parcours natifs L5 et recette L11.
4. **Expertise — en cours :** évaluation/compléments L7 et cas réels L11.
5. **Recommandations — en cours :** L9 et recette L11.
6. **Implantation — en cours :** L10 et recette L11.
7. **UX/validation — en cours :** L1 à L6 et L11. La bibliothèque produit est un sous-chantier UX/media ajouté par le ZIP, distinct de l’illustration d’implantation ; l’Explorer complète le périmètre Analyses initial.

Ces onze lots ne représentent ni onze PR, ni onze journées. Les lots de finition visuelle réutilisent beaucoup de fonctions ; Explorer, politiques ISO, bibliothèque visuelle et réception mail nécessitent du développement réel. Ne pas masquer ces travaux dans un pourcentage global de M7.

## Jalons du 28 octobre : proposition de pilotage, pas promesse de livraison intégrale

- **19 octobre :** audit présent et arbitrages. Aucun changement de l’application.
- **20–21 :** viser L1/L2 et la tranche L3 suffisamment complète pour une première recette native. Relever le débit et les défauts réels avant de confirmer le reste du calendrier.
- **22 :** point de contrôle explicite sur le périmètre complet V1 et la date. Si l’écart reste trop grand, l’annoncer ce jour-là avec les fonctions concernées ; ne pas attendre le 27, et ne pas retirer une fonction silencieusement.
- **23–25 :** cible d’intégration Explorer complet/écrans et corrections des parcours déjà codés ; livraison groupée selon état réellement vert. Les autres lots V1 restent visibles et leur statut doit être communiqué, pas présumé terminé.
- **26–27 :** réserver une fenêtre de stabilisation et répétition sur la version installée. Ce sont des dates cibles dépendant du premier jalon, pas des engagements démontrés.
- **28 :** présentation. Seul le périmètre réellement livré et testé est annoncé comme fonctionnel.

Le calendrier précédent était trop affirmatif au regard de l’UX restante. La stratégie d’accélération consiste à réutiliser les moteurs/référentiels, éviter une réécriture et les couches d’orchestration supplémentaires, avancer par parcours visibles et détecter les écarts tôt. L’UX du ZIP adaptée au produit fait partie de la V1 ; M8 et les tests ne sont pas court-circuités.

## Directive de continuité — objectif persistant confirmé le 19 octobre

Julien confirme que le mode autonome porte sur la **roadmap V1 complète**, augmentée des arbitrages UX. Aucun module du copilote, canal documentaire, bibliothèque visuelle, illustration, contrôle métier ou critère de validation n’est retiré pour limiter le travail à une démonstration. La présentation du 28 octobre reste une échéance de suivi, sans redéfinir la réussite en une V1 réduite.

Les sept chantiers M7 restent le suivi de référence. Les onze lots ci-dessus sont une décomposition transversale des travaux restants, pas une roadmap concurrente. Les améliorations UX sont intégrées aux parcours et à la livraison ; elles ne provoquent ni réécriture des moteurs ni abandon des modules métier. Le dernier résultat fonctionnel fusionné est la PR 273 (lien implantation/préparation) ; l’illustration reste ouverte. La branche UX a été préparée, sans modification fonctionnelle à ce stade.

## Avancement après l’audit — incrément PR 274

La PR 274 implémente une première tranche de L1/L2/L3 et les vues monétaires Mois/Année de L4 : thème sombre commun, cinq domaines, entrée chat, Explorer natif local, politiques de comparaison qualifiées, sélection contextuelle, drill/retour et état de présentation persistant. Les formules et agrégats métier existants restent canoniques. Voir `../qa/M7_UX_ANALYTICS_EXPLORER.md` pour les preuves et limites. Cette mise à jour remplace uniquement le constat « branche préparée sans modification fonctionnelle » ci-dessus ; la base de l’audit reste PR 273.

Aucun lot L1–L11 n’est annoncé intégralement validé sur cette seule tranche. La suite UX porte sur les filtres/contributions et les liens vers les périodes depuis Aujourd’hui/chat, puis la cohérence des écrans et les médias ; les chantiers métier/documentaires/implantation et toutes les portes M8 restent conservés. Code testé/compilé ne signifie pas livré ou validé sur téléphone.

## Avancement — périmètres et détails Analytics (PR 275)

L3/L4 avancent avec les filtres catégorie/nature/produit, les catégories et montants produits paginés, les semaines ISO intersectant un mois et les accès contextualisés depuis Aujourd’hui/une fiche. Filtres, pagination et deux défilements font partie du contexte restaurable. Les mêmes sommes/couvertures de produits-jours sont réutilisées avec le moteur du chat, sans remplacer le total officiel du rayon par un détail incomplet. Mesure synthétique et portes restantes : `../qa/M7_UX_ANALYTICS_FILTERS.md`.

Les liens des citations du chat ne sont pas encore branchés : des destinations structurées sont nécessaires, aucun décodage approximatif de prose. Recette native, gestes et conservation des formulaires, L5/L6 et les autres engagements métier/documentaires/implantation/M8 restent ouverts. Aucun lot complet n’est déclaré validé ou livré par cette PR.

## Avancement — sources du chat vers Analytics (PR 276)

L4 avance avec les destinations monétaires structurées : période libre exacte, référence explicite/J−7, somme ou moyenne et périmètre de produits. La citation d’origine reste conservée et la lecture native montre les données locales actuelles. Les producteurs courants sont reliés sans interprétation des libellés ni ajout d’instructions au modèle. Voir `../qa/M7_UX_ANALYTICS_SOURCE_LINKS.md`.

La navigation n’est pas déclarée intégralement terminée : les enrichissements qui feraient dépasser la limite existante du message conservent la source historique sans destination Analytics ; un transport compact compatible reste à terminer avant de clôturer cette porte V1. Recette native, gestes/formulaires, L5/L6, autres chantiers métier/documentaires/implantation et M8 restent ouverts.

## Avancement — catalogue et saisies produit (lot UX suivant)

L5 avance avec recherche locale par libellé/alias/code validé, filtres catégorie/nature/état, liste virtualisée, contexte privé restaurable et fiche consultable séparée de son éditeur. Les fonctions besoins/substitutions/observations restent accessibles. Les lectures de synchronisation ne réinitialisent plus la saisie ; retrait d’écran protégé et comparaison canonique atomique avant écriture. Voir `../qa/M7_UX_PRODUCTS.md` pour les preuves et limites.

Ce lot ne clôt ni L5 ni le chantier UX : autres écrans, familles, médias, gestes et recette native, transport compact des longues sources et autres portes V1 restent ouverts. Aucun build payant ou déploiement n’est déclenché.

## Avancement — Actions et signalements d’Aujourd’hui

L5 avance avec les tâches présentées avant les raccourcis, la semaine ISO sélectionnable et transmise aux plans/préparations, les filtres de tâches et la conservation de la déclaration en cours lors d’un changement de révision du plan. Les compteurs et mutations métier restent existants. Aujourd’hui consulte les signalements locaux réels plutôt que d’annoncer une absence non vérifiée. Voir `../qa/M7_UX_ACTIONS.md` pour le parcours et la recette native encore ouverte. Ce lot ne clôt ni L5 ni M7/M8 et ne déclenche pas de build payant.

Le même incrément corrige la continuité du KPI Casse au PA vers l’Explorer : métrique de coût distincte du prix de vente, calcul et disponibilité partagés avec Aujourd’hui, filtres/contributions cohérents. Les anciennes données sans coût ne deviennent pas zéro. La lecture native de ce nouveau choix reste à accepter avec le lot groupé ; aucun nouveau producteur de citation serveur n’est annoncé compatible avec les anciens clients.

## Avancement — listes et accès aux sources

L5 avance sur Casse (liste virtualisée, recherche date/caissier/note, statuts et filtres), Mercalys (fichiers du lot filtrables selon publication enregistrée, historique repliable, feuille d’examen conservée) et Documents (original accessible depuis la liste, contexte/préparation progressifs et montés). Chargement/erreur/vide et propositions/confirmations sont distincts. Aucun changement des moteurs d’ingestion/publication. Les preuves et limites sont dans `../qa/M7_UX_SOURCE_LISTS.md` ; la recette native et les autres portes V1 restent ouvertes.

## Avancement — transport compact des sources analytiques longues

L4 ferme le défaut de perte des destinations dans les longues réponses pour les clients compatibles : table de présentation privée, ensembles partagés factorisés, mêmes périodes/moyennes/filtres, réception et restauration via l’historique et la synchronisation. Les bornes restent explicites ; un dépassement est refusé au lieu de supprimer un périmètre. Le streaming existant garde ses fragments provisoires ; le message final porte les destinations durables. Aucun prompt ni fournisseur supplémentaire. Preuves et limites : `../qa/M7_COMPACT_ANALYTICAL_SOURCES.md`.

La PR 279 est fusionnée après succès des CI push `39329596397` et PR `39329602292` sur `7470f1e`, merge `28c593b82cdbafa1f7aadd1705d3483e6ec410fc` ; branche distante supprimée. Aucun lot L1–L11 n’est déclaré intégralement livré ou accepté sur appareil. Restent notamment les formulaires/écrans détaillés et le chat L5, médias L6, autres portes métier/documentaires/implantation et M8.

## Avancement — réglages magasin et lisibilité des formulaires (20 octobre)

L5 reprend Mon magasin : saisie protégée au retour, lecture initiale et refus explicites, relecture avec abandon confirmé, isolation magasin/utilisateur, libellés français et sélection accessible de la zone. Le dépôt vérifie le snapshot dans la transaction existante pour ne pas écraser des réglages changés depuis l’ouverture. Le garde des produits est réutilisé ; aucun nouveau modèle métier.

Le même lot répare le thème de développement web NativeWind et les classes d’erreur historiques restées sans couleur depuis le passage au sombre. La preuve compile les classes réelles et contrôle le démarrage du composant de sources ; elle ne vaut pas recette du formulaire natif. QA : `../qa/M7_UX_STORE_SETTINGS.md`. Les autres formulaires, chat, médias, L7–L11 et la recette iPhone/Android restent ouverts.

## Avancement — validation des tickets de casse (20 octobre)

L5 reprend le formulaire réel : photos repliables, aperçus par occurrence, saisies conservées par UUID malgré les regroupements, caissier volontairement vidé et liens du résumé vers les sections bloquantes. La transaction de correction recontrôle l’éditabilité ; les snapshots manuels périmés sont refusés. Une saisie reste consultable lorsque le ticket devient non modifiable. Les états publié/synchronisé/conflit/refus restent distincts. QA : `../qa/M7_UX_RECEIPT_REVIEW.md`.

Le contrôle utilise les mêmes validateurs et confirme que les lacunes du référentiel ne sont pas imposées dans la casse. L’accès manuel au catalogue hors candidats reste à exposer dans ce parcours en réutilisant le service existant ; aucune identité n’est validée par défaut. La recette native, L6 et les autres portes V1 ne sont pas déclarées closes. PR 281 fusionnée après ses deux CI exactes réussies, merge `f0942e173a194a61fe49d191e75f6d57d2221db3`, branche distante supprimée.

## Avancement — catalogue depuis un ticket de casse (20 octobre)

L5 ferme l’accès manuel à tout le catalogue depuis une ligne de ticket, avec recherche locale, aperçu explicite, choix canonique protégé contre les changements concurrents et retour au ticket. La création réutilise le formulaire produit/Outbox et revient à la sélection sans publication ni alias implicite. Les autres saisies restent dans le ticket monté ; un produit incomplet n’impose pas de compléter le référentiel pour la casse. QA : `../qa/M7_UX_RECEIPT_CATALOGUE.md`. La recette native et les autres portes L1–L11/V1/M8 restent ouvertes. PR 282 fusionnée après ses deux CI exactes réussies, merge `dec03803d24e11b75bdbd444adef7f682feec3be`, branches supprimées.

## Retour de recette — fidélité au pack UX (20 octobre)

Le build 0.1.0 / 2 est installé, mais Julien juge la fidélité aux maquettes insuffisante. Les lots L1–L6 et la recette L11 restent ouverts malgré leur socle fonctionnel fusionné. Le chantier 7 reprend en priorité l’aspect natif : composition, densité, hiérarchie des chiffres, cartes, listes, navigation et médias. Les arbitrages d’`AUDIT.md` sont conservés, dont le chat principal conversationnel et l’absence de chiffres inventés.

Un premier lot corrige Aujourd’hui, Analyses, Produits, les surfaces communes et le sélecteur de semaine Actions. La revue utilise les composants réels à largeur téléphone, puis les vérifications automatiques et l’export natif. Voir `../qa/NATIVE_DESIGN_FIDELITY_2026_10_20.md` pour les captures, les interactions contrôlées et les écarts restants. Le binaire installé n’intègre pas encore ce lot ; aucune nouvelle construction EAS ni livraison API n’est lancée pour une seule retouche.

## Fiche produit — complément du lot L5 (20 octobre)

La branche courante replace visuel et lecture métier avant les informations du référentiel. Elle réutilise le graphique et les calculs de l’Explorer, transmet la période/comparaison des liens et conserve un contexte local par produit sans écraser la sélection globale. Identité, codes, alias, image/provenance, conflits, besoins, associations et signalements restent accessibles ; aucun stock ou visuel métier n’est inventé. La première correction PR 289 fait déjà partie du build 3 ; le correctif de tableaux PR 291 et ce nouveau complément sont en attente de livraison native groupée. Le contrôle navigateur/SQLite ne ferme pas la fidélité sur appareil, les autres écrans L5, L10 ou L11. Voir `../qa/PRODUCT_DETAIL_OVERVIEW_2026_10_20.md`.

## Actions — complément du lot L5 (20 octobre)

Liste compacte des tâches du plan, statuts/synchronisation, progression et filtres utilisant le moteur existant ; déclaration dans une feuille, détails facultatifs progressifs, saisie conservée et erreurs visibles dans le formulaire. Les accès semaine/plan/documents restent contextualisés et la gestion reste accessible. Aucune réalisation implicite ni nouvelle action métier. QA : `../qa/ACTION_TASK_OVERVIEW_2026_10_20.md`. Ce complément est postérieur au build 4 (`9c2f66b`, PR 291–301), terminé et disponible ; sa propre recette native reste groupée. Il ne clôt ni L5, ni le cycle de recommandation complet, ni L10/L11/M8.

## Inventaire physique — complément de L10 (20 octobre)

Le mode d’édition complète l’ajout/copie/retrait des îlots et éléments fixes, la composition des TG et les noms de surfaces, avec nouvelles identités, inconnus conservés, mobiles désassociés sans suppression, annulation et historique restaurable. Les dépôts et la synchronisation restent canoniques. QA : `../qa/STORE_LAYOUT_INVENTORY_2026_10_20.md`. La parité de ces nouvelles opérations dans les outils du copilote reste à faire ; manipulation directe, illustration, mesures réelles et recette native/M8 restent ouvertes. Aucun retrait de L1–L11 ni livraison supplémentaire n’est déduit du contrôle local.

L10 continuation — inventory parity: PR 303 is merged, unreleased. New physical add/copy/remove operations are being wired into the existing Copilot draft-review tool with capability negotiation and exact stable-ID replay. This closes the manual-only gap for those operations after delivery/acceptance; direct manipulation, revision-bound illustration and the measured pilot remain open. See `../qa/M7_COPILOT_LAYOUT_INVENTORY.md`.

L10 continuation — direct placement is coded separately from consultation, with unknown-coordinate refusal and the same movement/undo/save engine. Browser interaction is exercised with simulated persistence ports; native pinch/cancellation, performance and pilot acceptance remain open. PR 304 inventory-tool parity is merged, unreleased. See `../qa/STORE_LAYOUT_DIRECT_PLACEMENT_2026_10_20.md`; revision-bound illustration and supplier activation are still required.

L10 continuation — illustration preparation: the canonical input compiler and isolated disabled provider adapter now preserve the exact historical physical/scenario binding, actual source PNG and qualified inventory. Missing floor geometry and collisions refuse generation, and uncertain provider outcomes must not auto-retry. This is not a delivered image feature: durable confirmed intent, budget/attempts, private storage/restoration, native comparison and the measured pilot remain required under the same full V1 scope. QA: `../qa/STORE_LAYOUT_ILLUSTRATION_SOURCE_2026_10_20.md`. API PR 302–305 is delivered at `1e7684d`; iOS build 5 is available and unaccepted.

## 20 octobre — complément L10 : préparation privée durable

La préparation d’illustration conserve le scénario et la révision physique exacte via le flux local-first et une restauration privée paginée. Elle n’autorise aucune génération payante. La feuille du scénario expose les états locaux/synchronisés et les mesures bloquantes, sans nouvelle navigation métier. Revue des composants web à 320/390 px ; CI transactionnelles et recette native restent distinctes. Voir `../qa/STORE_LAYOUT_ILLUSTRATION_PREPARATIONS_2026_10_20.md`. Ce complément est en contrôle, hors API/iOS 5 livrés ; L10 garde génération/budget, assets/cache/comparaison et pilote réels ouverts. Les autres lots et les sept chantiers ne changent pas.

## 20 octobre — complément L10 : fichiers privés et comparaison

Les résultats restent liés à la préparation et à la révision historique : original fournisseur, image de consultation et schéma/données sources conservés distinctement. Reprise d’une conservation interrompue depuis le même original, sans génération de remplacement automatique ; lecture privée et cache local dérivé. La feuille existante compare schéma/image/original, signale les sources modifiées et conserve les images lors d’un échec réseau. Revue web à 320/390 px sur données synthétiques, CI transactionnelles et recette native distinctes. Voir `../qa/STORE_LAYOUT_ILLUSTRATION_FILES_2026_10_20.md`. Ce lot est en contrôle, non livré ; génération/autorisations/budget, transfert durable depuis le fournisseur, limites de cache et pilote réel restent ouverts sous L10/L11. Aucun autre lot ni chantier n’est fermé.

L10/M8 continuation — illustration copies: private preparations and bundles from PR 306–308 are merged, unreleased. The local download cache now adds a 64 MiB store/account limit, LRU recovery and an explicit offline-retention choice in the existing comparison, preserving originals/business state. Evidence and limits: `../qa/STORE_LAYOUT_ILLUSTRATION_CACHE_2026_10_20.md`. Generation authorization/budget reservations, durable worker, approved model/cost activation and real native/store acceptance remain open under the same seven workstreams and eleven UX lots.

## Illustration — confirmation et suivi durables (20 octobre)

L10 progresse avec le devis privé signé, la confirmation locale explicite et les réservations d’estimation limitées par jour, puis un seul appel par décision et la récupération du même original. Suivi et restauration utilisent les mécanismes existants ; l’ancienne comparaison reste disponible si le nouveau téléchargement échoue. Le prix affiché est une estimation configurée et non un plafond de facture. Aucun modèle réel, fournisseur ou paiement n’est activé. Voir `../qa/STORE_LAYOUT_ILLUSTRATION_GENERATION_2026_10_20.md`. Qualité réelle, activation/budget, recette native et pilote mesuré restent requis ; aucun lot V1/M8 n’est déclaré terminé.

## L7/L5 — suppression distante connue dans une comparaison (20 octobre)

Le chat et la comparaison manuelle du référentiel distinguent une suppression prouvée d’une donnée indisponible. Acceptation explicite, conservation locale des versions/anciennes commandes, pas de réactivation ni nouvel envoi ; reprise idempotente et refus des versions plus récentes. Le résumé indique « Supprimé du référentiel » et réutilise le thème sombre. QA : `../qa/M7_CATALOGUE_DELETION_CONFLICTS_2026_10_20.md`. Les autres absences/refus et la recette native restent ouverts ; aucun lot complet V1/M8 n’est déclaré clos.

## L7/L5 — choix après suppression locale du référentiel (20 octobre)

Les deux parcours existants proposent de maintenir ou d’annuler une suppression locale face à une version distante complète et de même identité. Deux consentements distincts : comparaison et conséquence de ce choix ; réactivation éventuelle séparée. Un seul DELETE canonique ou adoption sans envoi, versions conservées sans cascade ni changement des chiffres. QA : `../qa/M7_CATALOGUE_LOCAL_DELETION_CONFLICTS_2026_10_20.md`. Les cibles absentes/réaffectées, refus génériques, recette native et autres critères V1/M8 restent ouverts ; aucun lot entier n’est fermé.

## L11 — preuves de mise à niveau locale (20 octobre)

M8-T03 progresse avec les mises à niveau sur disque depuis les 60 versions, les reprises après erreur et sept SIGKILL avant validation de transaction, en conservant commandes, fichiers, conflits et identité d’appareil. Aucune nouvelle migration ni modification du runtime ; les preuves automatisées ne remplacent pas la mise à jour sur les appareils réels. Corruption/backup/restauration, réseau, performances, accessibilité et autres critères V1 restent ouverts. QA : `../qa/M8_SQLITE_UPGRADE_PRESERVATION_2026_10_20.md`. Aucun lot complet ni chantier M7 n’est déclaré terminé.

## 20 octobre — L11 / conservation avant reprise locale

L’incrément M8-T04 ajoute une reprise explicite de démarrage après corruption SQLite avérée : snapshots DB/WAL/SHM vérifiés avant fermeture, ancienne copie isolée, nouvelle base migrée, sélection durable par installation et reconnexion/bootstrap canonique. Les fichiers et actions non envoyés restent conservés sans replay ni faux compteur de réussite. Les essais automatisés et la revue du composant web ne remplacent pas la restitution des métadonnées récupérables pour le même propriétaire, les tests de corruption native ni la restauration Mongo/Blob. L11, les sept chantiers M7 et le périmètre complet V1 restent ouverts. Voir `../qa/M8_LOCAL_DATABASE_RECOVERY_2026_10_20.md`. Aucun déploiement ni build EAS supplémentaire.

## 20 octobre — L8/L10/L11, attendre les fichiers natifs conservés

Correction des déplacements asynchrones non attendus pour ZIP, tickets multiphotos, originaux privés et copies d’illustration. La restitution attend l’installation, puis recontrôle l’autorité quand elle est fournie ; les sources et résultats déjà conservés ne sont pas effacés par un échec ou une annulation. Quatre reproductions avant correction et 76 scénarios ciblés corrigés constituent des preuves de régression, pas une recette iOS/Android. Voir `../qa/M8_NATIVE_FILE_RELOCATION_2026_10_20.md`. Chantiers 3/6/7 en cours, autres états inchangés, périmètre V1 complet conservé ; aucun build EAS ni déploiement supplémentaire.

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
