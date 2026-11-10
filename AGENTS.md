# AGENTS.md — Agent Guidelines for ENISo Timetable → Word

## Git Workflow (mandatory)
- Never commit or push to `main`. First: `git switch main && git pull`, then create a branch named
  `feat/<short-kebab-name>` (or `fix/…`, `chore/…`, `docs/…`).
- Small commits using Conventional Commits (feat:, fix:, chore:, ci:, docs:, test:, refactor:).
- Before pushing, run the checks listed below (typecheck, build, tests) and fix failures.
- Push the branch, then open a Pull Request to `main` with `gh pr create` (title in Conventional Commits
  format; body = what changed, how you tested it, risks). If `gh` is not authenticated, print the exact
  PR title and body instead.
- Do not merge the PR. Do not force-push. Do not touch unrelated files.

## Overview
Desktop application converting FET HTML timetables (`*_rooms_*`, `*_teachers_*`, `*_groups_*`) into daily Word (`.docx`) documents (Lundi–Samedi). Replicates the reference layout of `Jeudi.docx`: rooms grouped by bloc (A, B, R + Amphi) × time slots with teacher names in cells. Stack: Electron + Next.js 15 (static export) + NestJS 11 / TypeORM + PostgreSQL (bundled v17 via `embedded-postgres`, or v16 via Docker in dev) + `docx`.

## Architecture
```
apps/
  api/       NestJS 11 backend: src/parser, src/export, src/timetables, src/settings, test/verify.ts
  web/       Next.js 15 frontend: static export to out/, served statically by API in production
  desktop/   Electron shell: manages embedded PostgreSQL, spawns API child process, native dialogs
```
Data flow: FET HTML → `html-parser.ts` → PostgreSQL `sessions` table → `grid-builder.ts` → `docx-builder.ts` → `.docx`.

## Commands
Run all commands from repository root unless scoped with `-w`.
- `npm install`: Install monorepo dependencies across all workspaces.
- `npm run build`: Build API (`nest build`) and web (`next build` export).
- `npm run build -w apps/api`: Build NestJS API into `apps/api/dist`.
- `npm run build -w apps/web`: Export static Next.js web app into `apps/web/out`.
- `npm run build -w apps/desktop`: Compile Electron main/preload TypeScript into `apps/desktop/dist`.
- `npm run dev:api`: Start API in watch mode on `http://127.0.0.1:4000` (requires PostgreSQL: `docker compose up -d` using `postgres:16` bound to `127.0.0.1:5432`).
- `npm run dev:web`: Start Next.js dev server on `http://localhost:3000` (proxies `/api` to `:4000`).
- `npm run test:verify -w apps/api -- <html-dir> [out-dir]`: E2E test verifying rooms vs teachers consistency (fails with exit code 1 on mismatch) and generating test DOCX files.
- `npm run stage -w apps/desktop`: Stage compiled API, production node_modules, and web export for packaging.
- `npm run pack` / `npm run dist`: Package desktop application with electron-builder into `apps/desktop/release/`.

## Conventions
- **TypeScript**: Strict mode enabled across all apps. Do not use unchecked `any`.
- **Language**: French for all UI strings and generated Word headers; English for code, identifiers, and comments.
- **Modularity**: Keep `apps/api/src/parser` and `apps/api/src/export` as small, pure functions with no side effects.
- **Controllers**: Keep controllers lean (HTTP/IPC routing, validation pipes, multipart handling only); place business logic in services.
- **Security**: Bind API and database servers strictly to `127.0.0.1` (including `docker-compose.yml` and `embedded-postgres`). Connecting to an externally managed remote database via `DATABASE_URL` is the only permitted exception and requires explicit user configuration.

