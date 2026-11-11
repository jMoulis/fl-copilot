# Dépannage du pilote iPhone

Ce guide sert à reprendre une opération bloquée en conservant les données locales. Commence par identifier l’écran et son message ; une erreur d’import, un fichier en attente d’envoi et un calcul local en attente demandent des actions différentes.

## Préserver le travail en attente

Ne désinstalle pas l’app et n’efface pas son stockage pour débloquer une synchronisation. Les modifications non envoyées, les brouillons, les originaux locaux et les copies de sécurité peuvent n’exister que sur cet iPhone. Une déconnexion ne constitue pas une réparation de la base.

Si l’app reste utilisable, ouvre **Actions → Documents, imports et gestion du magasin → Magasin et synchronisation → Voir la synchronisation**. Dans **Copies locales de sécurité → Gérer les copies locales**, tu peux choisir **Créer une copie maintenant**. La copie protège la base et ses commandes sur ce téléphone ; les photos et documents restent à leur emplacement initial. Elle ne remplace pas une sauvegarde en ligne et disparaît avec la désinstallation.

## Une synchronisation ne termine pas

Dans **Synchronisation**, lis le **Détail des éléments en attente**, puis les éventuels codes et refus plus bas. Le nombre global peut inclure des calculs locaux : il ne signifie pas que toutes ces lignes doivent être envoyées au serveur.

- **Modifications à envoyer** : retrouve une connexion, puis lance **Synchroniser maintenant** une fois. Laisse la tentative se terminer avant d’en relancer une.
- **Calculs en échec** : utilise **Reprendre les calculs en échec** si ce bouton est proposé. Il relance les calculs concernés en conservant les sources et les chiffres déjà calculés.
- **Envois de fichiers à suivre** : utilise **Réessayer cet envoi** si proposé. Si l’original local manque, **Retrouver l’original** permet de sélectionner le même fichier ; sa correspondance est vérifiée avant reprise.
- **Modifications refusées** : ouvre la fiche indiquée pour examiner le motif. **Actualiser les refus** relit leur état. **Écarter cet ancien envoi** n’est proposé que pour le cas particulier indiqué par l’app ; ce n’est pas un bouton de purge générale.

Si le chargement ne se termine pas ou qu’aucune action ne convient, relève le code et la référence affichés. N’efface pas les éléments en attente pour faire disparaître le compteur.

## Un conflit ne permet pas de choisir

Ouvre **Conflits à examiner → Examiner**, compare les deux versions et utilise **Relire la comparaison** si la fiche indique que les versions ont changé. Certains types de conflits renvoient vers leur document métier. La synchronisation et une relecture peuvent être nécessaires avant un choix ; des boutons désactivés ne permettent pas de forcer la résolution.

Si le blocage persiste après une tentative de synchronisation et une relecture, relève le message au-dessus des boutons et les versions affichées. N’effectue pas une nouvelle modification dans le seul but de contourner le conflit.

## Un ancien import Mercalys ne s’ouvre pas

Ouvre **Actions → Documents, imports et gestion du magasin → Imports Mercalys**, puis le lot et son fichier. La lecture peut récupérer une copie publiée ou l’original conservé à distance ; cette récupération nécessite une connexion si aucune copie exploitable n’est présente sur l’iPhone.

En cas d’échec, utilise la reprise de lecture proposée dans la fiche. Si l’original reste introuvable, conserve le fichier source initial pour sa récupération. L’échec d’ouverture n’établit pas que les observations déjà publiées ont disparu. Ne remplace pas l’original par un fichier corrigé sous le même nom : un fichier modifié suit le parcours de comparaison des versions.

**Archiver** range un lot ; cela ne retire pas ses ventes ou sa casse des analyses. Pour une correction, utilise le parcours de nouvelle version et résous les ambiguïtés affichées avant application.

## Les chiffres semblent absents ou incomplets

Vérifie d’abord la date, l’indicateur et les filtres actifs de la page **Analyses**. Une catégorie ou un produit sélectionné peut masquer le reste du rayon. Consulte **Couverture et comparaison** pour comprendre les journées utilisées ; une donnée absente n’est pas une valeur nulle. Compare le même indicateur et des jours de semaine équivalents.

Si les sources sont présentes mais qu’un calcul est en échec, reprends-le depuis **Synchronisation**. Ne réimporte pas tous les fichiers et ne restaure pas une ancienne base uniquement pour enlever un libellé d’incomplétude.

