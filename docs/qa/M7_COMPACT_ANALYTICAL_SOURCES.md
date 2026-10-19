# M7 — destinations analytiques des réponses longues

## Résultat et contrat

Une comparaison contenant plusieurs citations filtrées sur cent produits pouvait dépasser les 16 000 caractères du message à cause des destinations répétées dans les liens. Le rendu historique retirait alors les destinations Analytics. Le nouveau client conserve une table privée `analyticsDestinations` sur la réponse ASSISTANT ; chaque lien conserve les faits et référence une cible par `analyticsIndex`. Périodes, filtres et ensembles de produits partagés sont factorisés. Les périodes précises, référence N−1/J−7, univers, SUM/AVERAGE et périmètre d’origine ne sont ni recalculés ni élargis.

Ce sont des métadonnées de présentation produites par le serveur, pas un outil/modèle supplémentaire. Aucune instruction ni requête IA n’est ajoutée. La table n’est transmise ni au modèle ni à ses outils ; elle ne modifie pas les empreintes de fraîcheur métier. L’acteur et le magasin restent ceux du message authentifié ; une cible ne peut contenir de magasin, URL, callback ou opérateur MongoDB.

Le texte conserve sa limite de 16 000 caractères. La table est bornée séparément à 16 KiB en longueur JSON échappée ASCII (majorant des octets UTF-8), 96 cibles et 100 produits distincts par ensemble. Un dépassement est refusé : aucune troncature d’une sélection ni suppression silencieuse de cible. Cela ne promet pas de représenter un nombre arbitraire d’ensembles disjoints de cent produits dans une même réponse.

## Compatibilité et persistance

Le client négocie `x-copilot-analytics-destinations: 1` pour le tour, son flux final, l’historique, le bootstrap et le pull. Les anciennes versions gardent leurs sources factuelles lisibles ; le champ inconnu est retiré, y compris lors d’une réponse déjà calculée et rejouée. Les réponses historiques sans table et les anciennes destinations inline continuent à se lire. La projection de suppression des conversations reste indépendante.

SQLite et MongoDB conservent le JSON du même message ; aucune table métier, migration ou Outbox supplémentaire. Une réception enrichit uniquement une table absente d’un message dont tout le contenu/identité est identique. Un autre texte, acteur, horodatage, pièce jointe ou une destination déjà enregistrée différente est refusé. Un ancien retour projeté ne retire pas une table déjà disponible. La réponse et sa table sont reçues dans la transaction existante et survivent à un arrêt/reprise.

Les cartes TOOL dérivées n’héritent pas de la table d’une réponse ASSISTANT. Décisions et déclarations d’exécution continuent à vérifier le contenu métier ; l’enrichissement d’un lien seul ne périme pas un conseil ni ne l’exécute.

Le streaming progressif existant est conservé : texte/activités apparaissent avant le résultat. Les destinations compactes sont garanties sur le message final validé et durable, pas sur chaque fragment provisoire. Aucune étape de réflexion privée n’est exposée.

## Vérification

- Suite complète locale `pnpm check` : 2 226 tests passés ; 498 cas avec dépendances externes ignorés localement. Lint et TypeScript strict passés. Les deux nouveaux tests Mongo transactionnels sont exécutés par la CI avec replica set, sans appel fournisseur réel.
- Reproduction du dépassement historique avec quatre citations et la même sélection de cent produits : les quatre destinations finales se résolvent exactement, y compris moyenne et référence explicite. Univers et filtres null/absents, limites et données interdites couverts.
- Routes HTTP classiques et NDJSON, replay compatible/ancien/inconnu, négociation de toutes les lectures SDK, projection partagée, champs interdits aux rôles USER/TOOL, métadonnées absentes du modèle couverts.
- SQLite sur fichier réel : historique projeté → enrichissement → refus des modifications → ancien replay → fermeture/réouverture, sans nouvelle commande Outbox. Une recommandation enrichie reste acceptée par les contrôles locaux et serveur ; son texte changé est toujours détecté.
- Mongo/CI : tour réel avec fournisseur simulé, carte de question séparée et replay unique ; historique, bootstrap/pull privés, isolation d’un autre utilisateur.
- Build et import du bundle API passés localement. Les exports Hermes et contrôles exacts de CI restent requis sur la tête finale avant fusion.

## Livraison et portes ouvertes

API compatible avant le futur binaire groupé. Aucun déploiement, appel payant ou build EAS lancé. Les vieux messages qui n’ont jamais conservé de destination ne sont pas reconstruits à partir de leur prose. L’acceptation iPhone/Android du lien et du retour à la conversation, les autres parcours UX, médias, réception Resend, implantation et critères M8 restent ouverts. Ce correctif ne clôt aucun chantier M7 entier.
