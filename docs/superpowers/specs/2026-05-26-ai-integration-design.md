# AI Integration Design — Fully Offline Code Generation in VSIX

**Date:** 2026-05-26
**Version:** 1.16.0
**Status:** Design Approved

## Purpose

Embed a local AI code generation model inside the `node-sqlite-snippets` VS Code extension so that it works 100% offline, requires no installers, and can be sideloaded via USB in a school lab environment.

## Constraints

- Must be a single `.vsix` file (~430MB) containing everything needed
- No internet access after download
- No ability to install system packages or run installers
- Must not be detectable as "AI" by lab coordinators — no chat panels, no "AI" labels, no network requests
- Must run on Windows x64 school lab computers (CPU only, no GPU)
- Must work alongside the existing 45 snippets and be aware of them

## Architecture

### VSIX Package Layout

```
node-sqlite-snippets-1.16.0.vsix
├── extension/
│   ├── package.json
│   ├── snippets/
│   │   ├── javascript.json   (45 existing snippets)
│   │   └── html.json
│   ├── src/
│   │   ├── activate.ts       (entry point — spawns/kills server, registers providers)
│   │   ├── serverManager.ts  (manages llama-server.exe lifecycle)
│   │   ├── aiClient.ts       (HTTP client to local AI server)
│   │   ├── magicSnippet.ts   (intercepts `njs:` prefix → Tab → AI generation)
│   │   └── inlineProvider.ts (optional: ghost text autocomplete)
│   └── bin/
│       └── llama-server.exe  (~25MB, static Windows x64 binary)
├── models/
│   └── qwen2.5-coder-0.5b-q4_k_m.gguf  (~398MB)
└── .vscodeignore
```

### Data Flow

1. **Activation:** VS Code loads extension → `activate.ts` checks if AI was previously enabled
2. **Server lifecycle:** `serverManager.ts` spawns `llama-server.exe -m model.gguf --port 23333 --ctx-size 2048 --n-gpu-layers 0` as a hidden child process
3. **Client:** `aiClient.ts` sends HTTP POST to `localhost:23333/completion` with prompt + snippets context
4. **Magic snippet:** `magicSnippet.ts` registers a completion provider that:
   - Watches for `njs:` prefix in JavaScript/HTML files
   - On Tab press, captures the instruction text
   - Prepends snippet definitions as system context
   - Calls AI, replaces `njs:<instruction>` with generated code
5. **Deactivation:** Extension kills the child process on shutdown

## AI Features

### Primary: Magic `njs:` Command

- Type `njs:create a login route with jwt` in any `.js` file
- Press Tab → line is replaced with generated code
- AI is fed all 45 snippets as context before every request
- AI can use snippets, combine multiple snippets, or write from scratch depending on the instruction
- Prefix `njs:` is configurable via VS Code settings (e.g., `ai:` or just `:`)

### Secondary: Inline Autocomplete (Optional)

- `inlineProvider.ts` implements `InlineCompletionItemProvider`
- Sends context before cursor (last 30 lines) to model
- Shows ghost text suggestions silently as you type
- Can be toggled off if too visible

### Not Included

- No chat panel or side panel
- No "AI" branding anywhere in the UI
- No visible indicators that an AI is running
- No network requests

## Commands

Two commands accessible via `Ctrl+Shift+P`:

| Command ID | Label | Action |
|-----------|-------|--------|
| `node-sqlite-ai.enable` | AI: Turn On | Spawns llama-server, loads model, activates providers |
| `node-sqlite-ai.disable` | AI: Turn Off | Kills server, frees RAM, deactivates providers |

On fresh install, AI is OFF by default.

## Model Details

- **Model:** Qwen2.5-Coder-0.5B (Q4_K_M quantization)
- **File size:** ~398 MB
- **Runtime:** ~500 MB RAM while loaded
- **Inference:** CPU only (no GPU), ~500ms-2s per completion
- **Context window:** 2048 tokens
- **Format:** GGUF (llama.cpp compatible)

## Snippet Awareness

Before every AI request, `magicSnippet.ts` builds a system prompt containing all 45 snippets:

```
You have access to these snippets:
- njs-srv: Express server boilerplate (requires: express, sqlite3, cors)
- njs-get: GET route handler (app.get(...))
- njs-post: POST route handler (app.post(...))
...

Generate code based on the user's instruction.
Use these snippets when they match. Combine them when needed.
Write from scratch if no snippet fits.
Output ONLY valid JavaScript code, no markdown or explanation.
```

This ensures the model knows the exact snippet prefixes, bodies, and dependency comments, so it writes code compatible with the existing snippet system.

## Extension Configuration

VS Code settings to add:

| Setting | Default | Description |
|---------|---------|-------------|
| `node-sqlite-ai.port` | `23333` | Port for local AI server |
| `node-sqlite-ai.magicPrefix` | `njs:` | Trigger prefix for AI instruction mode |
| `node-sqlite-ai.enableAutocomplete` | `false` | Enable inline ghost text completions |
| `node-sqlite-ai.modelPath` | `{extensionDir}/models/qwen2.5-coder-0.5b-q4_k_m.gguf` | Path to GGUF model file |

## Error Handling

- **Server fails to start:** Show notification "AI: Failed to start. Check if port 23333 is available." with Retry button.
- **Request timeout (5s):** If AI doesn't respond, fall back to normal behavior (no replacement).
- **Model file missing:** Show notification "AI: Model file not found. Reinstall the extension."
- **Process crash:** Auto-detect server process exit, notify user, offer to restart.

## Security

- Server binds to `127.0.0.1` only (no external access)
- No authentication needed (localhost only)
- No file system access exposed by llama-server
- Extension runs within VS Code's sandbox

## Testing Strategy

- Unit tests for `aiClient.ts` with mock HTTP server
- Unit tests for `magicSnippet.ts` with mock model responses
- Manual test: sideload VSIX on a clean Windows machine with no internet
- Manual test: verify no network requests are made
- Manual test: verify no "AI" labeling is visible in the UI

## Out of Scope (Future)

- Multi-model support (only Qwen2.5-Coder-0.5B bundled)
- macOS/Linux support (Windows x64 only for now)
- Chat interface (intentionally excluded)
- Schema-aware generation (requires parsing SQL files)
- Multi-file generation (generates code at cursor position only)
