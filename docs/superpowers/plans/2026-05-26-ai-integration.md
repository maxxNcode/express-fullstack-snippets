# AI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed Qwen2.5-Coder-0.5B GGUF model + llama-server.exe inside the extension VSIX, enabling offline AI code generation via a magic `njs:` prefix.

**Architecture:** llama-server.exe (~25MB) is bundled in `bin/`, the GGUF model (~398MB) in `models/`. On "AI: Turn On", the extension spawns llama-server as a hidden child process and communicates via HTTP on `localhost:23333`. A `InlineCompletionItemProvider` detects `njs:<instruction>` lines and calls the AI to generate code, inserting it on Tab. All 45 snippets are fed as system context so the AI knows about them.

**Tech Stack:** Plain JavaScript (no build step), VS Code Extension API, Node.js `child_process` + `http`, llama.cpp llama-server

---

### Task 1: Update package.json for extension code

**Files:**
- Modify: `package.json` (entire file)

- [ ] **Step 1: Write updated package.json**

```json
{
  "name": "node-sqlite-snippets",
  "displayName": "Node SQLite Server Snippets",
  "description": "Quick snippets for Express, SQLite3, Node.js backends and HTML frontend boilerplates - build fullstack apps faster.",
  "version": "1.16.0",
  "publisher": "maxxNcode",
  "license": "MIT",
  "icon": "icon.png",
  "repository": {
    "type": "git",
    "url": "https://github.com/yourusername/node-sqlite-snippets.git"
  },
  "engines": {
    "vscode": "^1.74.0"
  },
  "categories": ["Snippets"],
  "main": "./src/extension.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [
      {
        "command": "node-sqlite-ai.enable",
        "title": "AI: Turn On"
      },
      {
        "command": "node-sqlite-ai.disable",
        "title": "AI: Turn Off"
      }
    ],
    "configuration": {
      "title": "Node SQLite AI",
      "properties": {
        "node-sqlite-ai.port": {
          "type": "number",
          "default": 23333,
          "description": "Port for the local AI server"
        },
        "node-sqlite-ai.magicPrefix": {
          "type": "string",
          "default": "njs:",
          "description": "Text prefix to trigger AI code generation"
        },
        "node-sqlite-ai.enableAutocomplete": {
          "type": "boolean",
          "default": false,
          "description": "Enable inline ghost text autocomplete"
        }
      }
    },
    "snippets": [
      {
        "language": "javascript",
        "path": "./snippets/javascript.json"
      },
      {
        "language": "html",
        "path": "./snippets/html.json"
      }
    ]
  }
}
```

- [ ] **Step 2: Verify no syntax errors**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))" && echo "VALID"`
Expected: `VALID`

- [ ] **Step 3: Commit**

```
git add package.json
git commit -m "chore: add extension main entry, AI commands, and settings"
```

---

### Task 2: Create src/extension.js — main entry point

**Files:**
- Create: `src/extension.js`

- [ ] **Step 1: Write src/extension.js**

```javascript
const vscode = require('vscode');
const { ServerManager } = require('./serverManager');
const { AiClient } = require('./aiClient');
const { MagicSnippetProvider } = require('./magicSnippet');
const { InlineAutocompleteProvider } = require('./inlineProvider');

let serverManager;
let aiClient;
let activeProviders = [];

function activate(context) {
    serverManager = new ServerManager();
    aiClient = new AiClient();

    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.enable', async () => {
            if (serverManager.isRunning()) {
                vscode.window.showInformationMessage('AI: Already running');
                return;
            }

            const port = vscode.workspace.getConfiguration('node-sqlite-ai').get('port');
            const modelPath = vscode.Uri.joinPath(context.extensionUri, 'models', 'qwen2.5-coder-0.5b-q4_k_m.gguf').fsPath;
            const serverPath = vscode.Uri.joinPath(context.extensionUri, 'bin', 'llama-server.exe').fsPath;

            try {
                await serverManager.start(port, modelPath, serverPath);
                aiClient.setPort(port);

                const magicProvider = new MagicSnippetProvider(aiClient, context);
                const magicDisposable = vscode.languages.registerInlineCompletionItemProvider(
                    { language: 'javascript' }, magicProvider
                );
                activeProviders.push(magicDisposable);

                const enableAuto = vscode.workspace.getConfiguration('node-sqlite-ai').get('enableAutocomplete');
                if (enableAuto) {
                    const autoProvider = new InlineAutocompleteProvider(aiClient);
                    const autoDisposable = vscode.languages.registerInlineCompletionItemProvider(
                        { language: 'javascript' }, autoProvider
                    );
                    activeProviders.push(autoDisposable);
                }

                vscode.window.showInformationMessage('AI: Turned on and ready');
            } catch (err) {
                vscode.window.showErrorMessage(`AI: Failed to start — ${err.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.disable', async () => {
            serverManager.stop();
            activeProviders.forEach(d => d.dispose());
            activeProviders = [];
            vscode.window.showInformationMessage('AI: Turned off');
        })
    );

    context.subscriptions.push({ dispose: () => serverManager.stop() });
}

