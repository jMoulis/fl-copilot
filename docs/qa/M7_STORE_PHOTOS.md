# M7/L7 — Photos du rayon dans le copilote

## Parcours et preuves

L’utilisateur choisit **Photos du rayon** dans le chat, conserve jusqu’à trois originaux et son brouillon hors connexion, puis envoie la question. La file commune enregistre l’original privé ; l’agent existant peut ensuite examiner une image JPEG orientée, sans extraction de ticket ni second modèle. Le bouton de la pièce jointe ouvre l’original local vérifié dans une feuille refermable.

- Contrats : type explicite `STORE_PHOTO`, images JPEG/PNG/HEIC/HEIF, 20 Mio/36 Mpx, trois photos par question ; aucun chemin/URL/périmètre fourni par le modèle. Cadre transmis limité à 2048 pixels/2 Mio, EXIF retirés.
- SQLite et fichiers : copie avant transaction ; métadonnées, tâche d’envoi et brouillon atomiques. Redémarrage, annulation, perte de rôle, conversation privée étrangère, capacité déjà utilisée et échec de commit sont exercés. Aucun original ni copie au résultat incertain n’est supprimé ; aucune casse ou observation métier n’est créée.
- Compte : propriétaire persistant dans la tâche, file filtrée, original/brouillon privés, suivi masqué aux autres comptes et jeton contrôlé au moment de l’envoi, y compris après renouvellement. Les listes générales d’originaux Mercalys/PDF ne révèlent pas les photos privées.
- Envoi : parcours réel de la file locale et rejeu sans nouvel envoi ; service d’inscription confirmé/rejoué sans normalisation/extraction/matching de ticket ni job PDF. Aucun appel externe dans ces tests.
- MongoDB : inscription puis lecture sur base jetable réelle ; avant confirmation, autre utilisateur/magasin et retrait de source refusés. Lecture de vrais octets PNG convertis en JPEG, portée et empreintes vérifiées.
- Adaptateur IA : transport Responses simulé avec **contenu image réel**, depuis les sources jointes et l’historique, avec et sans découverte différée des outils. Les pixels restent hors messages persistés/journal JSON, une preuve de disponibilité `QUALITY` est retournée. La règle existante de refus de chiffres non étayés reste testée.
- Bornes : faux format, empreinte modifiée, fichier trop grand, limite de pixels, EXIF/orientation, annulation, retrait pendant lecture et quatre lectures parallèles sont couverts.
- Original local : lecture vérifiée sans écriture de métadonnées, y compris URI de conteneur déplacé ; original manquant/modifié, mauvais MIME, référence rompue, retrait concurrent ou pixels excessifs refusés.
- Rendu : composant réel du panneau de chat en React Native Web, 390×844. Menu distinct de la casse/PDF/Mercalys, erreur de taille française, brouillon conservé, retour de focus et aucune erreur console. Fixture isolée, aucun compte/base/Sentry/appel IA ; fichiers de preuve conservés hors dépôt et route de test retirée avant export.

Le nouveau type n’est pas ajouté aux agrégats de bootstrap/pull : les sources d’upload restent dans leur canal existant, sans nouveau message de synchronisation imposé aux anciens binaires. L’outil photo est négocié explicitement avec `x-copilot-store-photos`; le contrat de tour reste fondé sur les mêmes identifiants. La restauration distante de l’original et de son manifeste demeure en L8, pas démontrée par la lecture Mongo ou la restauration locale.

## Commandes de validation

- `pnpm check` : structure, lint, TypeScript et suite sans Mongo.
- `TEST_MONGODB_URI=<replica-set-local-jetable> TEST_MONGODB_TRANSACTIONS=true pnpm exec vitest run --maxWorkers=2` : Mongo réel, dont le nouveau parcours `store-photo.integration.test.ts`. Un premier lancement local avec parallélisme illimité a saturé la création des bases et dépassé des délais de hooks ; les limites du runner sont réduites pour la vérification locale, sans modification des tests ou de la CI.
- `pnpm format:check`, build API/import du bundle et export Hermes iOS/Android.
- Les contrôles exacts push et PR doivent encore réussir avant fusion. Réussite locale, fusion et livraison restent trois états distincts.

## Acceptation groupée encore ouverte

Sur le futur binaire/API compatibles : sélectionner de vraies photos (dont HEIC et paysage), annuler le sélecteur, tester les limites, fermer/réouvrir hors connexion, retrouver le brouillon/original, rétablir le réseau et reprendre l’envoi. Demander un conseil sur la présentation, puis un rapprochement avec des chiffres disponibles ; vérifier que les constats sont liés à la photo et que l’agent demande seulement les précisions utiles. Ouvrir/fermer l’original, vérifier VoiceOver/TalkBack et grande taille de texte. Confirmer qu’aucun ticket n’apparaît dans Casse et que l’ancien parcours ticket fonctionne toujours.

La pertinence d’un véritable modèle, les permissions Photos, la mémoire native et le comportement réseau réel ne sont pas validés par un transport simulé ou un navigateur. Aucun appel payant, déploiement ou EAS n’a été lancé. Autres exigences L7, L8, L9, L10 et L11/M8 toujours ouvertes.
