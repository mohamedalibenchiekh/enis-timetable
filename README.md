# ENISo — Emplois du temps → Word

Desktop application that turns the HTML timetables exported by **FET** (`*_rooms_*`, `*_teachers_*`, `*_groups_*`)
into one **Word (.docx) file per day** — same layout as your `Jeudi.docx`: rooms grouped by bloc (A, B, R + Amphi) × time slots, teacher names in the cells.

| Layer | Tech |
|---|---|
| Desktop shell | Electron (TypeScript) — starts the API on a free local port and opens the UI |
| UI | Next.js 15 + React 19 + TypeScript (static export, served by the API) |
| API | NestJS 12 (ESM) + TypeORM + TypeScript (parsing, storage, DOCX generation with `docx`) |
| Database | PostgreSQL 17 — **bundled** in the desktop app (`embedded-postgres`), or any external PostgreSQL |

```
apps/
  api/      NestJS   src/parser (FET HTML → sessions) · src/export (day grid + .docx) · src/timetables (REST)
  web/      Next.js  import screen · day preview · options
  desktop/  Electron main + preload (folder picker, starts the API)
```

## 1. Prerequisites (developers only)
* Node.js 22 LTS (20.12+ works)
* Nothing else: the desktop app starts its own PostgreSQL (data in the app's user-data folder, never exposed to the network).
  For browser development (`npm run dev:api`) you need a PostgreSQL: `docker compose up -d`, or create user/db `enis` / `enis_timetable`.

## 2. Install & run (developers)
```bash
npm install
npm run desktop        # builds API + web + Electron shell and opens the app
```
To use an existing PostgreSQL server instead of the bundled one, create `config.json` in the app's user-data folder
(menu *Fichier → Fichier de configuration*) containing `{ "databaseUrl": "postgres://user:password@host:5432/dbname" }`.
In development (`dev:api`) the URL comes from `apps/api/.env` (see `.env.example`). Tables are created automatically.

### Development (browser, hot reload)
```bash
npm run dev:api    # http://127.0.0.1:4000  (NestJS, watch mode)
npm run dev:web    # http://localhost:3000   (Next.js, proxies /api to :4000)
```

## 3. Using it
1. **Importer** → drop the 3 HTML files (the *rooms* file alone is enough to produce the Word files).
2. Pick a day tab to preview it.
3. **Télécharger Lundi.docx** (one day), **Tous les jours (.zip)**, or **Enregistrer dans un dossier…** (desktop only: writes the 6 files straight into a folder you choose).
4. *Options du document Word*: abbreviate `BEN` → `B`, show `1/15` for bi-weekly sessions, list free rooms, and define the blocs (regex per bloc).

## Noms et libellés

Open the **Noms** tab of an imported timetable to correct teacher names and room labels without changing the imported HTML or stored sessions. The corrections are global to this database, so they also apply to other timetables and remain available for the next semester. They are stored in the database and survive application updates. The app's pre-update backup includes the bundled local database; if you configured an external database, arrange backups for that database separately.

Enter the wording you want to see in Word and save the changes. A saved teacher or room override takes precedence over automatic formatting and is used exactly as entered (after trimming outer whitespace). Without an override, the existing formatting still applies, including `BEN` → `B`, title casing, and labels such as `A02` → `A 0-2`. Frequency suffixes such as `1/15` continue to be added after a teacher's displayed name. Room bloc membership always uses the source room name, not its corrected label.

Use **Exporter les noms (.json)** to keep a copy of the overrides or **Importer des noms…** to merge a previously exported file. Importing does not execute file contents; invalid files are rejected.

## 4. How the HTML is read
* Every FET table holds one room / teacher / group; cells may be `rowspan` (a 3-hour session covering two slots) or a *detailed* split cell (parallel TP groups).
  The parser resolves the real column of each cell, then keeps only the activities that belong to the table's owner.
* Run the fixture parity check: `npm run test:verify -w apps/api -- <folder with the html files>` compares the **rooms** view with the **teachers** view and writes six `.docx` files to `apps/api/test-output`.
* Time headers follow the file: Wednesday/Saturday show `12:00-13:30`, Friday `14:00-15:30` / `15:45-17:15`, and `Pause` is shown when nothing is scheduled in the lunch slot.
* Rooms such as `A02` / `B12 (Labo Anglais)` are labelled `A 0-2` / `B 1-2` as in the reference file.

## 5. Build the installer for end users (no code, no command line)
On the OS you target (Windows for a `.exe`):
```bash
npm install
npm run icons         # regenerates the committed app, installer, and web icons
npm run dist
```
Result in `apps/desktop/release/`: **`ENISo-Setup-<version>.exe`** (Windows, NSIS), `ENISo-<version>-<arch>.dmg` (macOS) or `ENISo-<version>-<arch>.AppImage` (Linux).
Give that single file to the users: they double-click it, install, and open *Emplois du temps ENISo* from the desktop shortcut.
The installer contains everything (app, API, PostgreSQL); no Node.js or database installation is needed.

Notes
* The installer is not code-signed, so Windows SmartScreen shows "Windows protected your PC" → *More info → Run anyway*. A code-signing certificate removes this.
* If Windows packaging fails while creating symbolic links or editing the executable icon/version resources, enable *Developer Mode* in **Settings → System → For developers**, or run the terminal as Administrator and retry `npm run dist`.
* `npm run pack` builds an unpacked app folder (faster, for testing).
* Users' data lives in `%APPDATA%\Emplois du temps ENISo\database`; uninstalling the app keeps it.
* If PostgreSQL cannot start on a PC, install the Microsoft *Visual C++ Redistributable (x64)* and retry.

## REST API (used by the UI)
`POST /api/timetables` (multipart `files`) · `GET /api/timetables` · `GET /api/timetables/:id/days/:day/preview` · `GET …/days/:day/docx` ·
`GET …/export.zip` · `POST …/export-to-folder {dir}` · `GET|PUT /api/settings/export` ·
`GET /api/names/teachers|rooms?timetableId=…` · `PUT /api/names/teachers|rooms` ·
`DELETE /api/names/teachers|rooms/:key` · `GET /api/names/export` · `POST /api/names/import`.
The server only listens on `127.0.0.1`.

## Testing

Run commands from the repository root. The root suite includes API unit, Word-output, PostgreSQL integration, and web component tests; PostgreSQL integration cases skip with a clear message when the local development database is unreachable.

```bash
npm test                              # API unit/integration and web component suites
npm run test:coverage -w apps/api     # API coverage (parser/export line threshold: 90%)
npm run test:watch -w apps/api        # API watch mode
npm run test:watch -w apps/web        # web watch mode
npm run test:verify -w apps/api       # fixture parity check and six sample Word files
npm run test:visual                   # DOCX visual regression (needs LibreOffice and Poppler)
npx playwright install chromium       # install the browser required for E2E tests
npm run test:e2e                     # build, then Chromium browser flow (requires PostgreSQL)
```

The web component suite also runs the desktop updater, upgrade-backup, PostgreSQL-major guard, and update-banner tests.

To add a fixture, use synthetic names and activities, keep the HTML under `apps/api/test/fixtures/`, and update the parser or integration assertions that consume it. Never add real FET exports. The rooms and teachers fixtures should continue to describe the same (day, slot, room, teacher, subject code) set.

## Visual checks

The visual suite builds the six daily Word files and a synthetic long-name stress case through the same parser, `buildDayGrid`, and `buildDayDocx` path used by the app. It converts each DOCX to PDF with LibreOffice, rasterizes at 100 dpi with Poppler, and compares the seven PNGs with reviewed references in `apps/api/test/visual/baselines/`. It also checks that every document is one page, has at least 20 px of blank margin on the left and right, and contains the expected header and bloc-band colors. Only synthetic fixtures are used.

The visual renderer is supported on Ubuntu 24.04 with Node.js 22.22.3, LibreOffice Writer 24.2.7, Poppler 24.02.0, fontconfig 2.15.0, and Liberation fonts 2.1.5. Its isolated fontconfig configuration scans only the Liberation font directory and maps Times New Roman to metric-compatible Liberation Serif. The GitHub CI and baseline-update workflows pin these package versions; macOS and Windows local rendering are not currently supported.

On Ubuntu 24.04, install the pinned renderer packages:

```bash
sudo apt-get update
sudo apt-get install --no-install-recommends \
  libreoffice-writer=4:24.2.7-0ubuntu0.24.04.7 \
  poppler-utils=24.02.0-1ubuntu9.11 \
  fonts-liberation=1:2.1.5-3 \
  fontconfig=2.15.0-1.1ubuntu2
```

Run the check from the repository root:

```bash
npm run test:visual
```

If LibreOffice or Poppler's renderer is not installed locally, the command prints a skip message; CI treats missing tools as a failure. Confirm all seven visual cases pass and the page-ordering test also passes (eight tests total), rather than relying on a skipped suite. On a failure, open `apps/api/test-output/visual/<case>/expected.png`, `actual.png`, and `diff.png`. The diff highlights changed pixels; matching permits a 0.1 pixelmatch threshold and at most 0.1% differing pixels. A failure directory is uploaded by CI for seven days.

Do not edit PNG baselines by hand. The canonical **Update visual DOCX baselines** GitHub Actions workflow renders on `ubuntu-24.04` with the same pinned packages as CI and opens a PR containing the generated images. Review all seven images in that PR before merging. The initial baselines in this change are bootstrapped locally and must be checked by CI; if that run exposes renderer differences, use the workflow to replace them. For local investigation only, `npm run test:visual:update -- --yes` regenerates images and requires the explicit `--yes` confirmation; review the images and diff before using any locally generated output.

The Monday `DayGrid` golden snapshot is in `apps/api/test/__snapshots__/docx.spec.ts.snap`. After an intentional export change, run `npm run test -w apps/api -- -u`, inspect the snapshot diff by hand, and commit the reviewed update with the test change. Word documents themselves are checked as ZIP/XML and are not snapshotted because they contain generated metadata.

## CI/CD

### Workflows

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| **CI** (`.github/workflows/ci.yml`) | PR to `main`, push to `main` | Typechecks and builds the workspaces, runs API and web suites against PostgreSQL, uploads API coverage, exercises the Chromium UI flow, and builds an unpacked Electron app on Windows. |
| **Update visual DOCX baselines** (`.github/workflows/update-visual-baselines.yml`) | Manual (`workflow_dispatch`) | Regenerates synthetic DOCX reference images on `ubuntu-24.04` with pinned renderer packages and opens a pull request with changed baselines. |
| **Release** (`.github/workflows/release.yml`) | Push of a tag `v*.*.*` | Verifies the tag matches `apps/desktop/package.json` version, builds Windows NSIS, macOS DMG/ZIP, and Linux AppImage assets with update metadata, then creates a published GitHub Release. Builds are unsigned by default. |
| **Dependabot** (`.github/dependabot.yml`) | Weekly (Monday) | Opens PRs for npm dependency updates (grouped by dependency type, minor+patch together) and GitHub Actions version bumps. |

## Releases and auto-update

### Cutting a release

1. Create a version branch from the latest `main` and update the desktop package version. Replace `1.0.3` with the next unused version:
   ```bash
   git switch main && git pull
   git switch -c chore/release-1-0-3
   npm version 1.0.3 -w apps/desktop --no-git-tag-version
   git add apps/desktop/package.json package-lock.json
   git commit -m "chore: bump desktop version to 1.0.3"
   git push -u origin chore/release-1-0-3
   ```

2. Open and merge the pull request to `main`. Confirm the desktop package version equals the new tag without the leading `v`.

3. Tag the merged commit and push only the new tag:
   ```bash
   git switch main && git pull
   git tag v1.0.3
   git push origin v1.0.3
   ```

Never reuse a release tag, edit `latest*.yml` by hand, or create a tag whose version differs from `apps/desktop/package.json`. The workflow keeps `--publish never` in the build jobs and attaches the generated installer assets, update metadata, and blockmaps to one **published** (not draft or prerelease) GitHub Release. Electron-updater only checks published releases.

The generated asset names contain no spaces (for example `ENISo-Setup-1.0.3.exe`), so the URLs in `latest.yml`, `latest-linux.yml`, and `latest-mac.yml` match uploaded names. Updates are enabled only for Windows NSIS and Linux AppImage. On macOS and other unsupported platforms, a manual check offers to open the Releases page; automatic checks do nothing. macOS auto-install is not supported because these builds are unsigned.

### What users see and data safety

The installed app checks 20 seconds after its main window appears and then every six hours. Checks and downloads run in the background. When a download finishes, the user can choose **Redémarrer maintenant** or **Plus tard**; the latter installs when the app is next quit. The **Fichier → Rechercher des mises à jour…** menu and the sidebar link start a manual check. Offline automatic checks are logged quietly.

GitHub auto-update requires a **public** release repository so clients can download assets without a token. Never put a GitHub token in the app. If this repository must be private, either make it public or publish update releases to a separate public repository and change the updater's release configuration; until configured, update errors are handled quietly and no update is installed.

On the first launch after an app version change, before PostgreSQL starts, the app copies `<userData>/database` to `<userData>/backups/database-<oldVersion>-<timestamp>` and retains the two newest backups. Existing data without `state.json` (from an older app version) receives an initial backup labeled `database-inconnu-…`. The menu item **Fichier → Ouvrir le dossier des sauvegardes** opens that folder. Update logs are in `<userData>/logs/update.log` (one rotated file is retained). The installer does not remove user data on upgrade or uninstall. PostgreSQL is pinned to major version 17; if its data directory reports a different major, startup stops with a French error rather than attempting an unsafe upgrade.

To disable checks, set `"autoUpdate": false` in `<userData>/config.json` (create/open it with **Fichier → Fichier de configuration (base de données)…**). The default is enabled.

### Manual installed-app update test

This test uses two local builds and a generic static server; it does not publish a release or tag. Use a disposable clone or branch so the package version changes do not enter a normal release:

1. In the disposable checkout, ensure `apps/desktop/package.json` is `1.0.0`, then build a Windows installer:
   ```bash
   npm run build
   npm run build -w apps/desktop
   npm run stage -w apps/desktop
   (cd apps/desktop && npx electron-builder --publish never --win)
   ```
   Save `apps/desktop/release/ENISo-Setup-1.0.0.exe` outside the release directory.
2. Set the desktop package version to `1.0.1` and repeat the build commands. Keep the 1.0.1 installer, its `latest.yml`, and any `.blockmap` files together in `apps/desktop/release/`. The version can be set with `npm version 1.0.1 -w apps/desktop --no-git-tag-version`.
3. Start a static server in the repository root, serving that 1.0.1 release directory:
   ```bash
   python3 -m http.server 8765 --bind 127.0.0.1 --directory apps/desktop/release
   ```
   Install the saved 1.0.0 installer. In the installed app's `app.getAppPath()` directory (the `resources/app` directory), create `dev-app-update.yml` with:
   ```yaml
   provider: generic
   url: http://127.0.0.1:8765
   ```
   In PowerShell, launch the installed app with the test-only environment switch:
   ```powershell
   $env:ENIS_FORCE_DEV_UPDATE_CONFIG = '1'
   & "$env:LOCALAPPDATA\Programs\Emplois du temps ENISo\Emplois du temps ENISo.exe"
   ```
   This switch enables electron-updater's `forceDevUpdateConfig` so the installed 1.0.0 build reads the generic provider configuration.
4. Wait at least 20 seconds after the main window appears, or select **Rechercher des mises à jour…**. Verify that 1.0.1 is downloaded, the French ready dialog appears, **Plus tard** leaves the app running without installing, and quitting then relaunching installs 1.0.1. Also import a small test timetable before updating and verify it remains present afterward and a backup exists.

Stop the local server after the test. The update artifacts must be from the same 1.0.1 build; do not hand-edit update metadata.

### Recommended branch protection settings for `main`

- Require a pull request before merging (at least 1 approval)
- Require status checks to pass: `Typecheck · Build · Test`, `API Integration`, `End-to-end · Chromium`, `Package Smoke (Windows)`
- Require branches to be up to date before merging
- Do not allow force pushes
- Do not allow deletions

## Documentation utilisateur

Le guide français maintenu se trouve dans `docs/guide-utilisateur.fr.md`. Les mentions d’interface suivent la convention `**[Libellé exact]**`, vérifiée par un test qui compare les valeurs statiques entières des textes et libellés de l’interface.

Pour régénérer les captures synthétiques avec Playwright et construire le fragment HTML statique du guide :

```bash
npm run guide:screenshots
npm run guide:build
```

La génération des captures nécessite Chromium, LibreOffice Writer et Poppler (`pdftoppm`). Elle utilise uniquement les fichiers de test synthétiques dans `apps/api/test/fixtures/`. Le guide est compilé dans l’export Web et s’ouvre hors connexion depuis **Aide**.