function deactivate() {
    if (serverManager) serverManager.stop();
}

module.exports = { activate, deactivate };
```

- [ ] **Step 2: Verify file was created**

Run: `Test-Path -LiteralPath "src/extension.js"`
Expected: `True`

- [ ] **Step 3: Commit**

```
git add src/extension.js
git commit -m "feat: add extension entry point with AI on/off commands"
```

---

### Task 3: Create src/serverManager.js — llama-server process lifecycle

**Files:**
- Create: `src/serverManager.js`

- [ ] **Step 1: Write src/serverManager.js**

```javascript
const { spawn } = require('child_process');
const path = require('path');

class ServerManager {
    constructor() {
        this.process = null;
    }

    start(port, modelPath, serverPath) {
        return new Promise((resolve, reject) => {
            if (this.process) {
                resolve();
                return;
            }

            const args = ['-m', modelPath, '--port', String(port), '--ctx-size', '8192', '--n-gpu-layers', '0'];

            this.process = spawn(serverPath, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true
            });

            this.process.stderr.on('data', (data) => {
                const text = data.toString();
                if (text.includes('model loaded') || text.includes('llama server listening')) {
                    resolve();
                }
            });

            this.process.on('error', (err) => {
                this.process = null;
                reject(new Error(`Failed to spawn llama-server: ${err.message}`));
            });

            this.process.on('exit', (code) => {
                this.process = null;
            });

            setTimeout(() => {
                if (this.process) {
                    resolve();
                } else {
                    reject(new Error('Server process exited before becoming ready'));
                }
            }, 10000);
        });
    }

    stop() {
        if (this.process) {
            this.process.kill('SIGTERM');
            this.process = null;
        }
    }

    isRunning() {
        return this.process !== null && !this.process.killed;
    }
}

module.exports = { ServerManager };
```

- [ ] **Step 2: Verify syntax**

Run: `node -c src/serverManager.js`
Expected: `SyntaxError ...` (if invalid) or no output (if valid)

- [ ] **Step 3: Commit**

```
git add src/serverManager.js
git commit -m "feat: add llama-server process lifecycle manager"
```

---

### Task 4: Create src/aiClient.js — HTTP client for model inference

**Files:**
- Create: `src/aiClient.js`

- [ ] **Step 1: Write src/aiClient.js**

```javascript
const http = require('http');

class AiClient {
    constructor() {
        this.port = 23333;
        this.host = '127.0.0.1';
    }

    setPort(port) {
        this.port = port;
    }

    complete(prompt, systemContext, maxTokens = 512) {
        return new Promise((resolve, reject) => {
            const fullPrompt = systemContext
                ? `${systemContext}\n\n### Instruction:\n${prompt}\n\n### Response:\n`
                : prompt;

            const body = JSON.stringify({
                prompt: fullPrompt,
                n_predict: maxTokens,
                temperature: 0.2,
                stop: ['\n\n\n', '### ', '<|im_end|>'],
                cache_prompt: true
            });

            const req = http.request(
                {
                    hostname: this.host,
                    port: this.port,
                    path: '/completion',
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                },
                (res) => {
                    let data = '';
                    res.on('data', (chunk) => (data += chunk));
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            resolve(parsed.content || '');
                        } catch (e) {
                            reject(new Error('Failed to parse AI response'));
                        }
                    });
                }
            );

