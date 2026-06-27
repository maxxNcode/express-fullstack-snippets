# Summary — NODEJS_SQLITE FullStack Extension

## Project
VS Code extension (`node-sqlite-snippets`) providing SQLite schema visualization, CRUD scaffolding, auth code generation, and Node.js snippets. Distributed as `.vsix`.

## Fixed This Session

### Secret Storage Dropdown
- **New dropdown** (`authOptSecretStorage`): Replaces implicit `.env`-only behavior with a choice between `.env` and `config.js` for JWT secret keys
- **`generateConfigJs()`**: New method producing a `config.js` file with `module.exports = { JWT_SECRET: '...', JWT_REFRESH_SECRET: '...' }`
- **`generateLogin()`**: When `config.js` selected, adds `const config = require('./config')` and uses `config.JWT_SECRET` / `config.JWT_REFRESH_SECRET` instead of `process.env.*`
- **`generateAuthMiddleware()`**: Same adaptation — `jwt.verify(token, config.JWT_SECRET)` and refresh endpoint uses `config.JWT_REFRESH_SECRET`
- **`generateEnvContent()`**: When `config.js` selected, skips JWT secrets in `.env` output (only PORT + DB_PATH), adds comment pointing to config.js
- **`generateSetupGuide()`**: Adapts step 2 (requires both dotenv and config.js) and step 3 (shows config.js example instead of .env secrets)
- **Client webview** (`webview/schemaView.js`): `generateAuth()` and `previewAuthSql()` read `authOptSecretStorage.value` and forward as `options.secretStorage`
- **Server handlers** (`schemaView.js`): Extract `secretStorage` from opts, include in `baseOpts`, conditionally emit `generateConfigJs()` output
- **Dropdown default**: `.env` (backward compatible)

### Auth Generator (complete flexibility)
- **Logout without JWT**: Removed `if (!useJwt) return 'Skipping...'` guard from `generateLogout()` — logout route now generates regardless of JWT checkbox
- **schemaView.js logout dependency**: `genLogout = useJwt && genLogoutRequested` changed to `genLogout = genLogoutRequested` at both server handler sites
- **Refresh token checkbox**: Added `authOptRefreshToken` checkbox (default ON). `generateLogin()` only emits `refreshToken` in JWT response when checked. `generateAuthMiddleware()` wraps refresh endpoint in `if (useRefreshToken)`. `generateAuthClientJs()` makes entire refresh logic conditional on `useRefreshToken`
- **Rate limiter checkbox**: Added `authOptRateLimiter` checkbox (default ON). `generateAuthMiddleware()` wraps rate limiter in `if (useRateLimiter)`. When off, no `express-rate-limit` import
- **`generateEnvContent`**: `JWT_REFRESH_SECRET` line conditional on `useRefreshToken`
- **`generateLoginFormHtml`**: `localStorage.setItem('refreshToken', ...)` conditional on `useRefreshToken`
- **`generateSetupGuide`**: `JWT_REFRESH_SECRET` mention conditional on `useRefreshToken`; `genLogout` no longer requires `useJwt`

### Bug Fixes
- **Bug 3 (ruleEngine.js)**: `this._getPK(rule.limitTable)` and `this._inferIdentityField(rule.checkTable)` evaluated at runtime where `this` is not RuleEngine → pre-evaluated at generation time into local variables (`limitPK`, `identityField`)
- **Bug 17 (ruleEngine.js)**: Duplicate delegating wrappers `generateReportHtml` / `generateReportServer` overwritten by actual implementations → removed wrappers
- **Bug 1/2 (schemaRegistry.js)**: `parseInlineSpec` split on commas inside quoted DEFAULT values (e.g. `'hello, world'`) → replaced with quote-aware parser; FK parser failed on `FK-> Table(Field)` with space → now accepts optional space; DEFAULT value collector dropped multi-word quoted strings → fixed
- **Bug 32/5 (scaffolder.js)**: Spurious `\\\n` in CRUD page JS string generation causing browser syntax errors → removed ~84 occurrences
- **scaffolder.js edit button bug**: `onclick="editRecord(id)"` → `onclick="editRecord(row.id)"` (bare `id` was undefined)

### Snippet
- **njs-server snippet**: Removed `db.pragma('journal_mode = WAL')`, all pre-generated CREATE TABLE/CRUD routes; added `const path = require('path')` + `app.use(express.static(path.join(__dirname, 'public')))` — now a lean skeleton (DB init + static serving + graceful shutdown)

## Current Build
- `node-sqlite-snippets-3.4.0.vsix` — 90 files, 20.02 MB
- Auth Generator: 9 independently toggleable features (JWT, bcrypt, login route, register route, logout route, login HTML, register HTML, refresh token, rate limiter)
- No hidden dependencies; each checkbox controls exactly its own output

## Architecture
- Extension activates from `.sqlite` files; registers schema visualizer (webview), CRUD scaffolder, auth generator, and snippet completion
- Schema parsed via `schemaRegistry.js`; SQL output via `sqlGenerator.js`; rules via `ruleEngine.js`
- UI: Tree views + webview panels + status bar integration
