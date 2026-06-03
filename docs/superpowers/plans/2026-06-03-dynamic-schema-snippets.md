# Dynamic Schema-Driven Snippets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the VS Code extension from 45 fixed snippets into a schema-aware code generator that adapts to any database topic.

**Architecture:** Schema registry (`.njs-schema.json`) stores table definitions. A CompletionItemProvider dynamically generates `njs-{Table}-{type}` completions. A code generation engine produces Express routes, HTML, and JS from the schema. Foreign keys managed via dialog UI.

**Tech Stack:** VS Code Extension API, Node.js, better-sqlite3, Express

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/schemaRegistry.js` | Create | Read/write `.njs-schema.json`, table/field CRUD, FK management, inline syntax parsing |
| `src/generator.js` | Create | Generate Express routes, HTML, JS from schema definitions |
| `src/dynamicProvider.js` | Create | CompletionItemProvider that surfaces `njs-{Table}-{type}` dynamic snippets |
| `src/extension.js` | Modify | Init schema registry, register 5 new commands, wire dynamic provider |
| `src/magicSnippet.js` | Modify | Intercept `njs:register` prefix for inline registration |
| `.gitignore` | Modify | Remove `docs/` line so practiceguide.md ships |
| `.vscodeignore` | Modify | Remove `docs/**` line so practiceguide.md ships |

---

### Task 1: Create Schema Registry

**Files:**
- Create: `src/schemaRegistry.js`

- [ ] **Step 1: Create schemaRegistry.js with core data layer**

Write `src/schemaRegistry.js`:

```javascript
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const SCHEMA_FILE = '.njs-schema.json';

class SchemaRegistry {
    constructor(context) {
        this.schemaPath = null;
        this.schema = { tables: {} };
        this._dirty = false;
    }

    async init(workspaceRoot) {
        if (!workspaceRoot) return false;
        this.schemaPath = path.join(workspaceRoot, SCHEMA_FILE);
        try {
            const raw = await fs.promises.readFile(this.schemaPath, 'utf8');
            this.schema = JSON.parse(raw);
        } catch {
            this.schema = { tables: {} };
        }
        return true;
    }

    async save() {
        if (!this.schemaPath) return;
        await fs.promises.writeFile(this.schemaPath, JSON.stringify(this.schema, null, 2), 'utf8');
        this._dirty = false;
    }

    getTables() {
        return Object.keys(this.schema.tables);
    }

    getTable(name) {
        return this.schema.tables[name] || null;
    }

    async addTable(name, fields) {
        if (this.schema.tables[name]) throw new Error(`Table "${name}" already exists`);
        this.schema.tables[name] = { fields };
        await this.save();
    }

    async removeTable(name) {
        delete this.schema.tables[name];
        await this.save();
    }

    async addField(tableName, field) {
        const table = this.schema.tables[tableName];
        if (!table) throw new Error(`Table "${tableName}" not found`);
        table.fields.push(field);
        await this.save();
    }

    async removeField(tableName, fieldName) {
        const table = this.schema.tables[tableName];
        if (!table) throw new Error(`Table "${tableName}" not found`);
        table.fields = table.fields.filter(f => f.name !== fieldName);
        await this.save();
    }

    async setForeignKey(tableName, fieldName, targetTable, targetField) {
        const table = this.schema.tables[tableName];
        if (!table) throw new Error(`Table "${tableName}" not found`);
        const field = table.fields.find(f => f.name === fieldName);
        if (!field) throw new Error(`Field "${fieldName}" not found in "${tableName}"`);
        if (!this.schema.tables[targetTable]) throw new Error(`Target table "${targetTable}" not found`);
        field.fk = { table: targetTable, field: targetField || this._getPK(targetTable) };
        await this.save();
    }

    async removeForeignKey(tableName, fieldName) {
        const table = this.schema.tables[tableName];
        if (!table) throw new Error(`Table "${tableName}" not found`);
        const field = table.fields.find(f => f.name === fieldName);
        if (field && field.fk) {
            delete field.fk;
            await this.save();
        }
    }

    _getPK(tableName) {
        const table = this.schema.tables[tableName];
        if (!table) return 'id';
        const pk = table.fields.find(f => f.pk);
        return pk ? pk.name : 'id';
    }

    // Parse "Items:id PRIMARY, name TEXT NOT NULL, price REAL DEFAULT 0"
    parseInlineSpec(input) {
        const colonIdx = input.indexOf(':');
        if (colonIdx < 0) throw new Error('Format: TableName:fieldDef, fieldDef, ...');
        const tableName = input.substring(0, colonIdx).trim();
        const fieldParts = input.substring(colonIdx + 1).split(',').map(s => s.trim()).filter(Boolean);
        const fields = [];
        for (const part of fieldParts) {
            const tokens = part.split(/\s+/);
            const field = { name: tokens[0], type: 'TEXT' };
            for (let i = 1; i < tokens.length; i++) {
                const t = tokens[i].toUpperCase();
                if (t === 'PRIMARY') field.pk = true;
                else if (t === 'NOT' && tokens[i + 1]?.toUpperCase() === 'NULL') { field.notNull = true; i++; }
                else if (t === 'DEFAULT') { field.default = tokens[++i]; }
                else if (t.startsWith('FK->')) {
                    const match = t.match(/FK->(\w+)\((\w+)\)/);
                    if (match) field.fk = { table: match[1], field: match[2] };
                } else if (['INTEGER', 'TEXT', 'REAL', 'BLOB'].includes(t)) {
                    field.type = t;
                }
            }
            fields.push(field);
        }
        return { tableName, fields };
    }
}

module.exports = { SchemaRegistry };
```

- [ ] **Step 2: Verify manually**
  - Load extension in VS Code Extension Host
  - Nothing to test yet (no commands wired up)

---

### Task 2: Update extension.js — Initialize Registry + Register Commands

**Files:**
- Modify: `src/extension.js`

- [ ] **Step 1: Add imports and init registry**

In `src/extension.js`, add after existing requires:

```javascript
const { SchemaRegistry } = require('./schemaRegistry');
const { DynamicSnippetProvider } = require('./dynamicProvider');
```

Replace the top of `activate()`:

```javascript
const vscode = require('vscode');
const { ServerManager } = require('./serverManager');
const { AiClient } = require('./aiClient');
const { MagicSnippetHandler } = require('./magicSnippet');
const { SchemaRegistry } = require('./schemaRegistry');
const { DynamicSnippetProvider } = require('./dynamicProvider');

let serverManager;
let aiClient;
let magicHandler = null;
let schemaRegistry;
let dynamicProvider = null;

function activate(context) {
    serverManager = new ServerManager();
    aiClient = new AiClient();

    // Initialize schema registry
    schemaRegistry = new SchemaRegistry();
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
    if (workspaceRoot) {
        schemaRegistry.init(workspaceRoot).then(() => {
            // Initialize dynamic snippet provider after schema loads
            dynamicProvider = new DynamicSnippetProvider(schemaRegistry);
            context.subscriptions.push(
                vscode.languages.registerCompletionItemProvider(
                    ['javascript', 'html', 'json', 'jsonc', 'typescript', 'javascriptreact', 'typescriptreact'],
                    dynamicProvider,
                    '-'
                )
            );
        });
    }
```

- [ ] **Step 2: Add global enter listener for njs:register (AI-independent)**

Add in `activate()` after schema registry init, outside the `workspaceRoot` block, so it works regardless of AI status:

```javascript
    // Always-on njs:register handler (AI-independent)
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(async (event) => {
            const prefix = vscode.workspace.getConfiguration('node-sqlite-ai').get('magicPrefix') || 'njs:';
            for (const change of event.contentChanges) {
                const text = change.text;
                const isEnter = text === '\n' || text === '\r\n';
                if (!isEnter) continue;
                const lineNum = change.range.start.line;
                if (lineNum < 0) continue;
                const lineText = event.document.lineAt(lineNum).text;
                if (!lineText.startsWith(prefix)) continue;
                const instruction = lineText.substring(prefix.length).trim();
                if (!instruction.startsWith('register ')) continue;
                const spec = instruction.substring(9).trim();
                try {
                    const { tableName, fields } = schemaRegistry.parseInlineSpec(spec);
                    await schemaRegistry.addTable(tableName, fields);
                    vscode.window.showInformationMessage(`njs: Table "${tableName}" registered`);
                    const edit = new vscode.WorkspaceEdit();
                    const range = new vscode.Range(lineNum, 0, lineNum, lineText.length);
                    edit.replace(event.document.uri, range, `// Table "${tableName}" registered`);
                    await vscode.workspace.applyEdit(edit);
                } catch (err) {
                    vscode.window.showErrorMessage(`njs: ${err.message}`);
                }
            }
        })
    );
```

- [ ] **Step 3: Register schema commands**

Add after existing command registrations (before `context.subscriptions.push({ dispose: ... })`):

```javascript
    // Schema commands
    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.registerTable', async () => {
            const tableName = await vscode.window.showInputBox({
                prompt: 'Table name',
                placeHolder: 'e.g. Items',
                ignoreFocusOut: true
            });
            if (!tableName) return;

            const fieldsStr = await vscode.window.showInputBox({
                prompt: 'Fields (comma-separated)',
                placeHolder: 'id PRIMARY, name TEXT NOT NULL, price REAL DEFAULT 0',
                ignoreFocusOut: true
            });
            if (!fieldsStr) return;

            try {
                const { fields } = schemaRegistry.parseInlineSpec(`${tableName}:${fieldsStr}`);
                await schemaRegistry.addTable(tableName, fields);
                vscode.window.showInformationMessage(`njs: Table "${tableName}" registered`);
            } catch (err) {
                vscode.window.showErrorMessage(`njs: ${err.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.showStatus', async () => {
            const tables = schemaRegistry.getTables();
            if (!tables.length) {
                vscode.window.showInformationMessage('njs: No tables registered');
                return;
            }
            const pick = await vscode.window.showQuickPick(tables.map(t => ({
                label: t,
                detail: `${schemaRegistry.getTable(t).fields.length} fields`
            })), { placeHolder: 'Registered tables' });
            if (pick) {
                const table = schemaRegistry.getTable(pick.label);
                const fields = table.fields.map(f =>
                    `${f.name} (${f.type})${f.pk ? ' PK' : ''}${f.fk ? ` FK->${f.fk.table}(${f.fk.field})` : ''}`
                ).join('\n');
                vscode.window.showInformationMessage(`njs: ${pick.label}\n${fields}`);
            }
        })
    );
```

- [ ] **Step 4: Verify in Extension Host**
  - Open Command Palette → `njs: Register Table`
  - Enter "Items" → enter fields "id PRIMARY, name TEXT NOT NULL"
  - Verify `.njs-schema.json` created in workspace root
  - Run `njs: Schema Status` → verify table shows

---

### Task 3: Modify magicSnippet.js — Inline Registration

**Files:**
- Modify: `src/magicSnippet.js`

- [ ] **Step 1: Route `njs:register` prefix**

In `src/magicSnippet.js`, modify `setupEnterListener` to detect `njs:register`:

In the `onDidChangeTextDocument` handler, after extracting `instruction`, add before the existing `triggerGeneration` call:

```javascript
                // Check for registration command
                if (instruction.startsWith('register ')) {
                    const spec = instruction.substring(9).trim();
                    this.handleRegistration(event.document, njsLine, lineText, spec);
                    return;
                }
```

Also in the `node-sqlite-ai.magicComplete` command handler, add the same check after extracting `instruction`:

```javascript
            if (instruction.startsWith('register ')) {
                const spec = instruction.substring(9).trim();
                this.handleRegistration(editor.document, cursorLine, lineText, spec);
                return;
            }
```

- [ ] **Step 2: Add handleRegistration method**

Add to `MagicSnippetHandler` class:

```javascript
    async handleRegistration(document, lineNumber, lineText, spec) {
        try {
            const { tableName, fields } = this.schemaRegistry.parseInlineSpec(spec);
            await this.schemaRegistry.addTable(tableName, fields);
            vscode.window.showInformationMessage(`njs: Table "${tableName}" registered with ${fields.length} fields`);
            // Clear the njs:register line
            const edit = new vscode.WorkspaceEdit();
            const range = new vscode.Range(lineNumber, 0, lineNumber, lineText.length);
            edit.replace(document.uri, range, `// Table "${tableName}" registered`);
            await vscode.workspace.applyEdit(edit);
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }
```

- [ ] **Step 3: Pass schemaRegistry to MagicSnippetHandler**

In `extension.js`, update the `MagicSnippetHandler` constructor calls (both enable and trained-enable):

```javascript
                magicHandler = new MagicSnippetHandler(aiClient, context, schemaRegistry, { trained: false });
```

And:

```javascript
                magicHandler = new MagicSnippetHandler(aiClient, context, schemaRegistry, { trained: true });
```

Update the constructor in `magicSnippet.js`:

```javascript
    constructor(aiClient, context, schemaRegistry, options = {}) {
        this.aiClient = aiClient;
        this.schemaRegistry = schemaRegistry;
        this.trained = options.trained || false;
        this.snippets = this.buildSnippetsContext(context);
        this.disposables = [];
        this.requestCounter = 0;
        this.MAX_TOKENS = 4096;
        this.setupEnterListener(context);
        this.setupSelectionListener(context);
    }
```

- [ ] **Step 4: Verify in Extension Host**
  - Turn on AI
  - Type `njs:register Items:id PRIMARY, name TEXT NOT NULL` and press Enter
  - Verify confirmation message
  - Verify line replaced with comment
  - Check `.njs-schema.json` has the table

---

### Task 4: Create Code Generation Engine

**Files:**
- Create: `src/generator.js`

- [ ] **Step 1: Create generator.js with all generators**

```javascript
class CodeGenerator {
    constructor(schemaRegistry) {
        this.schemaRegistry = schemaRegistry;
    }

    getPK(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return 'id';
        const pk = table.fields.find(f => f.pk);
        return pk ? pk.name : table.fields[0]?.name || 'id';
    }

    getNonPKFields(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return [];
        return table.fields.filter(f => !f.pk);
    }

    getStatField(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return null;
        return table.fields.find(f => f.name.toLowerCase().includes('stat')) || null;
    }

    generatePrepStatements(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return '// Table not found';
        const pk = this.getPK(tableName);
        const nonPK = this.getNonPKFields(tableName);
        const fieldNames = table.fields.map(f => f.name).join(', ');
        const insertFields = nonPK.map(f => f.name).join(', ');
        const insertPlaceholders = nonPK.map(() => '?').join(', ');
        const updateSet = nonPK.map(f => `${f.name} = ?`).join(', ');
        const statField = this.getStatField(tableName);

        const lines = [];
        const varPrefix = tableName.charAt(0).toLowerCase() + tableName.slice(1);
        lines.push(`// --- ${tableName} ---`);
        lines.push(`const ${varPrefix}GetAll = db.prepare('SELECT * FROM ${tableName}');`);
        lines.push(`const ${varPrefix}GetOne = db.prepare('SELECT * FROM ${tableName} WHERE ${pk} = ?');`);
        if (insertFields) {
            lines.push(`const ${varPrefix}Insert = db.prepare('INSERT INTO ${tableName} (${insertFields}) VALUES (${insertPlaceholders})');`);
        }
        if (updateSet) {
            lines.push(`const ${varPrefix}Update = db.prepare('UPDATE ${tableName} SET ${updateSet} WHERE ${pk} = ?');`);
        }
        if (statField) {
            lines.push(`const ${varPrefix}Deactivate = db.prepare("UPDATE ${tableName} SET ${statField.name} = 'inactive' WHERE ${pk} = ?");`);
        } else {
            lines.push(`const ${varPrefix}Remove = db.prepare('DELETE FROM ${tableName} WHERE ${pk} = ?');`);
        }
        return lines.join('\n');
    }

    generateCrudRoutes(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return '// Table not found';
        const pk = this.getPK(tableName);
        const nonPK = this.getNonPKFields(tableName);
        const varPrefix = tableName.charAt(0).toLowerCase() + tableName.slice(1);
        const statField = this.getStatField(tableName);
        const listRoute = `/api/${tableName.toLowerCase()}`;
        const itemRoute = `/api/${tableName.toLowerCase()}/:${pk}`;

        let routes = '';

        // GET all
        routes += `// GET all ${tableName}\n`;
        routes += `app.get('${listRoute}', (req, res) => {\n`;
        routes += `  try {\n`;
        routes += `    const rows = ${varPrefix}GetAll.all();\n`;
        routes += `    res.json(rows);\n`;
        routes += `  } catch (err) {\n`;
        routes += `    res.status(500).json({ error: err.message });\n`;
        routes += `  }\n`;
        routes += `});\n\n`;

        // GET one
        routes += `// GET one ${tableName}\n`;
        routes += `app.get('${itemRoute}', (req, res) => {\n`;
        routes += `  try {\n`;
        routes += `    const row = ${varPrefix}GetOne.get(req.params.${pk});\n`;
        routes += `    if (!row) return res.status(404).json({ error: 'Not found' });\n`;
        routes += `    res.json(row);\n`;
        routes += `  } catch (err) {\n`;
        routes += `    res.status(500).json({ error: err.message });\n`;
        routes += `  }\n`;
        routes += `});\n\n`;

        // POST (create)
        if (nonPK.length > 0) {
            routes += `// Create ${tableName}\n`;
            routes += `app.post('${listRoute}', (req, res) => {\n`;
            routes += `  try {\n`;
            routes += `    const { ${nonPK.map(f => f.name).join(', ')} } = req.body;\n`;
            routes += `    const result = ${varPrefix}Insert.run(${nonPK.map(f => f.name).join(', ')});\n`;
            routes += `    res.status(201).json({ ${pk}: result.lastInsertRowid });\n`;
            routes += `  } catch (err) {\n`;
            routes += `    res.status(500).json({ error: err.message });\n`;
            routes += `  }\n`;
            routes += `});\n\n`;
        }

        // PUT (update)
        if (nonPK.length > 0) {
            routes += `// Update ${tableName}\n`;
            routes += `app.put('${itemRoute}', (req, res) => {\n`;
            routes += `  try {\n`;
            routes += `    const { ${nonPK.map(f => f.name).join(', ')} } = req.body;\n`;
            routes += `    const result = ${varPrefix}Update.run(${nonPK.map(f => f.name).join(', ')}, req.params.${pk});\n`;
            routes += `    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });\n`;
            routes += `    res.json({ updated: result.changes });\n`;
            routes += `  } catch (err) {\n`;
            routes += `    res.status(500).json({ error: err.message });\n`;
            routes += `  }\n`;
            routes += `});\n\n`;
        }

        // DELETE / deactivate
        routes += `// ${statField ? 'Deactivate' : 'Delete'} ${tableName}\n`;
        routes += `app.delete('${itemRoute}', (req, res) => {\n`;
        routes += `  try {\n`;
        if (statField) {
            routes += `    const result = ${varPrefix}Deactivate.run(req.params.${pk});\n`;
        } else {
            routes += `    const result = ${varPrefix}Remove.run(req.params.${pk});\n`;
        }
        routes += `    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });\n`;
        routes += `    res.json({ ${statField ? 'deactivated' : 'deleted'}: result.changes });\n`;
        routes += `  } catch (err) {\n`;
        routes += `    res.status(500).json({ error: err.message });\n`;
        routes += `  }\n`;
        routes += `});\n`;

        return routes;
    }

    generateListHtml(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return '<!-- Table not found -->';
        const fields = this.getNonPKFields(tableName);
        const pk = this.getPK(tableName);
        const api = `/api/${tableName.toLowerCase()}`;

        let html = `<h2>${tableName}</h2>\n`;
        html += `<div id="${tableName.toLowerCase()}List">Loading...</div>\n\n`;
        html += `<script>\n`;
        html += `  async function load${tableName}() {\n`;
        html += `    const res = await fetch('${api}');\n`;
        html += `    const items = await res.json();\n`;
        html += `    const list = document.getElementById('${tableName.toLowerCase()}List');\n`;
        html += `    if (!items.length) { list.innerHTML = '<p>No ${tableName.toLowerCase()} yet.</p>'; return; }\n`;
        html += `    list.innerHTML = \`<table><tr>${fields.map(f => `<th>${f.name}</th>`).join('')}<th>Actions</th></tr>\n`;
        html += `      \${items.map(i => \`<tr>${fields.map(f => `<td>\${i.${f.name}}</td>`).join('')}`;
        html += `<td><button onclick="edit${tableName}(\${i.${pk}})" class="edit-btn">Edit</button> `;
        html += `<button onclick="deactivate${tableName}(\${i.${pk}})" class="del-btn">Deactivate</button></td></tr>\`).join('')}</table>\`;\n`;
        html += `  }\n\n`;
        html += `  async function deactivate${tableName}(id) {\n`;
        html += `    if (!confirm('Deactivate this ${tableName.toLowerCase()}?')) return;\n`;
        html += `    await fetch(\`${api}/\${id}\`, { method: 'DELETE' });\n`;
        html += `    load${tableName}();\n`;
        html += `  }\n`;
        html += `</script>`;
        return html;
    }

    generateFormHtml(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return '<!-- Table not found -->';
        const fields = this.getNonPKFields(tableName);

        let html = `<h2>Add ${tableName}</h2>\n`;
        html += `<form id="${tableName.toLowerCase()}Form">\n`;
        for (const f of fields) {
            const label = f.name.charAt(0).toUpperCase() + f.name.slice(1);
            const required = f.notNull ? ' required' : '';
            const defVal = f.default !== undefined ? ` value="${f.default}"` : '';
            if (f.fk) {
                html += `  <select name="${f.name}"${required}>\n`;
                html += `    <option value="">Select ${f.fk.table}</option>\n`;
                html += `  </select><br>\n`;
            } else if (f.type === 'TEXT' && (f.name.toLowerCase().includes('desc') || f.name.toLowerCase().includes('description'))) {
                html += `  <textarea name="${f.name}" placeholder="${label}"${required}>${f.default || ''}</textarea><br>\n`;
            } else if (f.type === 'REAL' || f.type === 'INTEGER') {
                html += `  <input name="${f.name}" type="number"${f.type === 'REAL' ? ' step="any"' : ''} placeholder="${label}"${required}${defVal}><br>\n`;
            } else {
                html += `  <input name="${f.name}" placeholder="${label}"${required}${defVal}><br>\n`;
            }
        }
        html += `  <button type="submit">Add</button>\n`;
        html += `</form>\n`;
        return html;
    }

    generateFormJs(tableName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return '// Table not found';
        const pk = this.getPK(tableName);
        const fields = this.getNonPKFields(tableName);
        const api = `/api/${tableName.toLowerCase()}`;
        const varName = tableName.charAt(0).toLowerCase() + tableName.slice(1);

        let js = `let edit${tableName}Id = null;\n\n`;
        js += `document.getElementById('${tableName.toLowerCase()}Form').onsubmit = async (e) => {\n`;
        js += `  e.preventDefault();\n`;
        js += `  const fd = new FormData(e.target);\n`;
        js += `  const data = Object.fromEntries(fd);\n`;
        js += `  if (edit${tableName}Id) {\n`;
        js += `    await fetch(\`${api}/\${edit${tableName}Id}\`, {\n`;
        js += `      method: 'PUT',\n`;
        js += `      headers: { 'Content-Type': 'application/json' },\n`;
        js += `      body: JSON.stringify(data)\n`;
        js += `    });\n`;
        js += `    edit${tableName}Id = null;\n`;
        js += `  } else {\n`;
        js += `    await fetch('${api}', {\n`;
        js += `      method: 'POST',\n`;
        js += `      headers: { 'Content-Type': 'application/json' },\n`;
        js += `      body: JSON.stringify(data)\n`;
        js += `    });\n`;
        js += `  }\n`;
        js += `  e.target.reset();\n`;
        js += `  if (typeof load${tableName} === 'function') load${tableName}();\n`;
        js += `};\n\n`;

        js += `function edit${tableName}(id, ${fields.map(f => f.name).join(', ')}) {\n`;
        js += `  edit${tableName}Id = id;\n`;
        for (const f of fields) {
            js += `  document.querySelector('[name="${f.name}"]').value = ${f.name};\n`;
        }
        js += `}\n`;
        return js;
    }

    generatePageHtml(tableName) {
        return this.generateFormHtml(tableName) + '\n' + this.generateListHtml(tableName);
    }

    generatePageJs(tableName) {
        return this.generateFormJs(tableName) + '\n' + `// Initial load\nload${tableName}();\n`;
    }

    generateCrud(tableName) {
        return this.generatePrepStatements(tableName) + '\n\n' + this.generateCrudRoutes(tableName);
    }

    generate(snippetType, tableName) {
        switch (snippetType) {
            case 'crud': return this.generateCrud(tableName);
            case 'list': return this.generateListHtml(tableName);
            case 'list-js': return `// load and delete for ${tableName}\n` + this.generateListHtml(tableName).split('<script>')[1]?.replace('</script>', '').trim() || '// See njs-{t}-page-js';
            case 'form': return this.generateFormHtml(tableName);
            case 'form-js': return this.generateFormJs(tableName);
            case 'page': return this.generatePageHtml(tableName);
            case 'page-js': return this.generatePageJs(tableName);
            default: return `// Unknown snippet type: ${snippetType}`;
        }
    }
}

module.exports = { CodeGenerator };
```

---

### Task 5: Create Dynamic Snippet Provider

**Files:**
- Create: `src/dynamicProvider.js`

- [ ] **Step 1: Create dynamicProvider.js**

```javascript
const vscode = require('vscode');
const { CodeGenerator } = require('./generator');

class DynamicSnippetProvider {
    constructor(schemaRegistry) {
        this.schemaRegistry = schemaRegistry;
        this.generator = new CodeGenerator(schemaRegistry);
    }

    provideCompletionItems(document, position) {
        const tables = this.schemaRegistry.getTables();
        if (!tables.length) return [];

        const linePrefix = document.lineAt(position.line).text.substring(0, position.character);
        if (!linePrefix.endsWith('-')) return [];

        const items = [];
        const snippetTypes = [
            { type: 'crud', label: 'crud', detail: 'Prep statements + CRUD routes for server.js' },
            { type: 'list', label: 'list', detail: 'HTML table list for this table' },
            { type: 'list-js', label: 'list-js', detail: 'JS load + delete functions' },
            { type: 'form', label: 'form', detail: 'HTML add/edit form' },
            { type: 'form-js', label: 'form-js', detail: 'JS add + update functions' },
            { type: 'page', label: 'page', detail: 'Full HTML page (form + list)' },
            { type: 'page-js', label: 'page-js', detail: 'All JS functions for this table' }
        ];

        for (const tableName of tables) {
            for (const st of snippetTypes) {
                const label = `njs-${tableName.toLowerCase()}-${st.type}`;
                if (!label.startsWith(linePrefix)) continue;
                const code = this.generator.generate(st.type, tableName);
                const snippet = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
                snippet.detail = `[${tableName}] ${st.detail}`;
                snippet.documentation = new vscode.MarkdownString().appendCodeblock(code, 'javascript');
                snippet.insertText = new vscode.SnippetString(code);
                snippet.range = new vscode.Range(position.line, Math.max(0, position.character - label.length), position.line, position.character);
                items.push(snippet);
            }
        }

        return items;
    }
}

module.exports = { DynamicSnippetProvider };
```

---

### Task 6: Create FK Manager

**Files:**
- Create: `src/fkManager.js`

- [ ] **Step 1: Create fkManager.js**

```javascript
const vscode = require('vscode');

class FkManager {
    constructor(schemaRegistry) {
        this.schemaRegistry = schemaRegistry;
    }

    async addForeignKey() {
        const tables = this.schemaRegistry.getTables();
        if (tables.length < 2) {
            vscode.window.showErrorMessage('njs: Need at least 2 tables to create a foreign key');
            return;
        }

        // Pick source table
        const sourcePick = await vscode.window.showQuickPick(
            tables.map(t => ({ label: t, description: `${this.schemaRegistry.getTable(t).fields.length} fields` })),
            { placeHolder: 'Select source table (the one with the FK field)' }
        );
        if (!sourcePick) return;
        const sourceTable = this.schemaRegistry.getTable(sourcePick.label);
        if (!sourceTable) return;

        // Pick source field
        const fieldPick = await vscode.window.showQuickPick(
            sourceTable.fields.map(f => ({
                label: f.name,
                description: `${f.type}${f.fk ? ` (FK->${f.fk.table})` : ''}`
            })),
            { placeHolder: 'Select field to make foreign key' }
        );
        if (!fieldPick) return;

        // Pick target table
        const targetPick = await vscode.window.showQuickPick(
            tables.filter(t => t !== sourcePick.label).map(t => ({ label: t })),
            { placeHolder: 'Select target table' }
        );
        if (!targetPick) return;

        // Pick target field (default to PK)
        const targetTable = this.schemaRegistry.getTable(targetPick.label);
        const targetPK = targetTable.fields.find(f => f.pk);
        const targetFields = targetTable.fields.map(f => ({
            label: f.name,
            description: f.pk ? '(primary key - recommended)' : ''
        }));

        const targetFieldPick = await vscode.window.showQuickPick(targetFields, {
            placeHolder: 'Select target field (default: PK)',
            items: targetFields
        });
        if (!targetFieldPick) return;

        try {
            await this.schemaRegistry.setForeignKey(
                sourcePick.label, fieldPick.label,
                targetPick.label, targetFieldPick.label
            );
            vscode.window.showInformationMessage(
                `njs: FK ${sourcePick.label}.${fieldPick.label} -> ${targetPick.label}(${targetFieldPick.label})`
            );
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    async removeForeignKey() {
        const tables = this.schemaRegistry.getTables();
        if (!tables.length) return;

        const sourcePick = await vscode.window.showQuickPick(tables.map(t => ({ label: t })), {
            placeHolder: 'Select table with FK to remove'
        });
        if (!sourcePick) return;

        const table = this.schemaRegistry.getTable(sourcePick.label);
        const fkFields = table.fields.filter(f => f.fk);
        if (!fkFields.length) {
            vscode.window.showInformationMessage('njs: No foreign keys in this table');
            return;
        }

        const fieldPick = await vscode.window.showQuickPick(
            fkFields.map(f => ({
                label: f.name,
                description: `FK->${f.fk.table}(${f.fk.field})`
            })),
            { placeHolder: 'Select FK to remove' }
        );
        if (!fieldPick) return;

        await this.schemaRegistry.removeForeignKey(sourcePick.label, fieldPick.label);
        vscode.window.showInformationMessage(`njs: FK removed from ${sourcePick.label}.${fieldPick.label}`);
    }
}

module.exports = { FkManager };
```

---

### Task 7: Wire FK Manager into extension.js

**Files:**
- Modify: `src/extension.js`

- [ ] **Step 1: Import and register FK commands**

Add require at top:

```javascript
const { FkManager } = require('./fkManager');
```

Add after other command registrations:

```javascript
    const fkManager = new FkManager(schemaRegistry);

    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.manageFK', () => {
            fkManager.addForeignKey();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('node-sqlite-ai.removeFK', async () => {
            fkManager.removeForeignKey();
        })
    );
```

Add to package.json `contributes.commands`:

```json
      {
        "command": "node-sqlite-ai.manageFK",
        "title": "njs: Add Foreign Key"
      },
      {
        "command": "node-sqlite-ai.removeFK",
        "title": "njs: Remove Foreign Key"
      }
```

---

### Task 8: Fix Build Configuration

**Files:**
- Modify: `.gitignore`
- Modify: `.vscodeignore`

- [ ] **Step 1: Remove docs/ from .gitignore**

In `.gitignore`, delete the line `docs/`.

- [ ] **Step 2: Remove docs from .vscodeignore**

In `.vscodeignore`, delete the line `docs/**`.

---

### Task 9: Integration Verification

- [ ] **Step 1: Full flow test**
  1. Open a workspace in VS Code
  2. Run `njs: Register Table`, enter `Positions` then `posID INTEGER PRIMARY, posName TEXT NOT NULL, numOfPositions INTEGER`
  3. Run `njs: Register Table`, enter `Candidates` then `candID INTEGER PRIMARY, candFName TEXT NOT NULL, candLName TEXT, posID INTEGER`
  4. Run `njs: Add Foreign Key`, pick Candidates → posID → Positions → posID
  5. Create `server.js`, type `njs-positions-crud` → verify prep statements + routes generated
  6. Create `index.html`, type `njs-positions-list` → verify HTML table renders
  7. Create `index.html <script>`, type `njs-positions-page-js` → verify JS functions generated
  8. Run `njs: Schema Status` → verify both tables listed
  9. Test inline: type `njs:register Books:id PRIMARY, title TEXT NOT NULL` and press Enter

- [ ] **Step 2: Update version in package.json**

```json
"version": "2.0.0"
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: dynamic schema-driven snippets v2.0

- Schema registry (.njs-schema.json) for table definitions
- Inline and command-palette table registration
- Code generation engine for routes, HTML, JS per table
- Dynamic CompletionItemProvider for njs-{Table}-{type} snippets
- Foreign key management via dialog UI
- docs/practiceguide.md now included in VSIX"
```