## Un email ou une réponse du copilote paraît bloqué

Pour un email, ouvre **Actions → Documents, imports et gestion du magasin → Recevoir des documents par email**. Vérifie l’adresse du magasin affichée et les expéditeurs autorisés, puis actualise la réception. Un original reçu, sa confirmation de traitement et sa publication métier sont des états distincts. Consulte ensuite **Imports Mercalys** ou **Documents commerciaux** selon le fichier.

Pour le copilote, retourne dans la même discussion et vérifie son état avant de répéter la question. Une absence de notification ne prouve pas l’absence de réponse : les permissions du téléphone et les réglages de notification sont indépendants du résultat enregistré. Une notification d’email reçu ne certifie pas la fin de son analyse ou de sa publication.

## Reprendre une copie locale

La reprise est destinée à une base réellement problématique, avec accompagnement technique ; ce n’est pas la première action face à un compteur de synchronisation.

1. Dans **Copies locales de sécurité**, retrouve la copie appartenant au même compte et au même magasin. Utilise **Vérifier cette copie**.
2. Lis la confirmation séparée. **Annuler la reprise** conserve la base courante. **Reprendre cette copie et me déconnecter** active la reprise après les vérifications ; les tables ne sont pas fusionnées.
3. Ferme complètement l’app, rouvre-la et connecte-toi avec le compte propriétaire. Vérifie le brouillon ou l’élément attendu avant de reprendre le travail.
4. Les modifications postérieures à la copie restent dans l’emplacement précédent conservé. Pour les retrouver, fais examiner cet emplacement via le même parcours ; ne fusionne pas les fichiers SQLite à la main.

Les commandes gardent leurs identifiants pour que la synchronisation contrôle les reprises et les doublons. Cela ne signifie pas qu’une copie locale peut restaurer un iPhone perdu ou réparer toute corruption. La restauration des sauvegardes Atlas reste en attente de l’activation décidée par le propriétaire ; aucune restauration cloud n’est qualifiée à ce stade.

## Informations à transmettre pour un incident

Transmets dans le canal de support convenu : l’heure et la date, l’écran, l’action qui précède le blocage, le message exact et son code ou sa référence, le nom du fichier concerné, le nombre d’éléments en attente et la présence ou non du réseau. Une capture de l’état suffit généralement pour commencer ; évite d’y inclure des identifiants de connexion ou des contenus inutiles au diagnostic.

Indique aussi le numéro du build installé depuis le lien d’installation conservé. Le seul libellé « 0.1.0 » ne distingue pas les versions successives du pilote. Ne partage aucun mot de passe, code de connexion ou lien privé donnant accès à un fichier.

## Repères de livraison pour la maintenance

Au 10 novembre 2026, le **build 44** est la dernière recette iPhone acceptée pour la consultation des anciens imports Mercalys. Le correctif mobile de diagnostic fusionné en PR486 attend un prochain build ; un déploiement API ne met pas à jour l’app installée.

Pour chaque livraison, appliquer le [processus de release](RELEASE_PROCESS.md) : source exacte et contrôles identifiés, compatibilité API/app, précédent déploiement conservé et vérification après activation. Un retour serveur doit vérifier les contrats et migrations compatibles ; il ne restaure ni MongoDB, ni la base locale, ni des commandes non synchronisées. Revenir à un ancien binaire peut réintroduire une correction déjà validée : examiner le défaut et les données concernées avant cette décision.

Les recettes acceptées et les réserves encore ouvertes figurent dans le [suivi M8](progress/M8_HARDENING_STATUS.md). Ce guide documente le support et la reprise ; les mesures de performance sur iPhone, la qualification complète des interruptions, TestFlight et la restauration cloud restent des critères distincts.

### Alerte de lecture d’un document

Dans les réglages des notifications, « Lecture des documents » dispose de son propre interrupteur, désactivé au départ. Il est indépendant des réponses du copilote et de la réception des emails. Une alerte indique que les pages du pense-bête sont consultables, ou que la lecture et le rapprochement produit d’un ticket sont disponibles. Elle ne valide ni n’importe automatiquement les résultats.

Si l’alerte n’arrive pas, le résultat reste accessible dans Documents commerciaux ou Casse. En cas de résultat absent sur ce téléphone, l’ouverture peut actualiser la synchronisation puis revenir à Actions si le document n’est pas disponible. Un document retiré ou un autre compte ne doit jamais être ouvert par une ancienne alerte.