            req.on('error', (err) => reject(new Error(`AI request failed: ${err.message}`)));
            req.write(body);
            req.end();
        });
    }

    isAvailable() {
        return new Promise((resolve) => {
            const req = http.get(`http://${this.host}:${this.port}/health`, (res) => {
                resolve(res.statusCode === 200);
            });
            req.on('error', () => resolve(false));
            req.end();
        });
    }
}

module.exports = { AiClient };
```

- [ ] **Step 2: Verify syntax**

Run: `node -c src/aiClient.js`
Expected: No errors

- [ ] **Step 3: Commit**

```
git add src/aiClient.js
git commit -m "feat: add HTTP client for llama-server API"
```

---

### Task 5: Create src/magicSnippet.js — njs: inline completion provider

**Files:**
- Create: `src/magicSnippet.js`

- [ ] **Step 1: Write src/magicSnippet.js**

```javascript
const vscode = require('vscode');
const fs = require('fs');

class MagicSnippetProvider {
    constructor(aiClient, context) {
        this.aiClient = aiClient;
        this.snippets = this.buildSnippetsContext(context);
        this.requestCounter = 0;
    }

    buildSnippetsContext(context) {
        try {
            const snippetsPath = vscode.Uri.joinPath(context.extensionUri, 'snippets', 'javascript.json').fsPath;
            const raw = fs.readFileSync(snippetsPath, 'utf8');
            const parsed = JSON.parse(raw);
            const lines = [];
            for (const [name, data] of Object.entries(parsed)) {
                const prefixes = Array.isArray(data.prefix) ? data.prefix.join(', ') : data.prefix;
                lines.push(`- ${prefixes}: ${data.description}`);
            }
            return lines.join('\n');
        } catch (e) {
            return '';
        }
    }

    provideInlineCompletionItems(document, position) {
        const config = vscode.workspace.getConfiguration('node-sqlite-ai');
        const prefix = config.get('magicPrefix');
        const line = document.lineAt(position.line).text;

        if (!line.startsWith(prefix)) return [];

        const instruction = line.substring(prefix.length).trim();
        if (!instruction) return [];

        const requestId = ++this.requestCounter;

        const systemContext = `You are a code assistant for Express + SQLite backends.\nAvailable snippets:\n${this.snippets}\n\nUse these snippets when they match. Combine them if needed. Write from scratch if nothing fits. Output ONLY valid JavaScript code. No explanations, no markdown.`;

        const resultPromise = new Promise(async (resolve) => {
            await new Promise(r => setTimeout(r, 400));
            if (requestId !== this.requestCounter) { resolve([]); return; }
            try {
                const code = await this.aiClient.complete(instruction, systemContext, 512);
                const cleaned = code.replace(/^```(?:javascript|js)?\n?/i, '').replace(/\n?```\s*$/, '').trim();
                if (!cleaned) { resolve([]); return; }
                const range = new vscode.Range(position.line, 0, position.line, line.length);
                resolve([new vscode.InlineCompletionItem(cleaned, range)]);
            } catch (e) {
                resolve([]);
            }
        });

        return [new vscode.InlineCompletionList(resultPromise)];
    }
}

module.exports = { MagicSnippetProvider };
```

- [ ] **Step 2: Verify syntax**

Run: `node -c src/magicSnippet.js`
Expected: No errors

- [ ] **Step 3: Commit**

```
git add src/magicSnippet.js
git commit -m "feat: add njs: magic snippet provider that calls AI"
```

---

### Task 6: Create src/inlineProvider.js — optional autocomplete

**Files:**
- Create: `src/inlineProvider.js`

- [ ] **Step 1: Write src/inlineProvider.js**

```javascript
const vscode = require('vscode');

class InlineAutocompleteProvider {
    constructor(aiClient) {
        this.aiClient = aiClient;
    }

