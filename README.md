# NODEJS EXPRESS WORKBENCH

<p align="center">
  <img src="https://img.shields.io/badge/version-3.9.0-blue.svg" alt="Version 3.9.0"/>
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT License"/>
  <img src="https://img.shields.io/badge/VS%20Code-1.74%2B-purple.svg" alt="VS Code 1.74+"/>
</p>

**The ultimate VS Code companion for building Express + SQLite full-stack applications.**  
Includes **45+ schema-aware snippets** and inline code generation.

---

## Features

- **45+ Production Snippets** — Express server setup, CRUD routes, JWT auth, bcrypt, CORS, file uploads, pagination, and more.
- **Schema-Aware Dynamic Generation** — Register your database tables and instantly generate CRUD routes, HTML lists, forms, and full-page UIs tailored to your schema.
- **SQL Query Builder** — Interactive visual query builder with JOIN, GROUP BY, HAVING, aggregates, and SQL preview.
- **Schema Visualizer** — Visualize your registered tables, columns, and foreign key relationships.
- **Multi-Language Support** — Works in JavaScript, TypeScript, JSX/TSX, JSON, and HTML files.

---

## Installation

### From VSIX (Recommended)

1. Open VS Code -> Extensions sidebar (`Ctrl+Shift+X`)
2. Click `...` (More Actions) -> **Install from VSIX...**
3. Select `nodejs-express-workbench-3.9.0.vsix`
4. Reload VS Code if prompted

### From VS Code Marketplace

Search for **"NODEJS EXPRESS WORKBENCH"** in the Extensions panel and click Install.

---

## Quick Start

```bash
# 1. Create your server file
#    Type 'njs-server' in server.js -> press Tab
#
# 2. Add package.json
#    Type 'njs-pkg' in package.json -> press Tab -> npm install
#
# 3. Start your server
node server.js
#    Your REST API is live at http://localhost:3000
```

### Whole project from a schema

This is the fastest path when the clock is running:

1. Paste your `CREATE TABLE` statements into any `.sql` or `.js` file, select them, and run **njs: Register this table** (MySQL dumps work too: **njs: Parse MySQL Schema**).
2. Open **njs: Schema Visualizer** to set field UI types, save queries, and add transaction, report or widget screens.
3. Run **njs: Generate Project Files**, or click **Generate Project** in the visualizer. It asks which table (if any) is used for login and which saved queries become report pages, then writes `server.js`, `package.json`, `.env` and `public/*.html`.
4. Pick **npm install && npm start** from the prompt and open http://localhost:3000.

When files already exist you choose between overwriting everything and writing only the missing ones, so you can regenerate after changing the schema without losing hand edits.

---

## Snippets Reference

### Setup & Server

| Prefix | Description |
|--------|-------------|
| `njs-server` `njs-sv` | Full Express + Better-SQLite3 server with DB, CRUD, graceful shutdown |
| `njs-express` `njs-ex` | Minimal Express server skeleton |
| `njs-db` `njs-dbc` | SQLite connection boilerplate |
| `njs-setup` `njs-st` | Express + static files + DB setup |
| `njs-pkg` `njs-pk` | package.json with all deps (express, better-sqlite3, cors, bcrypt, jwt, dotenv, nodemailer) |

### CRUD Routes

| Prefix | Description |
|--------|-------------|
| `njs-get` `njs-g` | GET route with SELECT query |
| `njs-post` `njs-p` | POST route with INSERT |
| `njs-put` `njs-u` | PUT route with UPDATE |
| `njs-del` `njs-d` | DELETE route (or deactivate pattern) |
| `njs-router` `njs-rt` | Express Router with all CRUD boilerplate |

### Authentication

| Prefix | Description |
|--------|-------------|
| `njs-users-table` `njs-ut` | Users table schema (email, password_hash, role, reset token) |
| `njs-jwt` `njs-jt` | JWT sign + verify helpers |
| `njs-auth` `njs-aw` | JWT verify middleware with optional role check |
| `njs-reg` `njs-rg` | Register route with bcrypt hashing |
| `njs-log` `njs-lg` | Login route (verify credentials + return JWT) |
| `njs-forgot` `njs-fp` | Forgot password route with email reset |
| `njs-hash` `njs-hs` | bcrypt hash + compare utility functions |

### Security

