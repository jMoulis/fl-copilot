# M7 — corrections de casse conservées et accessibles

## Parcours

Le détail d’un ticket est isolé par magasin/utilisateur/UUID et lit le magasin actif. Lecture initiale en erreur, ticket absent et contenu déjà affiché sont distingués ; une erreur ne boucle plus sur un chargement sans action. L’actualisation conserve la saisie. Les photos originales restent disponibles dans une section repliable ; elles ne monopolisent plus le haut du formulaire.

Les groupes sans problème peuvent rester en aperçu : produit associé, nature, poids et quantité d’origine, prix unitaire et montant. Aucun kilogramme/pièce n’est additionné et aucune valeur manquante ne devient zéro. Les occurrences restent séparées et consultables. Les groupes demandant une revue s’ouvrent ; une sauvegarde/association réussie revient à l’aperçu si aucun problème ne subsiste. Les groupes en erreur restent ouverts et les champs surlignés restent les champs du validateur existant.

Le résumé « Champs à corriger » mène à la section correspondante : date, caissier, traitement/doublon ou groupe de lignes. Les coordonnées viennent des événements de layout natifs du contenu du ScrollView ; un rendu en attente attend ses coordonnées, sans délai arbitraire. Le contrôle ne crée aucune donnée et ne publie pas.

Les brouillons de valeurs sont portés par l’écran et indexés par UUID de ligne, avec leur version de départ. Replier/remonter/regrouper une ligne ne détruit plus sa saisie. Les champs restent désactivés pendant leur sauvegarde ; les valeurs doivent être enregistrées ou abandonnées avant de changer l’identité ou l’exclusion de la même ligne. La confirmation date/caissier et la publication ne passent pas pendant une sauvegarde de ligne. Un retour destructif utilise le garde déjà partagé par Produits/Mon magasin.

Un champ de caissier explicitement vidé reste vide : il ne reprend plus la proposition d’extraction lors d’une relecture. Les zéros initiaux sont des caractères, jamais un entier. Un effacement confirmé prime sur la proposition originale. Les choix de date et valeurs de ligne sont conservés si leur enregistrement ou la relecture échoue.

Si le ticket a entre-temps été publié, une ligne retirée, ou le ticket devenu indisponible, les saisies non enregistrées restent consultables/copiables. Un abandon explicite les retire de l’écran, sans toucher aux données enregistrées. Un brouillon d’écran n’est pas présenté comme une sauvegarde durable après arrêt forcé.

## Sûreté de la correction locale

Les modifications de date, caissier, valeurs de ligne, exclusion et identité vérifient désormais l’éditabilité et écrivent sur la même connexion/transaction SQLite. Une publication arrivée avant l’acquisition de la transaction interdit la correction. Les opérations déjà révisées du copilote rejoignent leur transaction existante ; aucune transaction imbriquée n’est ouverte.

L’éditeur manuel fournit une version attendue pour les valeurs et métadonnées. Un snapshot périmé est refusé, la saisie reste affichée et peut être abandonnée/reprise explicitement. Lignes retirées et cibles non disponibles ne sont pas modifiées. Les lectures de lignes/doublons restent dans le magasin du ticket. Les contrats des producteurs déjà révisés restent compatibles et les mêmes moteurs d’arithmétique/validation/publication sont réutilisés.

Une correction de brouillon ne crée pas une nouvelle Outbox avant la publication canonique. Publication, recalcul et synchronisation restent distincts : l’échec d’un travail après commit ne doit plus annoncer que l’enregistrement a échoué. Les états de conflit/refus d’un ticket publié ne sont plus affichés comme une simple synchronisation en attente.

## Preuves

- Suite complète locale `pnpm check` : **2 232 tests réussis, 498 dépendants d’environnements externes ignorés** ; types stricts/lint/format passés. Les tests existants de publication et de correction par le chat passent avec la transaction réutilisée.
- Nouvelles preuves SQLite sur fichier réel : correction avec snapshot courant, refus d’un ancien snapshot, refus d’une date fondée sur un ancien en-tête, caissier vidé conservé après fermeture/réouverture et aucune commande ajoutée. Une publication gagnant la course est simulée avant l’acquisition de la transaction : valeurs/date/caissier/exclusion sont refusés et la ligne canonique reste intacte. Lecture d’un autre magasin refusée.
- Tests d’état de formulaire : version initiale conservée après changement du libellé/regroupement, modification indépendante d’une autre ligne, zéro et effacement distincts, abandon ciblé, retour à la valeur initiale, snapshot changé et caissier vide/confirmé.
- Composants réels `AppScreen`, `ReceiptIssueSummary`, `ReceiptLinePreview` et même hook de navigation contrôlés en web 390 × 844 avec données synthétiques. Clic de correction de ligne : cible dans le viewport (haut 100, bas 259 px) ; clic caissier : haut 76,5, bas 109,5 px. Aucune erreur console. Captures dans l’espace de travail `artifacts/receipt-review-ux/`.
- Le harnais visuel ne manipule pas une base pilote ni un vrai ticket : il vérifie la présentation/navigation, les transactions sont vérifiées séparément par les tests SQLite. Harnais et serveur retirés, onglet fermé et viewport réinitialisé.
- Exports Hermes et deux CI exactes requis avant fusion ; pas d’appel IA, déploiement ou build EAS payant.

## Portes ouvertes

Recette iPhone/Android : correction réelle, clavier, geste de retour avec annulation, changement de produit après sauvegarde, publication et reprise/synchronisation. VoiceOver/TalkBack et volumétrie réelle restent à accepter. Les autres formulaires, chat, médias, réception Resend, implantation et critères M8 restent ouverts. L’accès manuel à un produit du catalogue hors candidats de la ligne, via le service déjà existant, reste un écart UX à fermer dans le lot suivant ; aucune identité nouvelle n’est inventée ici.
