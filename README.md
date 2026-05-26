# Node SQLite Server Snippets

A VS Code snippet extension that generates ready-to-use boilerplate code for **Express + SQLite3 + CORS** server development, plus an **offline AI code assistant** for school lab use (no internet needed).

---

## Installation

### Install from VSIX (Recommended)

1. Open VS Code.
2. Go to the **Extensions** sidebar (`Ctrl+Shift+X`).
3. Click the `...` (More Actions) menu â†’ **Install from VSIX...**
4. Select `node-sqlite-snippets-1.16.0.vsix`.
5. Reload VS Code if prompted.

> If the VSIX includes an AI model, skip to [Downloading AI Models](#downloading-ai-models) to build a smaller VSIX.

---

## Snippets

Works in **JavaScript**, **JSON**, **TypeScript**, **JSX/TSX**, and **HTML** files. Type the prefix and press `Tab` or `Enter`.

### Setup & Server
| Prefix | Description |
|--------|-------------|
| `njs-server` `njs-sv` | Full Express + Better-SQLite3 server with DB, CRUD, graceful shutdown |
| `njs-express` `njs-ex` | Minimal Express server skeleton |
| `njs-db` `njs-dbc` | SQLite connection boilerplate |
| `njs-setup` `njs-st` | Express + static files + DB setup |
| `njs-pkg` `njs-pk` | package.json dep list (express, better-sqlite3, cors, bcrypt, jwt, dotenv, nodemailer) |

### CRUD Routes
| Prefix | Description |
|--------|-------------|
| `njs-get` `njs-g` | GET route with SELECT |
| `njs-post` `njs-p` | POST route with INSERT |
| `njs-put` `njs-u` | PUT route with UPDATE |
| `njs-del` `njs-d` | DELETE route |
| `njs-router` `njs-rt` | Express Router with all CRUD boilerplate |

### Auth
| Prefix | Description |
|--------|-------------|
| `njs-users-table` `njs-ut` | Users table schema (email, password_hash, role, reset) |
| `njs-jwt` `njs-jt` | JWT sign token |
| `njs-auth` `njs-aw` | JWT verify middleware with optional role check |
| `njs-reg` `njs-rg` | Register route (bcrypt hash) |
| `njs-log` `njs-lg` | Login route (verify + return JWT) |
| `njs-forgot` `njs-fp` | Forgot password route |
| `njs-hash` `njs-hs` | bcrypt hash + compare helpers |

### Security
| Prefix | Description |
|--------|-------------|
| `njs-cors` `njs-cor` | CORS config |
| `njs-helmet` `njs-hm` | Helmet security headers |
| `njs-rate` `njs-rl` | Rate limiter |
| `njs-err` `njs-er` | Centralized error handler |

### Utils
| Prefix | Description |
|--------|-------------|
| `njs-mw` | Custom middleware |
| `njs-async` `njs-as` | Async error wrapper |
| `njs-env` `njs-envcfg` | dotenv config |
| `njs-val` `njs-vl` | express-validator |
| `njs-read` `njs-rd` | fs.readFile helper |
| `njs-write` `njs-wr` | fs.writeFile helper |
| `njs-path` `njs-ph` | path.join |
| `njs-page` `njs-pg` | SQL pagination |
| `njs-res` `njs-rsp` | Response wrapper |
| `njs-tx` `njs-trn` | SQLite transaction |

### Frontend
| Prefix | Description |
|--------|-------------|
| `njs-fetch` `njs-fc` | Fetch API wrapper |
| `njs-api` `njs-apc` | API Client class |
| `njs-list-js` `njs-ls` | Fetch + render list |
| `njs-form-js` `njs-fj` | Form submission handler |
| `njs-page-js` `njs-pj` | Full page JS (load, add, remove) |
| `njs-add-js` `njs-aj` | Standalone add function |
| `njs-update-js` `njs-uj` | Standalone update function |
| `njs-delete-js` `njs-dj` | Standalone delete function |

### Other
| Prefix | Description |
|--------|-------------|
| `njs-socket` `njs-sk` | Socket.io server |
| `njs-upload` `njs-up` | Multer file upload |
| `njs-mail` `njs-em` | Nodemailer email |
| `njs-logger` `njs-lg` | Morgan logger |
| `njs-cookie` `njs-ck` | Cookie parser |

---

## AI Code Assistant (Offline)

An offline AI that generates code directly in your editor using a local GGUF model. No internet, no API keys, no external services.

### Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| `AI: Turn On` | `Ctrl+Shift+T` | Start AI with snippet names only |
| `AI: Trained On` | — | Start AI with full snippet body context |
| `AI: Turn Off` | — | Stop AI |
| `AI: Fix Selected Code` | `Ctrl+Shift+F` | Fix selected code in-place |
| `njs:your instruction` | `Enter` then `Tab` | Generate code from instruction |

### Usage

1. **Turn on AI**: run `AI: Turn On` or `AI: Trained On` from Command Palette
2. **Generate code**: type `njs:make a route for users` and press Enter, then Tab
3. **Edit files**: type `njs:in server.js add body-parser`
4. **Fix selection**: select code, press `Ctrl+Shift+F`, describe the fix

### Two AI Modes

| Mode | How | What the AI sees |
|------|-----|-----------------|
| **Normal** (`AI: Turn On`) | Snippet names + descriptions only | Lightweight context |
| **Trained** (`AI: Trained On`) | All 45 snippet BODIES sent as context | AI writes exact snippet-style code |

Switch by turning off first, then turn on the other.

---

## Downloading AI Models

The AI requires a GGUF model file. Models are not included in the repo (gitignored). Download one and place it in the `models/` folder.

### Recommended Models (under 1 GB)

| Model | Size | Quality | Download |
|-------|------|---------|----------|
| Qwen2.5-Coder-1.5B Q3_K_M | ~882 MB | Good | [HuggingFace](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q3_k_m.gguf) |
| Qwen2.5-Coder-1.5B Q4_0 | ~1017 MB | Better | [HuggingFace](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q4_0.gguf) |
| Qwen2.5-Coder-0.5B Q4_K_M | ~468 MB | Fair (faster) | [HuggingFace](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-0.5b-instruct-q4_k_m.gguf) |
| DeepSeek-Coder-1.3B Q4_K_M | ~833 MB | Good | [HuggingFace](https://huggingface.co/TheBloke/deepseek-coder-1.3b-instruct-GGUF/resolve/main/deepseek-coder-1.3b-instruct.q4_k_m.gguf) |

### Download Commands

```bash
# Example: download Qwen 1.5B Q3_K_M (~882 MB, recommended)
curl -L -o models/qwen2.5-coder-1.5b-instruct.q3_k_m.gguf ^
  "https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q3_k_m.gguf"

# Or using PowerShell
Invoke-WebRequest -Uri "https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q3_k_m.gguf" -OutFile "models/qwen2.5-coder-1.5b-instruct.q3_k_m.gguf"
```

### Update Model Path

After downloading, update the model path in `src/extension.js`:

```js
const modelPath = vscode.Uri.joinPath(context.extensionUri, 'models', 'YOUR_MODEL_FILE.gguf').fsPath;
```

### Build VSIX with Model

```bash
vsce package
```

The model will be bundled into the VSIX automatically.

### Change Model

1. Delete old model from `models/`
2. Download new model
3. Update path in `src/extension.js`
4. Rebuild: `vsce package`

---

## Quick Start

1. Create `server.js` and type `njs-server`
2. Press Tab and fill placeholders
3. Type `njs-pkg` in `package.json`, then `npm install`
4. Run: `node server.js`
5. Your REST API is live on `http://localhost:3000`

---

## Requirements

- VS Code 1.74.0+
- Node.js
- For AI: a GGUF model file in `models/`

---

## License

MIT




