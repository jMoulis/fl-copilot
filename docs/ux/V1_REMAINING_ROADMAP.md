# Roadmap V1 restante — bilan au 19 octobre 2026

Objectif de Julien : V1 testable pour la présentation du **28 octobre**, avec l’UX intégrée et sans contourner la logique métier. Base examinée : PR 273 / `824cf4c`. Cet ordre est une proposition d’exécution issue de l’audit ; il ne supprime aucun engagement V1 et ne déclare aucun lot livré. Voir `AUDIT.md` pour les arbitrages.

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