| Prefix | Description |
|--------|-------------|
| `njs-cors` `njs-cor` | CORS configuration |
| `njs-helmet` `njs-hm` | Helmet security headers |
| `njs-rate` `njs-rl` | Rate limiter with express-rate-limit |
| `njs-err` `njs-er` | Centralized error handler middleware |

### Utilities

| Prefix | Description |
|--------|-------------|
| `njs-mw` | Custom middleware template |
| `njs-async` `njs-as` | Async error wrapper for Express routes |
| `njs-env` `njs-envcfg` | dotenv configuration |
| `njs-val` `njs-vl` | express-validator input validation |
| `njs-read` `njs-rd` | fs.readFile helper |
| `njs-write` `njs-wr` | fs.writeFile helper |
| `njs-path` `njs-ph` | path.join utility |
| `njs-page` `njs-pg` | SQL pagination (LIMIT/OFFSET) |
| `njs-res` `njs-rsp` | Standardized response wrapper |
| `njs-tx` `njs-trn` | SQLite transaction wrapper |

### Frontend / Client

| Prefix | Description |
|--------|-------------|
| `njs-fetch` `njs-fc` | Fetch API wrapper with error handling |
| `njs-api` `njs-apc` | API Client class with CRUD methods |
| `njs-list-js` `njs-ls` | Fetch + render dynamic HTML list |
| `njs-form-js` `njs-fj` | Form submission handler |
| `njs-page-js` `njs-pj` | Full page JS (load, add, update, delete) |
| `njs-add-js` `njs-aj` | Standalone add function |
| `njs-update-js` `njs-uj` | Standalone update function |
| `njs-delete-js` `njs-dj` | Standalone delete function |

### Other

| Prefix | Description |
|--------|-------------|
| `njs-socket` `njs-sk` | Socket.io server setup |
| `njs-upload` `njs-up` | Multer file upload configuration |
| `njs-mail` `njs-em` | Nodemailer email sender |
| `njs-logger` `njs-lg` | Morgan HTTP request logger |
| `njs-cookie` `njs-ck` | Cookie-parser middleware |

---

## Schema Registry & Dynamic Generation

Register your database tables and generate code automatically:

| Command | Description |
|---------|-------------|
| `njs: Register Table` | Register a table schema for code generation |
| `njs: Remove Table` | Remove a registered table |
| `njs: Modify Table Fields` | Update fields of a registered table |
| `njs: Register this table` | Register from a CREATE TABLE SQL statement |
| `njs: Schema Status` | View all registered schemas |
| `njs: Add Foreign Key` | Define foreign key relationships |
| `njs: Remove Foreign Key` | Remove foreign key relationships |
| `njs: Schema Visualizer` | Open visual schema diagram |
| `njs: Generate All Tables` | Generate all registered tables at once |
| `njs: Generate Project Files` | Write a runnable server.js, package.json, .env and HTML pages from the schema |
| `njs: Parse MySQL Schema` | Convert a MySQL CREATE TABLE dump to SQLite and register it |
| `njs: Setup TailwindCSS` | Add Tailwind v4 to the current project |

---

## What's new in 3.9.0

- **Generate Project Files** writes the whole app (server, login, CRUD pages, dashboard, screens) in one step, and the visualizer has a button for it.
- The login setup you pick in the visualizer is saved in `.njs-schema.json` and reused by Generate Project.
- Dashboard widgets get a working `/api/widget/<name>` route, and the dashboard links to every transaction and report screen.
- Transaction screens honor the screen's login setting, and their data route no longer breaks on multi-line SQL.
- Buttons in the visualizer insert into the last file you had open instead of failing with "Open a file first". With no file open they offer to create `server.js`.
- **Modify Table Fields** keeps table settings and field UI types. Removing a table clears foreign keys that pointed at it.
- `DEFAULT x CHECK(...)` in inline field specs now parses as two separate constraints.
- The offline AI commands report a missing model or a load timeout instead of claiming success.
- `njs:` line commands only fire in JS/TS/HTML/SQL/plain-text files.

---

## Requirements

- **VS Code** 1.74.0 or higher
- **Node.js** 14.x or higher


---

## License

This project is licensed under the **MIT License**.

---

<p align="center">
  Made with love by <a href="https://github.com/weonlyliveonce">weonlyliveonce</a>
</p>
