# Guide d’utilisation d’ENISo

## Démarrage rapide

1. Ouvrez **[Importer]** et choisissez un ou plusieurs fichiers HTML exportés depuis FET.
2. Vérifiez l’aperçu de l’emploi du temps et les fichiers reconnus.
3. Choisissez un jour, puis sélectionnez **[Télécharger le document du jour]** ou **[Tous les jours (.zip)]**.
4. Dans l’application de bureau, utilisez **[Enregistrer dans un dossier…]** pour choisir un dossier.
5. Résultat attendu : un document Word par jour, ou une archive ZIP avec les documents disponibles.
6. Vous pouvez importer seulement le fichier HTML des salles.
7. Les fichiers des enseignants et des groupes complètent les informations disponibles.
8. Les options du document Word s’appliquent aux prochains téléchargements.
9. Les corrections dans **[Noms]** s’appliquent à tous les emplois du temps de cette base.
10. Ouvrez **[Aide]** dans l’application pour retrouver ce guide hors connexion.

## À quoi sert l’application

ENISo transforme un emploi du temps HTML exporté depuis FET en documents Word. Vous pouvez consulter les séances par jour et télécharger un document pour chaque journée. L’application regroupe les salles par bloc.

![Exemple synthétique : un tableau HTML devient une page Word organisée par jour et par bloc.](../apps/web/public/guide/apercu-html-vers-word.png)

## Installer l’application

### Télécharger et ouvrir l’application

1. Téléchargez le fichier d’installation fourni par votre établissement. Son nom se termine par `.exe` sous Windows.
2. Ouvrez le fichier et suivez les étapes affichées par l’installateur.
3. Si Windows affiche « Windows a protégé votre ordinateur », sélectionnez « Informations complémentaires », puis « Exécuter quand même ».
4. Ce message apparaît parce que l’application n’est pas signée par un certificat de signature de code. Il ne signifie pas que Windows a détecté un problème dans le fichier.
5. Une fois l’installation terminée, ouvrez **[Emplois du temps ENISo]** depuis le raccourci du Bureau.

L’installateur place l’application dans le dossier choisi pendant l’installation. Le dossier proposé par défaut est celui des applications de votre compte Windows. Le raccourci du Bureau s’appelle **[Emplois du temps ENISo]**.

### Vérifier le fichier téléchargé (facultatif)

Vous pouvez vérifier que le fichier téléchargé correspond à celui publié avant de l’ouvrir. Sur la page de la version GitHub, relevez la somme SHA-256 associée au nom du fichier dans la section « Sommes SHA-256 » ou dans le fichier joint `SHA256SUMS.txt`. Ouvrez PowerShell dans le dossier qui contient le fichier, puis exécutez :

```powershell
Get-FileHash .\<fichier> -Algorithm SHA256
```

Comparez la valeur affichée après `Hash` avec la somme publiée pour le même nom de fichier. Si les valeurs diffèrent, ne poursuivez pas l’installation et téléchargez à nouveau le fichier depuis la source prévue par votre établissement.

**Résultat attendu :** la fenêtre **[Emplois du temps]** s’ouvre et affiche l’écran d’import.

## Ouvrir l’aide dans l’application

Sélectionnez **[Aide]**, puis **[Guide d’utilisation]** dans le menu de l’application. La touche **[F1]** ouvre aussi le guide. Pour garder une copie imprimable, sélectionnez **[Enregistrer le guide en PDF…]**. Le menu **[À propos]** indique le nom, la version et le dossier des données.

**Résultat attendu :** le guide s’ouvre dans la fenêtre ENISo ou un fichier PDF est enregistré à l’emplacement choisi.

Si « Le guide PDF n’a pas pu être enregistré » apparaît, vérifiez que le dossier choisi existe et qu’il reste de l’espace libre, puis réessayez.

## Premier démarrage et import des fichiers

### Importer les fichiers HTML

FET peut produire des fichiers dont le nom contient `rooms`, `teachers` ou `groups`. Dans l’application, ces types apparaissent comme **[Salles]**, **[Enseignants]** et **[Groupes]**. Le fichier des salles suffit pour créer les documents Word. Les deux autres fichiers apportent des informations complémentaires.

Si « Type de fichier inconnu » apparaît, vérifiez que le nom du fichier contient l’un des types attendus : `rooms`, `teachers` ou `groups`. Le message précise « attendu : teachers, rooms ou groups dans le nom ».

Les étapes exactes pour produire les trois fichiers dans FET et choisir l’affichage des jours à l’horizontale restent **à confirmer** par le responsable du projet.

