# M7/M8 — recette native groupée V1, iOS build 14

Chantier actif : **7 — UX et validation**. Aucun scénario ci-dessous n'est déclaré accepté sur appareil par ce document. L'ancien incident d'analyse doit être rejoué sur la version identifiée ; son message historique ne prouve pas une nouvelle régression. Cette recette ne lance ni build supplémentaire ni appel IA automatique.

## Identifier la version avant de commencer

| Élément                         | Version identifiée                                                                                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API compatible                  | `4941513bc28de0a0f8494f88575c0e531dc7d0aa` ; `dpl_J8GundEHU4dF1yEg4Fv5XSwyhKzR` ; `https://fl-copilot.vercel.app`                                                                                        |
| Source du lot natif             | `7e46885af8a1253911bfea0718cc21e6524a48a0`, PR 337–343 ; contient aussi PR 328 et les compléments du build 13                                                                                            |
| Binaire                         | iOS **0.1.0/build 14 terminé et disponible**, profil staging interne ; [suivi EAS](https://expo.dev/accounts/julesmoulis/projects/fruits-vegetables-copilot/builds/eabbf760-49d8-4161-9e40-e16a63f02403) |
| Contrôles automatiques          | CI push/PR finales et merge master réussies ; 4 029 tests passés / 6 ignorés sur chaque CI de PR ; exports iOS/Android verts                                                                             |
| Date/appareil/résultats de test | **À renseigner par la recette** ; iPhone Air pilote, Android séparément                                                                                                                                  |

Installer le binaire identifié **par-dessus l'app existante** ; ne pas désinstaller/réinitialiser. Build 13 est conservé pour retour arrière. Aucune migration SQL n'a été ajoutée entre les builds 13 et 14. L'API conserve les anciennes capacités ; le nouveau client annonce la capacité catalogue 2. Un retour arrière ne doit pas supprimer DB, originaux, copies ni commandes en attente.

## Priorité du lot 337–343

- [ ] Réimporter la version corrigée de `21102026.xlsx`, examiner puis appliquer avec les identités attendues : deux pommes de terre micro-ondes distinctes, deux libellés BIO vers le même produit. Revenir au lot sans perdre la position puis réessayer sans doublonner les observations.
- [ ] Enregistrer quelques corrections métier réelles de produits et enchaîner liste → fiche → édition → retour, pendant la sync et hors connexion. Contenu, filtres, saisies et position doivent rester utilisables. Les corrections d'une fiche inactive via le copilote, si un vrai cas existe, gardent ce statut ; ne pas fabriquer une fiche de production pour remplir le test.
- [ ] Rechercher/filtrer les PDF et parcourir les pages de dix cartes, consulter un original puis revenir. Consulter dans Actions les choix/réalisations réellement enregistrés et leur chat d'origine ; un choix accepté ne devient pas une réalisation.
- [ ] Fermer/réouvrir l'app hors connexion avec une session précédemment authentifiée : données/commandes locales disponibles. Un renouvellement réseau bloqué n'empêche pas le contenu local vérifié de s'ouvrir. En cas de vraie erreur du stockage sécurisé, « Réessayer » conserve données et accès ; ne pas provoquer un défaut OS sur l'unique installation de travail.
- [ ] Synchronisation → Copies locales : créer, vérifier, puis annuler la reprise sans bascule ni déconnexion. Tester la confirmation/redémarrage/reconnexion seulement sur une installation de test ou après protection/vérification des données de travail ; vérifier la copie choisie et l'ancienne base séparée, avec les mêmes IDs et sans perte des écritures plus récentes. Voir [la recette de copies](M8_LOCAL_DATABASE_COPIES_2026_10_24.md). Création/annulation seule n'est pas une restauration complète.
- [ ] Si les rappels ont été volontairement activés, vérifier un rappel réel au premier plan/en arrière-plan et son ouverture locale, selon les permissions/Focus du téléphone. Un autre contexte ou une déconnexion ne doit pas exposer son contenu.

## Parcours prioritaires

### 1. Conversation vide et historique

- [ ] Ouvrir une nouvelle conversation : l’accueil « De quoi avez-vous besoin ? » et sa suggestion sont visibles, sans créer de message artificiel dans l’historique. Le champ « Écrivez au copilote… », l’ajout de fichiers et l’envoi restent utilisables.
- [ ] Écrire un brouillon, changer de conversation puis revenir : le texte est conservé.
- [ ] Fermer et rouvrir l’application : brouillon et anciennes discussions restent accessibles. Les anciens messages restent accessibles.

### 2. Rejouer le problème d’analyse

Dans la discussion concernée, demander :

> Peux-tu comparer les ventes et la marge de novembre 2024 et novembre 2025 sur les journées disponibles, puis me donner les principaux points à examiner ?

- [ ] La réponse porte sur les deux périodes demandées, avec chiffres sourcés, tableau si utile et limite de couverture compréhensible.
- [ ] Les données du 1er au 20 de chaque mois, constatées lors du diagnostic du 19 octobre, permettent une comparaison partielle ; leur disponibilité réelle doit être relue au moment du test. Le copilote ne présente pas un mois complet si les autres jours manquent et ne redemande pas systématiquement les fichiers déjà publiés.
- [ ] Une nouvelle réponse ne remplace pas la demande par le bloc « L’analyse du copilote est momentanément indisponible », « Faits disponibles » et le bilan quotidien d’octobre avec AVAILABLE/UNAVAILABLE. En cas de panne, le secours est bref, sans chiffres hors sujet.
- [ ] Le texte arrive progressivement et les étapes d’outils apparaissent. Une relance courte (« Et quels produits contribuent le plus à cet écart ? ») conserve le contexte et distingue les faits des hypothèses.
- [ ] Les anciens blocs déjà enregistrés appartiennent à l’historique : vérifier une nouvelle réponse après livraison, sans les confondre avec un nouvel incident. Si une panne survient, conserver l’heure et la question. Le diagnostic serveur doit donner une cause exploitable avant de déclarer l’incident résolu. Voir [la recette de fiabilité](M7_CHAT_RELIABILITY_SCENARIOS.md).

### 3. Un lot Mercalys depuis le chat

- [ ] Joindre plusieurs fichiers ou un ZIP ventes/casse et demander leur traitement : suivi par fichier, périodes et canaux distincts, succès déjà acquis conservés.
- [ ] Les lignes sans doute suivent la publication autorisée existante ; seules les ambiguïtés ou corrections significatives demandent une décision ciblée.
- [ ] Les fichiers publiés sont identifiables. Examiner un fichier puis revenir conserve la position dans la liste.
- [ ] Reprendre le même fichier ne double pas les chiffres. Une version corrigée qui recouvre des observations existantes demande la réconciliation prévue.
- [ ] Après synchronisation, le copilote retrouve les chiffres publiés pour la période concernée.

### 4. Hors connexion, redémarrage et reprise

- [ ] Sur un produit de test, préparer une modification simple hors connexion : elle reste visible localement et en attente de synchronisation.
- [ ] Fermer et rouvrir l’application : la modification et les originaux d’import déjà confirmés restent disponibles.
- [ ] Revenir en ligne puis synchroniser : la modification est transmise une seule fois, ou un refus/conflit explique l’action nécessaire ; elle ne reste pas silencieusement en attente.
- [ ] Le compteur et l’état affiché correspondent au résultat. Vérifier les alertes Sentry, notamment SQLite verrouillée, après ce parcours.

## Quantités et prix moyens — reprise du dernier sujet réel

Dans un échange réel, demander :

> Peux-tu me donner les dix principaux produits d'octobre 2025 par chiffre d'affaires, avec leurs quantités, unités et prix moyens réalisés, et me dire les limites utiles pour interpréter ces chiffres ?

- [ ] Le copilote consulte les données actuelles ; il ne reprend pas comme vérité la déclaration historique « les outils n'exposent pas les quantités ».
- [ ] Le tableau garde CA, quantité, unité et prix distincts. Quantités totales et prix pondéré utilisent les journées exploitables correspondantes ; une quantité partielle n'est pas le dénominateur du CA du mois complet.
- [ ] HT/TTC non confirmé et éventuelles unités/données manquantes restent qualifiés. Le prix moyen encaissé n'est pas un historique des prix affichés.
- [ ] Sources, défilement horizontal, streaming et copie de message fonctionnent. Les figures et la couverture attendues sont celles relues au moment du test, pas des montants copiés d'un ancien message.

## Parcours complémentaires selon les données disponibles

### 5. Casse et correction de produit

- [ ] Un ticket long en plusieurs vues produit un seul ticket avec ses originaux, une date française à confirmer et le champ caissier ; les ambiguïtés de lignes restent corrigeables.
- [ ] Le choix d’un produit associé débloque la ligne sans exiger une campagne de complétion du référentiel hors des données indispensables à la casse.
- [ ] Dans le chat, demander sur un produit de test une modification de catégorie, nature et unité : la proposition présente les trois champs, la confirmation les conserve et la synchronisation les retrouve. Le texte de l’IA seul n’est pas une preuve de modification.

### 6. Conseil, décision et réalisation

Utiliser un conseil et une action réellement pertinents, ou un compte de test ; ne pas déclarer une réalisation fictive dans l’historique opérationnel.

- [ ] Accepter, modifier, reporter ou refuser un conseil conserve le choix sans déclarer l’action exécutée.
- [ ] Si une action a réellement été réalisée, sa déclaration séparée garde les détails connus et son origine, y compris après redémarrage et synchronisation.
- [ ] Demander son bilan sur des périodes explicites : observations sourcées, état déclaré distingué du résultat, absence d’affirmation causale automatique. Une lecture devenue différente exige une actualisation plutôt qu’une preuve de validité périmée.
- [ ] Si aucun cas réel n’est disponible, marquer ce scénario « non testé », pas « validé ». Voir les recettes détaillées de [décision](M7_RECOMMENDATION_DECISION_SCENARIOS.md), [réalisation](M7_ACTION_EXECUTION_SCENARIOS.md) et [contexte](M7_FACT_CONTEXT_SCENARIOS.md).

### 7. Usage quotidien du chat

- [ ] Copier un message ; ouvrir son menu par appui long ; supprimer un message de test.
- [ ] Balayer une conversation de test vers la gauche pour la supprimer : la bonne conversation disparaît, les autres et leurs brouillons restent présents.
- [ ] Retrouver une préférence explicitement mémorisée dans une autre conversation ; ne pas confondre mémoire confirmée et contenu privé d’un autre utilisateur.
- [ ] Depuis une discussion commerciale, ouvrir le PDF original et revenir sans perdre le fil. Une hypothèse de contre-promo demande les données utiles manquantes et reste une simulation, pas une prévision de ventes.

## Retour attendu et critère de sortie

Pour chaque parcours : **OK / bloqué / non testé**. En cas de blocage : action effectuée, heure, résultat attendu et message/capture visible. Les identifiants techniques sont retrouvés dans les logs ; aucun secret n’est à copier dans le chat.

La comparaison réelle doit réussir avant de clore l’incident. Un crash, une perte de donnée, un doublon de publication ou un échec sans diagnostic empêche la validation du parcours concerné. Ce lot ne termine pas M7 : les sept critères du [suivi](../progress/M7_WORKSTREAM_STATUS.md) restent la référence. L’implantation complète (chantier 6, en cours) et les autres manques de l’inventaire ne sont pas présentés comme livrés par cette recette.

## Portes distinctes qui restent ouvertes

La recette iPhone ne vaut pas recette Android ni seconde installation. Le vrai mail de développement a été reçu mais son original est bloqué par les droits de clé ; le correctif est déployé, l'accord de clé Full access dédiée et le traitement authentifié restent nécessaires. Plan de référence non mesuré, mobiles non renseignés et illustrations non activées ne sont pas des résultats physiques. Les sauvegardes/restaurations distantes et OS, notifications, accessibilité, performances/réseau et les autres portes M8 gardent leurs preuves propres. Les exceptions de parité encore refusées, notamment plusieurs conflits de la même entité, ne sont pas annoncées résolues par ce build.