    provideInlineCompletionItems(document, position) {
        const startLine = Math.max(0, position.line - 30);
        const contextLines = [];
        for (let i = startLine; i < position.line; i++) {
            contextLines.push(document.lineAt(i).text);
        }
        const currentLine = document.lineAt(position.line).text.substring(0, position.character);
        contextLines.push(currentLine);

        const context = contextLines.join('\n');

        const cts = new vscode.CancellationTokenSource();

        const promise = this.aiClient.complete(context, null, 128).then((code) => {
            const cleaned = code.replace(/^```(?:javascript|js)?\n?/i, '').replace(/\n?```\s*$/, '').trim();
            if (!cleaned) return [];
            const firstLine = cleaned.split('\n')[0];
            return [new vscode.InlineCompletionItem(firstLine)];
        });

        return new vscode.InlineCompletionList(promise);
    }
}

module.exports = { InlineAutocompleteProvider };
```

- [ ] **Step 2: Verify syntax**

Run: `node -c src/inlineProvider.js`
Expected: No errors

- [ ] **Step 3: Commit**

```
git add src/inlineProvider.js
git commit -m "feat: add optional inline autocomplete provider"
```

---

### Task 7: Download and bundle llama-server.exe

**Files:**
- Create: `bin/` directory
- Place: `bin/llama-server.exe`

- [ ] **Step 1: Download llama-server Windows x64 binary**

Download URL: `https://github.com/ggml-org/llama.cpp/releases/latest/download/llama-server-bin-win-avx2-x64.7z`

Extract `llama-server.exe` from the archive and place it at `bin/llama-server.exe`. Use the **avx2-x64** build (CPU-only, no GPU required). If the lab computers are older and lack AVX2, use `llama-server-bin-win-noavx-x64.7z` instead.

Verify it runs:
```
bin\llama-server.exe --help
```
Expected: Shows help text (model loading instructions)

- [ ] **Step 2: Commit**

```
git add bin/llama-server.exe
git commit -m "feat: bundle llama-server Windows x64 binary"
```

---

### Task 8: Download and bundle Qwen2.5-Coder-0.5B model

**Files:**
- Create: `models/` directory
- Place: `models/qwen2.5-coder-0.5b-q4_k_m.gguf`

- [ ] **Step 1: Download the GGUF model**

Download URL: `https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-0.5b-instruct-q4_k_m.gguf`

Place at `models/qwen2.5-coder-0.5b-q4_k_m.gguf` (~398MB).

- [ ] **Step 2: Verify file size**

Run: `(Get-Item "models\qwen2.5-coder-0.5b-q4_k_m.gguf").Length / 1MB`
Expected: ~398 (MB)

- [ ] **Step 3: Commit**

```
git add models/qwen2.5-coder-0.5b-q4_k_m.gguf
git commit -m "feat: bundle Qwen2.5-Coder-0.5B GGUF model"
```

---

### Task 9: Update .vscodeignore and build VSIX

**Files:**
- Modify: `.vscodeignore`

- [ ] **Step 1: Write updated .vscodeignore**

```
.vscodeignore
.opencode/**
vsix_temp/**
node_modules/**
*.vsix
MY-STORE-GUIDE.md
docs/**
```

No changes needed — `bin/` and `models/` are not excluded, so they'll be packed.

- [ ] **Step 2: Build the VSIX**

Run: `vsce package`
Expected: `node-sqlite-snippets-1.16.0.vsix` created

- [ ] **Step 3: Verify VSIX contents**

Run: `vsce ls`
Expected: Shows all files including `bin/llama-server.exe`, `models/qwen2.5-coder-0.5b-q4_k_m.gguf`, `src/extension.js`, `src/serverManager.js`, `src/aiClient.js`, `src/magicSnippet.js`, `src/inlineProvider.js`, `snippets/javascript.json`, `snippets/html.json`

- [ ] **Step 4: Manual test on clean machine**
  1. Copy the `.vsix` to a school lab computer via USB
  2. In VS Code: Extensions → Install from VSIX → select the file
  3. Open a `.js` file
  4. Run `AI: Turn On` from Command Palette
  5. Wait ~3s for the server to load the model (check Task Manager for `llama-server.exe`)
  6. Type `njs:create a login route with jwt` and press Tab
  7. Verify the line is replaced with generated code
  8. Run `AI: Turn Off` — verify process disappears from Task Manager

- [ ] **Step 5: Commit**

```
git add .vscodeignore
git commit -m "chore: update .vscodeignore, build v1.16.0 VSIX"
```
