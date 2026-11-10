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
* Run the fixture parity check: `npm run test:verify -w apps/api -- <folder with the html files>` compares the **rooms** view with the **teachers** view and writes six `.docx` files to `apps/api/test-output`.
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

To add a fixture, use synthetic names and activities, keep the HTML under `apps/api/test/fixtures/`, and update the parser or integration assertions that consume it. Never add real FET exports. The rooms and teachers fixtures should continue to describe the same (day, slot, room, teacher, subject code) set.

## Visual checks

The visual suite builds the six daily Word files and a synthetic long-name stress case through the same parser, `buildDayGrid`, and `buildDayDocx` path used by the app. It converts each DOCX to PDF with LibreOffice, rasterizes at 100 dpi with Poppler, and compares the seven PNGs with reviewed references in `apps/api/test/visual/baselines/`. It also checks that every document is one page, has at least 20 px of blank margin on the left and right, and contains the expected header and bloc-band colors. Only synthetic fixtures are used.

The visual renderer is supported on Ubuntu 24.04 with Node.js 22.22.3, LibreOffice Writer 24.2.7, Poppler 24.02.0, fontconfig 2.15.0, and Liberation fonts 2.1.5. Its isolated fontconfig configuration scans only the Liberation font directory and maps Times New Roman to metric-compatible Liberation Serif. The GitHub CI and baseline-update workflows pin these package versions; macOS and Windows local rendering are not currently supported.

On Ubuntu 24.04, install the pinned renderer packages:

```bash
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

If LibreOffice or Poppler's renderer is not installed locally, the command prints a skip message; CI treats missing tools as a failure. Confirm Vitest reports seven passing cases rather than a skipped suite. On a failure, open `apps/api/test-output/visual/<case>/expected.png`, `actual.png`, and `diff.png`. The diff highlights changed pixels; matching permits a 0.1 pixelmatch threshold and at most 0.1% differing pixels. A failure directory is uploaded by CI for seven days.

Do not edit PNG baselines by hand. The canonical **Update visual DOCX baselines** GitHub Actions workflow renders on `ubuntu-24.04` with the same pinned packages as CI and opens a PR containing the generated images. Review all seven images in that PR before merging. The initial baselines in this change are bootstrapped locally and must be checked by CI; if that run exposes renderer differences, use the workflow to replace them. For local investigation only, `npm run test:visual:update -- --yes` regenerates images and requires the explicit `--yes` confirmation; review the images and diff before using any locally generated output.

The Monday `DayGrid` golden snapshot is in `apps/api/test/__snapshots__/docx.spec.ts.snap`. After an intentional export change, run `npm run test -w apps/api -- -u`, inspect the snapshot diff by hand, and commit the reviewed update with the test change. Word documents themselves are checked as ZIP/XML and are not snapshotted because they contain generated metadata.

## CI/CD

### Workflows

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| **CI** (`.github/workflows/ci.yml`) | PR to `main`, push to `main` | Typechecks and builds the workspaces, runs API and web suites against PostgreSQL, uploads API coverage, exercises the Chromium UI flow, and builds an unpacked Electron app on Windows. |
| **Update visual DOCX baselines** (`.github/workflows/update-visual-baselines.yml`) | Manual (`workflow_dispatch`) | Regenerates synthetic DOCX reference images on `ubuntu-24.04` with pinned renderer packages and opens a pull request with changed baselines. |
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
- Require status checks to pass: `Typecheck · Build · Test`, `API Integration`, `End-to-end · Chromium`, `Package Smoke (Windows)`
- Require branches to be up to date before merging
- Do not allow force pushes
- Do not allow deletions
