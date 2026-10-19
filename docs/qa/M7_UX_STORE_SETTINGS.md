# M7 — saisie des réglages magasin et erreurs lisibles

## Parcours

Le formulaire Mon magasin conserve la saisie lors d’un retour du plan ou d’un autre écran : une relecture de focus ne remplace pas un brouillon modifié. La lecture initiale doit réussir avant de modifier des valeurs ; une erreur reste distincte d’une proposition de configuration. Le magasin et le propriétaire isolent l’instance du formulaire. Les lectures tardives sont invalidées lors d’une nouvelle lecture ou d’un enregistrement.

Le même garde natif que l’éditeur produit protège le retour destructif et la fermeture web : continuer la saisie ou abandonner explicitement. Une opération en cours empêche une sortie destructrice. Les onglets/push qui conservent l’écran ne suppriment pas sa saisie. La relecture volontaire de valeurs enregistrées confirme l’abandon d’un brouillon et bloque l’édition pendant cette lecture. La saisie non enregistrée reste en mémoire dans l’écran ; sa restauration après arrêt forcé n’est pas ajoutée et n’est pas promise.

Le dépôt vérifie le snapshot d’ouverture dans la même transaction SQLite que les réglages, l’audit et l’Outbox. Un formulaire devenu périmé ne remplace pas une valeur plus récente ; l’erreur est ciblée et la saisie conservée. Les producteurs métier existants gardent leur contrat : cette précondition additionnelle est fournie par l’éditeur. Les conflits et corrections de commandes refusées gardent leurs règles actuelles.

Commune/code postal possèdent un libellé visible et des erreurs françaises. Le choix de zone expose son état coché, sans déduire une zone de la localisation du téléphone. Les états Lecture / Relevé / Enregistrement sont distincts. La localisation reste sur action explicite, à position fixe et sans suivi en arrière-plan ; aucun fournisseur ou accès supplémentaire n’est ajouté.

## Thème

La vérification web de la PR 280 a révélé l’erreur NativeWind « Cannot manually set color scheme … media ». Le moteur installé tente d’appliquer le thème lorsque la feuille arrive : définir `darkMode: class` dans la configuration existante produit le flag requis, sans installer de dépendance ou modifier un outil système. Le vrai composant AssistantAnswer a ensuite ouvert ses sources sans cette erreur ; preuve locale dans l’espace de travail `artifacts/compact-source-ux/`.

Des formulaires existants utilisent `text-danger` et `border-danger`, absents de la nouvelle palette. L’alias `danger` rétablit ces classes avec la même couleur que `critical`, au lieu de laisser des champs/erreurs non stylés sur le fond sombre. La compilation CSS réelle confirme le flag `class dark`, la bordure et le texte RGB(245,155,149). Aucune modification des calculs, de la publication ou des protocoles.

## Vérification et limites

- Test SQLite réel : deux snapshots concurrents, refus du second, réglages et nombre de commandes inchangés après refus ; une relecture explicite permet ensuite la révision suivante. Les tests existants d’atomicité, restauration, conflits, refus et localisation passent.
- Suite locale : 2 227 tests passés / 498 cas dépendants d’environnements externes ignorés ; lint et TypeScript strict passés. Les derniers libellés ont également passé lint/types.
- Le thème web a été contrôlé en démarrage Metro local avec le composant réel des sources. Harnais/serveur retirés et viewport réinitialisé. Cela ne constitue pas une recette de tout le formulaire Mon magasin.
- Export natif et deux CI exactes requis avant fusion. Aucun appel IA ni build EAS payant.

À accepter sur le futur lot natif : modifier une commune, aller au plan/revenir, revenir en arrière par bouton/geste puis annuler l’abandon, relever une position au magasin, annuler une relecture et enregistrer hors connexion. Vérifier VoiceOver/TalkBack et une modification concurrente sur un autre appareil. La configuration synchronisée doit être restaurée après redémarrage ; le brouillon non enregistré n’est pas un enregistrement durable. Les autres formulaires, médias et portes M7/M8 restent ouverts.
