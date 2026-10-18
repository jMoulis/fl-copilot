# M7 — décisions sur les conseils du chat

État : scénarios préparés, non exécutés avec le modèle réel ou sur iPhone. Une fusion ne livre pas la fonctionnalité : API puis binaire compatible sont nécessaires. Ce document ne lance ni déploiement ni build payant.

| Cas                                                     | Attendu                                                                                                                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| « Je retiens cette idée » après un conseil précis       | Carte avec extrait exact et date d’origine, aucun choix présélectionné ; pas d’exécution automatique.                                                |
| Accepter, modifier, reporter, refuser                   | Choix explicite ; formulaire uniquement utile au choix, calendrier français, note facultative. Après enregistrement, résumé compact.                 |
| Hors connexion et redémarrage                           | Conseil/choix/historique conservés. Une seule commande par décision, pas de duplication sur nouvelle pression identique.                             |
| Le même conseil préparé à nouveau                       | Nouveau point de présentation, même suivi/historique ; aucun deuxième dossier pour le même extrait d’origine.                                        |
| Demander au copilote « qu’ai-je retenu ? »              | Lecture privée des choix synchronisés, source et statut qualifiés ; les choix encore locaux ne sont pas présentés comme connus du serveur.           |
| Deux appareils : accepter d’un côté, refuser de l’autre | Deux choix conservés, comparaison sans gagnant implicite ; résolution explicite, nouvelle comparaison si une version arrive entre-temps.             |
| Conseil archivé/retiré ou original non chargé           | Historique conservé, origine qualifiée. Pas de nouvelle validation implicite du contexte ; le serveur vérifie le conseil avant application du choix. |
| Autre compte/magasin et ancienne app                    | Aucun accès à la décision privée ; anciens clients sans capacité ne reçoivent pas d’entité incompatible.                                             |
| Proposition comportant un prix ou une hypothèse         | Le conseil reste une piste non revalidée ; l’accord utilisateur ne publie aucun chiffre ni ne valide sa faisabilité.                                 |

Le test de bout en bout décision → exécution explicite → bilan demeure une étape suivante ; ce lot ne le remplace pas.
