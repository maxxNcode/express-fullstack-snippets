# Dynamic Schema-Driven Snippets — Design Spec

## Goal
Transform the Node SQLite Server Snippets VS Code extension from a fixed set of 45 static snippets into a **schema-aware code generator** that adapts to any database topic (Election, Library, Inventory, etc.) without memorization.

## Architecture Overview

```
User Input (inline or command)
        │
        ▼
┌─────────────────────┐
│  Schema Registry    │  (.njs-schema.json)
│  Table Name + Fields│
│  + FK Relationships │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Dynamic Snippet     │
│  Completion Provider │  (auto-suggests njs-{Table}-{type})
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Code Generation     │
│  Engine              │  (generates routes/HTML/JS)
└─────────────────────┘
```

## 1. Schema Registry

### Storage
File: `.njs-schema.json` in workspace root. Persists across sessions, git-friendly.

### JSON Structure
```json
{
  "tables": {
    "Items": {
      "fields": [
        {"name": "id", "type": "INTEGER", "pk": true},
        {"name": "name", "type": "TEXT", "notNull": true},
        {"name": "description", "type": "TEXT"},
        {"name": "price", "type": "REAL", "default": 0}
      ]
    },
    "Candidates": {
      "fields": [
        {"name": "candID", "type": "INTEGER", "pk": true},
        {"name": "candFName", "type": "TEXT", "notNull": true},
        {"name": "posID", "type": "INTEGER", "fk": {"table": "Positions", "field": "posID"}}
      ]
    }
  }
}
```

## 2. Table Registration

### Method A: Inline Syntax
Type in any file and press Enter:
```
njs:register Items:id PRIMARY, name TEXT NOT NULL, description TEXT, price REAL DEFAULT 0
```

Grammar:
- `njs:register {TableName}:{fieldDef}, {fieldDef}, ...`
- Each field: `{name} {type} {constraints}`
- `PRIMARY` → marks as primary key (first field with this wins)
- `FK->{Table}({field})` → foreign key reference
- `NOT NULL` → required constraint
- `DEFAULT {value}` → default value

### Method B: Command Palette
Command: `njs: Register Table`
- Input box 1: Table name
- Input box 2: Field definitions (comma-separated, same syntax as inline)
- Or step-by-step: add fields one at a time

## 3. Dynamic Snippet System

Replaces static JSON snippets with a custom `CompletionItemProvider`.

### Naming Convention
```
njs-{TableNameLower}-{type}
```

### Generated Snippet Types

| Snippet | Where to use | What it generates |
|---|---|---|
| `njs-{t}-crud` | `server.js` | Prepared statements + GET/POST/PUT/DELETE routes |
| `njs-{t}-list` | `index.html <body>` | `<table>` with column headers matching fields |
| `njs-{t}-list-js` | `index.html <script>` | `loadItems()`, `remove()` with field-aware rendering |
| `njs-{t}-form` | `index.html <body>` | `<form>` with inputs matching field types |
| `njs-{t}-form-js` | `index.html <script>` | `addItem()`, `updateItem()` with proper JSON body |
| `njs-{t}-page` | `index.html` | Full HTML page (form + list skeleton) |
| `njs-{t}-page-js` | `index.html <script>` | All JS functions (load, add, update, remove) |

### Implementation
- A `CompletionItemProvider` registered for `javascript`, `html`, `json` languages
- On completion trigger (`njs-`), reads `.njs-schema.json`
- For each registered table, creates completion items matching the naming convention
- On item insert, calls the Code Generation Engine to produce output

## 4. Code Generation Engine

Shared module `src/generator.js` that produces code from schema.

### Backend Generators

#### Prep Statements + CRUD Routes
Input: tableName, fields[]
Output: complete Express route block with:
- `const getAll = db.prepare('SELECT * FROM {table}')`
- `const getOne = db.prepare('SELECT * FROM {table} WHERE {pk} = ?')`
- `const insert = db.prepare('INSERT INTO {table} ({fields}) VALUES ({placeholders})')`
- `const update = db.prepare('UPDATE {table} SET {setClause} WHERE {pk} = ?')`
- `const deactivate = db.prepare('UPDATE {table} SET {statField} = ? WHERE {pk} = ?')` (soft delete)
- GET all, GET one, POST, PUT, DELETE routes

#### Smart behaviors:
- `INTEGER PRIMARY KEY` → excluded from INSERT/UPDATE
- `FK` fields → uses the referenced table for display in GET all (JOIN)
- Soft delete: if field named `*Stat` or `*stat` exists, uses UPDATE instead of DELETE