1. Ouvrez **[Importer]**.
2. Déposez les fichiers HTML dans la zone **[Glissez les fichiers HTML ici ou cliquez pour les choisir]**, ou cliquez sur cette zone et sélectionnez les fichiers.
3. Vérifiez l’étiquette de type affichée devant chaque nom de fichier. **[Type ?]** signifie que l’application ne reconnaît pas le type dans le nom.
4. Si vous créez un nouvel emploi du temps, vous pouvez saisir un nom dans **[Nom (facultatif) — ex. S1 2026-2027]**.
5. Sélectionnez **[Importer]**.

**Résultat attendu :** l’emploi du temps apparaît dans la liste et son aperçu s’ouvre. Les types de fichiers reçus sont indiqués sous son nom.

### Ajouter ou remplacer un fichier

1. Ouvrez l’emploi du temps concerné.
2. Sélectionnez **[Ajouter / remplacer des fichiers]**.
3. Choisissez le nouveau fichier HTML du type à ajouter ou remplacer.
4. Sélectionnez **[Importer]**.

**Résultat attendu :** le type choisi est ajouté ou remplacé dans cet emploi du temps.

## Aperçu et téléchargement

### Consulter un jour et télécharger les documents

1. Sélectionnez un jour dans les onglets des jours disponibles.
2. Vérifiez les salles, les blocs et les séances de l’aperçu.
3. Pour télécharger le jour affiché, sélectionnez **[Télécharger le document du jour]**. Le nom du jour s’adapte à l’onglet choisi.
4. Pour télécharger tous les jours dans une archive, sélectionnez **[Tous les jours (.zip)]**.
5. Dans l’application de bureau, sélectionnez **[Enregistrer dans un dossier…]**, puis choisissez un dossier.

Le téléchargement du navigateur est enregistré dans le dossier habituellement utilisé pour les téléchargements. Pour l’enregistrement dans un dossier, l’application écrit les fichiers dans le dossier choisi et l’ouvre ensuite dans l’explorateur.

**Résultat attendu :** vous obtenez un fichier `.docx` pour le jour affiché, une archive `.zip`, ou un document Word par jour dans le dossier sélectionné.

## Options du document Word

### Modifier les options

1. Dans l’onglet **[Emploi du temps]**, ouvrez **[Options du document Word]**.
2. Activez **[Abréger « BEN » en « B » (ex. B Rhouma Asma)]** pour raccourcir ce préfixe dans les noms affichés.
3. Activez **[Afficher « 1/15 » pour les séances une semaine sur deux]** pour afficher cette indication de fréquence.
4. Activez **[Lister aussi les salles libres]** pour inclure les salles sans séance.
5. Modifiez **[Libellé de la pause]** pour choisir le texte affiché dans les créneaux de pause vides.
6. Sélectionnez **[Enregistrer]**.

**Résultat attendu :** le message **[Options enregistrées]** apparaît. Les prochains aperçus et documents utilisent ces options.

### Régler les blocs et leurs expressions

Les blocs regroupent les salles dans des bandes du document Word. Par exemple, si le bloc A contient les salles A01, A02 et A12, son expression peut commencer par `^A\d\d`. Le signe `^` signifie « au début du nom » et `\d\d` signifie « deux chiffres ».

Le champ des expressions accepte plusieurs règles séparées par des virgules. Vous pouvez copier une des expressions suivantes :

- `^A\d\d` : salles dont le nom commence par A suivi de deux chiffres.
- `^B\d\d` : salles dont le nom commence par B suivi de deux chiffres.
- `^R|^Amphi` : salles dont le nom commence par R ou par Amphi.

1. Ouvrez **[Options du document Word]**.
2. Dans la ligne du bloc, modifiez son titre ou ses expressions.
3. Utilisez une virgule pour séparer plusieurs expressions dans le même champ.
4. Utilisez **[+ ajouter un bloc]** pour créer une ligne ou **[supprimer]** pour retirer une ligne.
5. Sélectionnez **[Enregistrer]**.

**Résultat attendu :** les salles correspondantes sont regroupées sous le titre du bloc dans le prochain aperçu ou document Word.

## Noms et libellés

### Corriger les noms affichés

1. Sélectionnez **[Noms]**.
2. Dans **[Affiché dans Word]**, saisissez le nom ou le libellé souhaité. Vous pouvez rechercher une entrée avec **[Rechercher]**.
3. Répétez l’opération pour les enseignants ou les salles à corriger.
4. Sélectionnez **[Enregistrer]** dans la barre des modifications.

Les corrections s’appliquent à tous les emplois du temps de cette base. Elles ne modifient pas les fichiers HTML importés. Pour revenir au nom automatique d’une entrée, utilisez le bouton de réinitialisation sur sa ligne, puis enregistrez.

**Résultat attendu :** le message **[Noms enregistrés]** apparaît et les prochains documents utilisent les corrections.

### Sauvegarder ou importer les corrections

