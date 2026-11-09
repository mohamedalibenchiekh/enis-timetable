# ENISo — Emplois du temps → Word

Desktop application that turns the HTML timetables exported by **FET** (`*_rooms_*`, `*_teachers_*`, `*_groups_*`)
into one **Word (.docx) file per day** — same layout as your `Jeudi.docx`: rooms grouped by bloc (A, B, R + Amphi) × time slots, teacher names in the cells.

| Layer | Tech |
|---|---|
| Desktop shell | Electron (TypeScript) — starts the API on a free local port and opens the UI |
| UI | Next.js 15 + React 19 + TypeScript (static export, served by the API) |
| API | NestJS 11 + TypeORM + TypeScript (parsing, storage, DOCX generation with `docx`) |
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

## 4. How the HTML is read
* Every FET table holds one room / teacher / group; cells may be `rowspan` (a 3-hour session covering two slots) or a *detailed* split cell (parallel TP groups).
  The parser resolves the real column of each cell, then keeps only the activities that belong to the table's owner.
* Check: `npm test -w apps/api -- <folder with the html files>` imports the three files, compares the **rooms** view with the **teachers** view
  (they must describe the same sessions) and writes the six .docx files to `apps/api/test-output`.
* Time headers follow the file: Wednesday/Saturday show `12:00-13:30`, Friday `14:00-15:30` / `15:45-17:15`, and `Pause` is shown when nothing is scheduled in the lunch slot.
* Rooms such as `A02` / `B12 (Labo Anglais)` are labelled `A 0-2` / `B 1-2` as in the reference file.

## 5. Build the installer for end users (no code, no command line)
On the OS you target (Windows for a `.exe`):
```bash
npm install
npm run dist
```
Result in `apps/desktop/release/`: **`Emplois du temps ENISo Setup <version>.exe`** (Windows, NSIS), `.dmg` (macOS) or `.AppImage` (Linux).
Give that single file to the users: they double-click it, install, and open *Emplois du temps ENISo* from the desktop shortcut.
The installer contains everything (app, API, PostgreSQL); no Node.js or database installation is needed.

Notes
* The installer is not code-signed, so Windows SmartScreen shows "Windows protected your PC" → *More info → Run anyway*. A code-signing certificate removes this.
* If `npm run dist` fails on Windows with a "symbolic link" error, run the terminal as Administrator once (or enable Windows *Developer Mode*).
* `npm run pack` builds an unpacked app folder (faster, for testing).
* Users' data lives in `%APPDATA%\Emplois du temps ENISo\database`; uninstalling the app keeps it.
* If PostgreSQL cannot start on a PC, install the Microsoft *Visual C++ Redistributable (x64)* and retry.

## REST API (used by the UI)
`POST /api/timetables` (multipart `files`) · `GET /api/timetables` · `GET /api/timetables/:id/days/:day/preview` · `GET …/days/:day/docx` ·
`GET …/export.zip` · `POST …/export-to-folder {dir}` · `GET|PUT /api/settings/export`. The server only listens on `127.0.0.1`.

## CI/CD

### Workflows

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| **CI** (`.github/workflows/ci.yml`) | PR to `main`, push to `main` | Typechecks all workspaces, builds API + web, runs unit tests (parser parity check + fixture assertions), runs API integration tests against PostgreSQL, and builds an unpacked Electron app on Windows to catch packaging regressions. |
| **Release** (`.github/workflows/release.yml`) | Push of a tag `v*.*.*` | Verifies the tag matches `apps/desktop/package.json` version, builds NSIS `.exe` (Windows), `.dmg` (macOS), and `.AppImage` (Linux) installers, then creates a GitHub Release with all installers attached. Builds are unsigned by default (no code-signing certificate required unless configured). |
| **Dependabot** (`.github/dependabot.yml`) | Weekly (Monday) | Opens PRs for npm dependency updates (grouped by dependency type, minor+patch together) and GitHub Actions version bumps. |

### How to cut a release

1. **Create a release branch and bump the version**:
   ```bash
   git switch main && git pull
   git checkout -b chore/bump-version
   npm version <major|minor|patch> -w apps/desktop
   git add apps/desktop/package.json
   git commit -m "chore: bump version to $(node -p "require('./apps/desktop/package.json').version")"
   git push -u origin chore/bump-version
   ```

2. **Open and merge a Pull Request to `main`** following the standard review workflow.

3. **Tag the merged commit on `main` and push the tag**:
   ```bash
   git switch main && git pull
   git tag v$(node -p "require('./apps/desktop/package.json').version")
   git push origin v$(node -p "require('./apps/desktop/package.json').version")
   ```

The Release workflow will automatically build installers for all platforms and create a GitHub Release.

### Recommended branch protection settings for `main`

- Require a pull request before merging (at least 1 approval)
- Require status checks to pass: `Typecheck · Build · Test`, `API Integration`, `Package Smoke (Windows)`
- Require branches to be up to date before merging
- Do not allow force pushes
- Do not allow deletions