## Domain Rules & Gotchas
- **Rowspan handling**: FET cells use `rowspan` for multi-slot sessions. Parser must track carried slots per day column and duplicate the session across all covered time slots.
- **Detailed split cells**: Multi-activity cells list parallel sessions. For `rooms` view, keep only activities where room matches the table owner. For `teachers` view, keep only activities where the teacher matches the table owner.
- **Detailed cell row order**: Differs by export type:
  * `rooms`: `['room', 'group', 'teacher', 'subject']`
  * `teachers`: `['teacher', 'group', 'subject', 'room']`
  * `groups`: `['group', 'subject', 'teacher', 'room']`
- **Rooms vs Teachers parity**: The rooms view and teachers view must describe identical session sets (`test/verify.ts` cross-checks this and exits with code 1 on mismatch).
- **Time slot overrides**: Header labels support per-day overrides (e.g., `(V: 14:00-15:30)` for Vendredi, `(M/S: 12:00-13:30)` for Mercredi/Samedi). Empty lunch slots display configurable `pauseLabel` (default: `Pause`).
- **Room formatting**: Standardize room labels: `A02` → `A 0-2`, `B12 (Labo Anglais)` → `B 1-2`, `Amphi` → `Amphi` (strip notes in parentheses, insert space and hyphen between block letter and digits).
- **Settings table**: User preferences (`blocs` regex list, `abbreviateBen` [BEN → B], `showFrequency` [1/15], `includeEmptyRooms`) persist in PostgreSQL `settings` table (`key = 'export'`).

## Packaging Gotchas
- **ASAR disabled (`asar: false`)**: PostgreSQL binaries (`embedded-postgres`) must remain raw executable files on disk; bundling into ASAR breaks execution.
- **`npmRebuild: false`**: Disabled in `apps/desktop/package.json` to prevent electron-builder from breaking prebuilt embedded binaries.
- **Staging workflow (`stage.js`)**: Production dependencies for the API are installed in an external OS temp folder (`os.tmpdir()`) before copying to `stage/api/node_modules`. Running `npm install` inside the workspace prunes root hoisted dependencies.
- **Release directory**: Packaging output artifacts (`.exe`, `.dmg`, `.AppImage`) are written to `apps/desktop/release/`.

## Testing Policy
Every bug fix starts with a failing test.

Before considering any task complete:
1. **Typecheck & Build**: Verify `npm run build` and `npm run build -w apps/desktop` complete with 0 errors.
2. **Data Consistency**: Run `npm run test:verify -w apps/api -- <html-dir>` when parser or grid logic changes; ensure zero discrepancy between rooms and teachers views (fails with non-zero exit code on mismatch).
3. **DOCX Visual Inspection**: When modifying `docx-builder.ts` or layout settings, generate and visually inspect the output `.docx` against `Jeudi.docx` (margins, column widths in twips, background colors, fonts).
4. If a change touches `apps/api/src/export` or the DOCX layout, run `npm run test:visual`, confirm all seven cases ran and passed (not skipped), and review any diff images before committing.

Test commands:
- `npm test`: API unit/integration and web component suites.
- `npm run test:coverage -w apps/api`: API parser/export coverage.
- `npx playwright install chromium`: install the browser required by the Chromium end-to-end suite.
- `npm run test:e2e`: Chromium end-to-end browser suite.
- `npm run test:verify -w apps/api -- <html-dir> [out-dir]`: fixture parity check and sample DOCX generation.

## Do / Don't
- **DO** keep HTTP and DB listeners strictly bound to `127.0.0.1`.
- **DO** write pure, deterministic functions in parser and export modules.
- **DO** ask before introducing new dependencies or changing package versions.
- **DO** preserve French terminology in timetable entities, exports, and UI strings.
- **DON'T** modify generated directories (`dist/`, `out/`, `.next/`, `stage/`, `release/`, `test-output/`).
- **DON'T** commit secrets, `.env` files, config overrides, or user database directories (`pgdata/`).
- **DON'T** put business logic, file I/O, or database queries directly in NestJS or Electron controllers.
- **DON'T** run raw `npm install` inside workspace subdirectories without understanding monorepo hoisting effects.