1. Pour garder une copie des corrections, sélectionnez **[Exporter les noms (.json)]**.
2. Pour ajouter des corrections depuis une copie, sélectionnez **[Importer des noms…]** et choisissez le fichier JSON.

**Résultat attendu :** le navigateur télécharge `noms-enis.json` à l’export, ou affiche le bilan de l’import.

## Mises à jour

### Vérifier et installer une mise à jour

Sur Windows et Linux AppImage, l’application installée vérifie les mises à jour en arrière-plan. Sur les autres systèmes, la recherche automatique n’est pas disponible. Quand une mise à jour est téléchargée, vous pouvez choisir **[Redémarrer pour installer]** ou **[Plus tard]**. Vous pouvez aussi ouvrir le menu **[Fichier]** et choisir **[Rechercher des mises à jour…]**.

1. Enregistrez votre travail dans l’application.
2. Sélectionnez **[Rechercher des mises à jour…]** dans le menu **[Fichier]**.
3. Si une mise à jour est prête, sélectionnez **[Redémarrer pour installer]** pour l’installer maintenant, ou **[Plus tard]** pour attendre la prochaine fermeture.

**Résultat attendu :** l’application installe la mise à jour au redémarrage choisi. Une connexion Internet est nécessaire pour rechercher et télécharger une mise à jour. Si la dernière version est déjà installée, l’application l’indique.

## Vos données et sauvegardes

### Retrouver vos données

Sous Windows, les données sont conservées dans le dossier utilisateur de l’application : `%APPDATA%\Emplois du temps ENISo`. La base se trouve dans le sous-dossier `database`. Les sauvegardes automatiques se trouvent dans `backups` et les journaux de mise à jour dans `logs`.

La désinstallation ne supprime pas ces données. Lors d’une mise à jour, l’application crée une copie de la base avant de démarrer la nouvelle version. Elle conserve les deux sauvegardes les plus récentes. Si une sauvegarde échoue, l’application affiche un avertissement et continue : « L’application continue, mais vérifiez vos données avant de poursuivre. »

1. Ouvrez le menu **[Fichier]**.
2. Sélectionnez **[Ouvrir le dossier des sauvegardes]**.
3. Copiez le dossier de sauvegarde vers un emplacement sûr.

**Résultat attendu :** l’explorateur de fichiers affiche le dossier `backups`.

### Déplacer les corrections vers un autre ordinateur

1. Sur le premier ordinateur, sélectionnez **[Noms]**, puis **[Exporter les noms (.json)]**.
2. Transférez le fichier `noms-enis.json` par le moyen autorisé par votre établissement.
3. Sur l’autre ordinateur, sélectionnez **[Noms]**, puis **[Importer des noms…]** et choisissez ce fichier.

**Résultat attendu :** les corrections de noms sont importées sur l’autre ordinateur. Cet export ne contient pas les emplois du temps ni la base de données.

## Problèmes fréquents

### Fichier non reconnu ou import refusé

- « Type de fichier inconnu » : le nom du fichier ne contient pas `rooms`, `teachers`, `groups`, `salle`, `enseignant` ou `group`. Vérifiez que vous avez choisi un fichier HTML exporté depuis FET.
- « Deux fichiers du même type (teachers/rooms/groups) ont été envoyés » : sélectionnez un seul fichier par type. Vous pouvez ajouter ou remplacer un fichier ensuite.
- « Aucun fichier HTML reçu » : sélectionnez au moins un fichier avant de lancer l’import.
- « ne contient aucun tableau d'emploi du temps » : le fichier ne contient pas de tableau reconnu. Vérifiez le fichier exporté.
- « Emploi du temps introuvable » : l’emploi du temps demandé n’est plus dans la base. Revenez à la liste et sélectionnez un emploi du temps existant.
- « Cet emploi du temps ne contient aucune donnée » : aucun fichier importé ne fournit de séances. Importez un fichier HTML de salles.
- « Jour invalide » : rechargez l’emploi du temps et choisissez l’un des jours affichés.
- « Options invalides » : une option enregistrée n’est pas reconnue. Rouvrez les options, corrigez la valeur signalée et enregistrez-la de nouveau.
- « Le nom affiché doit être un texte ou vide », « le nom affiché dépasse 60 caractères » ou « le nom affiché contient un caractère de contrôle » : corrigez le nom dans l’onglet **[Noms]**. Un nom affiché peut contenir jusqu’à 60 caractères.
- « Clé de nom invalide » : la correction ne correspond pas à un nom reconnu dans la base. Rechargez la page avant de réessayer.
- « Dossier invalide » : choisissez un dossier existant et accessible.

### Une salle est vide ou une case manque

Vérifiez que le fichier des salles correspond à la bonne période et qu’il s’agit de l’export HTML avec les jours disposés à l’horizontale. L’expression du bloc peut aussi exclure une salle. Les étapes exactes de production dans FET restent à confirmer.