### Frontend Generators

#### List (HTML)
- `<table>` with `<th>` for each non-PK field
- Action column: Edit + Deactivate buttons
- FK fields display related table name instead of raw ID

#### List (JS)
- `loadItems()`: fetch, render rows
- `remove(id)`: confirm, DELETE, reload

#### Form (HTML)
- PK field → hidden or excluded
- `TEXT` short → `<input type="text">`
- `TEXT` long (name has "desc" or "description") → `<textarea>`
- `INTEGER` → `<input type="number">`
- `REAL` → `<input type="number" step="any">`
- `FK` → `<select>` populated from related table
- `NOT NULL` → `required` attribute
- `DEFAULT x` → pre-filled `value`

#### Form (JS)
- `addItem()`: collect form values, POST, reset, reload
- `updateItem(id)`: collect form values, PUT, reset edit mode, reload

## 5. Foreign Key Management

### Inline Registration
```
njs:register Candidates:candID PRIMARY, candFName TEXT, posID INTEGER FK->Positions(posID)
```

### Dialog Commands
Command `njs: Manage Foreign Keys`:
1. QuickPick: pick source table
2. QuickPick: pick source field
3. QuickPick: pick target table
4. QuickPick: pick target field (defaults to target's PK)
5. Updates `.njs-schema.json`

### WebView Panel (Future)
A VS Code WebView showing a visual schema designer:
- Tables as cards with fields listed
- Draggable connections between FK fields and target PKs
- Add/remove/edit tables visually
- Generate CREATE TABLE SQL from the visual layout

## 6. Existing AI System Changes

- `llama-server.exe` + GGUF model remains **optional** (only works if model file exists)
- `njs:` prefix is **triple-purpose** with priority:
  1. If starts with `njs:register` → schema registration (always)
  2. If starts with `njs:manage` / `njs:status` / `njs:generate` → schema commands (always)
  3. Otherwise → AI chat (only if `njsAiEnabled` context is true, else ignored)
- When no AI model is loaded, unrecognized `njs:...` lines are simply ignored (no error)
- AI `inlineProvider.js` unchanged but gated behind `enableAutocomplete`

### Dynamic Provider Activation
- The `CompletionItemProvider` only registers completions when `.njs-schema.json` has at least one registered table
- Typing `njs-` in a supported file triggers the provider, which reads the schema and builds completion items
- Completion items include human-readable details (field names, FK targets) in the description

## 7. New Commands Summary

| Command | Title | Description |
|---|---|---|
| `node-sqlite-ai.registerTable` | `njs: Register Table` | Register a new table via dialog |
| `node-sqlite-ai.manageSchema` | `njs: Manage Schema` | View/edit registered tables and FKs |
| `node-sqlite-ai.showStatus` | `njs: Schema Status` | Show all registered tables in a QuickPick |
| `node-sqlite-ai.manageFK` | `njs: Manage Foreign Keys` | Add/remove/edit FK relationships |
| `node-sqlite-ai.openSchemaView` | `njs: Schema Visualizer` | Open WebView panel (future) |

## 8. Files to Create/Modify

| File | Action | Purpose |
|---|---|---|
| `src/schemaRegistry.js` | Create | Read/write `.njs-schema.json`, parse inline syntax |
| `src/generator.js` | Create | Code generation engine for all snippet types |
| `src/dynamicProvider.js` | Create | CompletionItemProvider for dynamic snippets |
| `src/fkManager.js` | Create | FK relationship management (dialog + WebView later) |
| `src/extension.js` | Modify | Register new commands, initialize schema registry |
| `src/magicSnippet.js` | Modify | Route `njs:` to registration if starts with `njs:register` |
| `.njs-schema.json` | Create (runtime) | Schema storage per project |

## 9. Build & Distribution Changes

- Remove `docs/` from `.gitignore` and `.vscodeignore` so `practiceguide.md` ships with the VSIX
- The `.njs-schema.json` is a runtime file, NOT packaged in VSIX (user creates it per project)
- `docs/practiceguide.md` can be accessed in-editor via VS Code file picker

## 10. Files to Remove

None. All existing snippets remain for backward compatibility.

## 11. Future Phases (Post-MVP)

1. **WebView Schema Designer** — drag-and-drop visual table/relationship editor
2. **SQL Export** — generate `CREATE TABLE` + `INSERT` statements from schema
3. **Multi-project schemas** — save/load schema templates for reuse across tests
4. **One-click scaffolding** — register all tables and generate entire project at once
