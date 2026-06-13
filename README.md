# Express Full-Stack Snippets

<p align="center">
  <img src="https://img.shields.io/badge/version-3.2.1-blue.svg" alt="Version 3.2.1"/>
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT License"/>
  <img src="https://img.shields.io/badge/VS%20Code-1.74%2B-purple.svg" alt="VS Code 1.74+"/>
  <img src="https://img.shields.io/badge/AI-Offline%20%7C%20GGUF-orange.svg" alt="Offline AI"/>
</p>

**The ultimate VS Code companion for building Express + SQLite full-stack applications.**  
Includes **45+ schema-aware snippets**, inline code generation, and an **offline AI code assistant** — no internet connection required.

---

## Features

- **45+ Production Snippets** — Express server setup, CRUD routes, JWT auth, bcrypt, CORS, file uploads, pagination, and more.
- **Schema-Aware Dynamic Generation** — Register your database tables and instantly generate CRUD routes, HTML lists, forms, and full-page UIs tailored to your schema.
- **Offline AI Assistant** — Built-in local AI using GGUF models. Turn it on, type `njs:make a route for users`, press Tab — code appears. No API keys, no cloud dependency.
- **Inline Code Fixer** — Select broken code, press `Ctrl+Shift+F`, describe the fix — AI rewrites it in place.
- **SQL Query Builder** — Interactive visual query builder with JOIN, GROUP BY, HAVING, aggregates, and SQL preview.
- **Schema Visualizer** — Visualize your registered tables, columns, and foreign key relationships.
- **Multi-Language Support** — Works in JavaScript, TypeScript, JSX/TSX, JSON, and HTML files.

---

## Installation

### From VSIX (Recommended)

1. Open VS Code -> Extensions sidebar (`Ctrl+Shift+X`)
2. Click `...` (More Actions) -> **Install from VSIX...**
3. Select `node-sqlite-snippets-3.2.1.vsix`
4. Reload VS Code if prompted

### From VS Code Marketplace

Search for **"Express Full-Stack Snippets"** in the Extensions panel and click Install.

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

## Offline AI Code Assistant

The extension includes a **fully offline** AI assistant powered by local GGUF models. No internet connection, no API keys, no external services.

### AI Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| **AI: Turn On** | `Ctrl+Shift+T` | Start AI with snippet names + descriptions as context |
| **AI: Trained On** | -- | Start AI with full snippet body context for more accurate generation |
| **AI: Turn Off** | -- | Stop the AI assistant |
| **AI: Fix Selected Code** | `Ctrl+Shift+F` | Select code, run command, describe the fix -- AI rewrites it |
| **njs:your instruction** | `Enter` then `Tab` | Type `njs:make a route for users` -> Enter -> Tab -> code appears |

### How to Use AI

1. **Turn on AI**: Run `AI: Turn On` or `AI: Trained On` from Command Palette
2. **Generate code**: Type `njs:create a products table with name, price, stock` -> Enter -> Tab
3. **Edit files**: Type `njs:in server.js add body-parser middleware` -> Enter -> Tab
4. **Fix code**: Select code, press `Ctrl+Shift+F`, describe what to fix

### AI Modes

| Mode | Context | Best For |
|------|---------|----------|
| **Normal** (`AI: Turn On`) | Snippet names + descriptions | Lightweight, faster generation |
| **Trained** (`AI: Trained On`) | All 45+ snippet bodies | AI writes exact snippet-style code |

### Downloading AI Models

Download a GGUF model and place it in the `models/` folder:

| Model | Size | Quality | Download |
|-------|------|---------|----------|
| Qwen2.5-Coder-1.5B Q3_K_M | ~882 MB | Good | [HuggingFace](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q3_k_m.gguf) |
| Qwen2.5-Coder-1.5B Q4_0 | ~1017 MB | Better | [HuggingFace](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q4_0.gguf) |
| Qwen2.5-Coder-0.5B Q4_K_M | ~468 MB | Fair (faster) | [HuggingFace](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-0.5b-instruct-q4_k_m.gguf) |
| DeepSeek-Coder-1.3B Q4_K_M | ~833 MB | Good | [HuggingFace](https://huggingface.co/TheBloke/deepseek-coder-1.3b-instruct-GGUF/resolve/main/deepseek-coder-1.3b-instruct.q4_k_m.gguf) |

```bash
# Example: download Qwen 1.5B (recommended)
curl -L -o models/qwen2.5-coder-1.5b-instruct.q3_k_m.gguf \
  "https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q3_k_m.gguf"
```

After downloading, update the model path in `src/extension.js`:

```js
const modelPath = vscode.Uri.joinPath(context.extensionUri, 'models', 'YOUR_MODEL.gguf').fsPath;
```

> **Tip:** Bundle the model with your VSIX by placing it in `models/` before running `vsce package`.

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

---

## Requirements

- **VS Code** 1.74.0 or higher
- **Node.js** 14.x or higher
- **For AI**: A GGUF model file in `models/` directory (optional)

---

## License

This project is licensed under the **MIT License**.

---

<p align="center">
  Made with love by <a href="https://github.com/maxxNcode">maxxNcode</a>
</p>
