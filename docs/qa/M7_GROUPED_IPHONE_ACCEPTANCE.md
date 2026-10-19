# M7 — recette groupée du prochain build iPhone

Chantier actif : **7 — UX et validation**. Préparation de recette, aucun scénario ci-dessous n’est encore déclaré validé. L’incident d’analyse reste ouvert. Cette liste accompagne la prochaine livraison groupée ; elle ne déclenche ni build EAS ni appel IA automatique.

## Identifier la version avant de commencer

À renseigner lors de la livraison :

| Élément                                  | Version réellement livrée |
| ---------------------------------------- | ------------------------- |
| Commit et identifiant de déploiement API | À renseigner              |
| Commit et identifiant du build EAS       | À renseigner              |
| Date du test et appareil                 | À renseigner — iPhone Air |

L’API compatible, ses migrations et les diagnostics de la PR 261 doivent être livrés avant le binaire et la recette. Une PR fusionnée ne prouve pas que ce code est exécuté. Les tests ci-dessous s’effectuent dans l’application installée ; aucun redémarrage de Metro ne doit être nécessaire pour le build autonome prévu.

## Parcours prioritaires

### 1. Conversation vide et historique

- [ ] Ouvrir une nouvelle conversation : aucun texte d’accueil ni faux message n’apparaît. Le champ « Écrivez au copilote… », l’ajout de fichiers et l’envoi restent utilisables.
- [ ] Écrire un brouillon, changer de conversation puis revenir : le texte est conservé.
- [ ] Fermer et rouvrir l’application : brouillon et anciennes discussions restent accessibles. Le retrait du texte d’accueil n’efface aucun message existant.

### 2. Rejouer le problème d’analyse

Dans la discussion concernée, demander :

> Peux-tu comparer les ventes et la marge de novembre 2024 et novembre 2025 sur les journées disponibles, puis me donner les principaux points à examiner ?

- [ ] La réponse porte sur les deux périodes demandées, avec chiffres sourcés, tableau si utile et limite de couverture compréhensible.
- [ ] Les données du 1er au 20 de chaque mois, constatées lors du diagnostic du 19 octobre, permettent une comparaison partielle ; leur disponibilité réelle doit être relue au moment du test. Le copilote ne présente pas un mois complet si les autres jours manquent et ne redemande pas systématiquement les fichiers déjà publiés.
- [ ] Il ne remplace pas la demande par le bilan quotidien d’octobre.
- [ ] Le texte arrive progressivement et les étapes d’outils apparaissent. Une relance courte (« Et quels produits contribuent le plus à cet écart ? ») conserve le contexte et distingue les faits des hypothèses.
- [ ] Si une panne survient, conserver l’heure et la question. Le diagnostic serveur doit donner une cause exploitable avant de déclarer l’incident résolu. Voir [la recette de fiabilité](M7_CHAT_RELIABILITY_SCENARIOS.md).

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

La comparaison réelle doit réussir avant de clore l’incident. Un crash, une perte de donnée, un doublon de publication ou un échec sans diagnostic empêche la validation du parcours concerné. Ce lot ne termine pas M7 : les sept critères du [suivi](../progress/M7_WORKSTREAM_STATUS.md) restent la référence. L’implantation (chantier 6, à démarrer) et les autres manques de l’inventaire ne sont pas présentés comme livrés par cette recette.