### L’application ne démarre pas ou signale une erreur de base de données

La fenêtre « Démarrage impossible » indique que le serveur de l’application ou la base de données n’a pas démarré. Fermez les autres fenêtres ENISo et réessayez. Si vous avez configuré une base de données externe, vérifiez qu’elle est démarrée et que son adresse est correcte dans le fichier de configuration.

Les messages possibles comprennent « La base de données intégrée n'a pas pu démarrer », « La connexion à PostgreSQL a échoué », « Le fichier de version PostgreSQL est vide ou corrompu » et « Les données n’ont pas été modifiées ». En cas de version PostgreSQL incompatible, restaurez une sauvegarde compatible ou contactez le support.

### L’antivirus affiche un avertissement

L’installateur Windows n’est pas signé par un certificat de signature de code. Windows peut afficher son avertissement SmartScreen. Suivez l’étape « Informations complémentaires », puis « Exécuter quand même » si vous avez reçu le fichier d’installation de la source prévue par votre établissement.

### La police Word est différente ou un jour ne contient pas de séance

Word peut afficher une police de remplacement si la police du document n’est pas installée sur l’ordinateur. Le document reste lisible, mais sa mise en page peut légèrement différer. Si un jour ne contient aucune séance, l’aperçu peut être vide pour ce jour : vérifiez les autres onglets et les fichiers importés.

### Le fichier de corrections de noms est refusé

Le fichier JSON doit provenir de **[Exporter les noms (.json)]**. Les messages « Fichier de noms invalide », « Fichier de noms invalide : objet attendu », « Fichier de noms invalide : version ou listes manquantes », « Le fichier de noms dépasse 1 Mo », « Le champ « items » doit être une liste » et « La liste contient trop de lignes » signalent un fichier incorrect ou trop volumineux.

Les erreurs qui commencent par « Ligne » indiquent l’entrée à corriger : « objet attendu », « le nom dans le fichier est obligatoire », « le nom dans le fichier est invalide », « le nom affiché est obligatoire dans un fichier importé » ou « ce nom apparaît plusieurs fois ». Exportez à nouveau les noms depuis un fichier valide, ou corrigez l’entrée indiquée avant de réessayer.

### Une mise à jour ou le serveur ne répond pas

Si la recherche affiche « La recherche de mises à jour a échoué », vérifiez la connexion Internet et réessayez plus tard. Si « La mise à jour n’a pas pu être installée » apparaît, fermez l’application puis relancez-la. Si « Impossible d’ouvrir la page des versions » apparaît, ouvrez la page des versions depuis un navigateur.

Si « La mise à jour automatique n’est pas disponible sur cette plateforme » apparaît, l’application peut proposer d’ouvrir la page des versions. Si « La recherche de mises à jour est disponible uniquement dans une version installée » ou « Les mises à jour automatiques sont désactivées dans le fichier de configuration » apparaît, utilisez la version installée ou contactez la personne qui gère l’application.

Les messages « Le serveur ne répond pas » et « Le serveur s’est arrêté au démarrage » signalent un problème de démarrage. Fermez les autres fenêtres ENISo puis relancez l’application. Si « Le serveur intégré n’a pas pu être arrêté proprement » apparaît, choisissez **[Réessayer]**. Pour un message détaillé, contactez la personne qui vous a fourni l’application.

Si une mise à jour indique « La version … est prête. Redémarrer maintenant pour l’installer ? », sélectionnez **[Redémarrer maintenant]** pour l’installer ou **[Plus tard]** pour attendre.

Si le message « Le serveur intégré n’a pas pu être arrêté proprement. Vous pouvez réessayer ou quitter quand même » apparaît, sélectionnez **[Réessayer]**. Si l’application indique que « Le processus API ne répond pas à l’arrêt », « Le processus API ne s’est pas arrêté après SIGKILL » ou « Impossible d’arrêter le processus API », fermez les autres fenêtres ENISo puis relancez l’application.

## Glossaire

- **Emploi du temps** : organisation des séances par jour et par horaire.
- **Séance** : activité prévue à un horaire, dans une salle, avec un enseignant ou un groupe.
- **Salle** : lieu où se déroule une séance.
- **Bloc** : groupe de salles présenté dans une même bande du document Word.
- **Fichier HTML** : fichier de page Web exporté depuis FET et lu par l’application.
- **Document Word** : fichier `.docx` que vous pouvez ouvrir ou imprimer dans un logiciel de traitement de texte.
- **Archive ZIP** : fichier qui rassemble les documents de plusieurs jours.
- **Libellé** : texte affiché pour une salle, une pause ou un autre élément.
- **Sauvegarde** : copie de données conservée pour pouvoir les récupérer.
