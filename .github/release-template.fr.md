## Installation

Téléchargez l’installateur correspondant à votre système depuis cette page, puis ouvrez-le. Sous Windows, l’installateur est un fichier `.exe`.

## Avertissement SmartScreen sous Windows

Cette application n’est pas signée par un certificat de signature de code. Windows peut donc afficher « Windows a protégé votre ordinateur ». Si vous avez téléchargé le fichier depuis cette version GitHub, sélectionnez « Informations complémentaires », puis « Exécuter quand même » pour poursuivre. Cet avertissement indique l’absence de signature de l’application ; il ne prouve pas à lui seul qu’un fichier est malveillant.

## Vérifier le téléchargement (facultatif)

Dans PowerShell, placez-vous dans le dossier contenant le fichier téléchargé et exécutez :

```powershell
Get-FileHash .\<fichier> -Algorithm SHA256
```

Comparez la valeur `Hash` avec la somme SHA-256 du même nom dans la section « Sommes SHA-256 » ci-dessous ou dans le fichier joint `SHA256SUMS.txt`. N’installez pas le fichier si les valeurs diffèrent.

## Provenance de la compilation

Les installateurs disposent d’une attestation GitHub indiquant le dépôt et le workflow qui les ont produits. Après avoir téléchargé un installateur, vous pouvez la vérifier avec :

```bash
gh attestation verify <fichier> --repo mohamedalibenchiekh/enis-timetable --signer-workflow mohamedalibenchiekh/enis-timetable/.github/workflows/release.yml
```

## Mises à jour automatiques

Les mises à jour automatiques vérifient l’intégrité du fichier téléchargé avec la somme `sha512` publiée dans le fichier `latest*.yml` avant l’installation.

## Sommes SHA-256

```text
<!-- SHA256SUMS -->
```

## Nouveautés

Les notes de version générées par GitHub sont ajoutées après ce texte.
