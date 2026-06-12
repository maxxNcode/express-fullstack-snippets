const vscode = require('vscode');
const path = require('path');
const { CodeGenerator } = require('./generator');
const { runQuery, findDbFiles } = require('./dbRunner');

class SchemaViewProvider {
    constructor(context, schemaRegistry) {
        this.context = context;
        this.schemaRegistry = schemaRegistry;
        this.generator = null;
        this._panel = null;
        this._disposables = [];
        this._messageListener = null;

        // Watch for schema file changes to auto-refresh
        const watcher = vscode.workspace.createFileSystemWatcher('**/.njs-schema.json');
        watcher.onDidChange(() => this._refresh());
        watcher.onDidCreate(() => this._refresh());
        watcher.onDidDelete(() => this._refresh());
        this._disposables.push(watcher);
    }

    setGenerator(generator) {
        this.generator = generator;
    }

    // --- Inline SVG icons (works offline, no external deps) ---

    _svgPkIcon() {
        return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" style="vertical-align:middle">
            <circle cx="6" cy="10" r="3.5" stroke="#ffd700" stroke-width="1.3"/>
            <path d="M9 7l4.5-4.5M11.5 4.5l2 2M10.5 3l1.5 1.5" stroke="#ffd700" stroke-width="1.3" stroke-linecap="round"/>
        </svg>`;
    }

    _svgFkIcon() {
        return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" style="vertical-align:middle">
            <path d="M2 8C2 6.5 3.5 5 5 5h2" stroke="#4fc3f7" stroke-width="1.3" stroke-linecap="round"/>
            <path d="M14 8c0 1.5-1.5 3-3 3H9" stroke="#4fc3f7" stroke-width="1.3" stroke-linecap="round"/>
            <circle cx="5" cy="8" r="1.5" fill="#4fc3f7"/>
            <circle cx="11" cy="8" r="1.5" fill="#4fc3f7"/>
        </svg>`;
    }

    _svgRegularIcon() {
        return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" style="vertical-align:middle">
            <path d="M3 3h6l4 4v7a1 1 0 01-1 1H3a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="#888" stroke-width="1.2"/>
            <path d="M9 3v4h4" stroke="#888" stroke-width="1.2" stroke-linejoin="round"/>
        </svg>`;
    }

    _svgAddIcon() {
        return `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" style="vertical-align:middle">
            <line x1="8" y1="3" x2="8" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>`;
    }

    _svgGenerateIcon() {
        return `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" style="vertical-align:middle">
            <path d="M4 2l10 6-10 6V2z" fill="currentColor"/>
        </svg>`;
    }

    _svgRefreshIcon() {
        return `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" style="vertical-align:middle">
            <path d="M2 8a6 6 0 0111.5-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M14 8a6 6 0 01-11.5 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M13.5 1.5V6H9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
    }

    _svgCloseIcon() {
        return `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" style="vertical-align:middle">
            <line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <line x1="13" y1="3" x2="3" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>`;
    }

    _svgLinkIcon() {
        return `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" style="vertical-align:middle">
            <path d="M2 8C2 6.5 3.5 5 5 5h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            <path d="M14 8c0 1.5-1.5 3-3 3H9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            <circle cx="5" cy="8" r="1.5" fill="currentColor"/>
            <circle cx="11" cy="8" r="1.5" fill="currentColor"/>
        </svg>`;
    }

    _svgArrowRight() {
        return `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" style="vertical-align:middle">
            <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
    }

    show() {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : vscode.ViewColumn.One;

        if (this._panel) {
            this._panel.reveal(column);
            // Don't call _refresh() here — it destroys and recreates the entire HTML,
            // wiping all client-side state (auth selections, query builder, etc.)
            return;
        }

        this._panel = vscode.window.createWebviewPanel(
            'njsSchemaView',
            'Schema Visualizer',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview')]
            }
        );

        this._panel.onDidDispose(() => {
            this._panel = null;
        }, null, this._disposables);

        this._render();
    }

    _refresh() {
        if (this._panel) this._render();
    }

    _render() {
        if (!this._panel) return;
        // Dispose previous message listener to prevent stacking
        if (this._messageListener) {
            this._messageListener.dispose();
        }
        try {
            var html = this._getHtml();
            console.log('njs: _getHtml() returned', html.length, 'chars, first 200:', html.substring(0, 200).replace(/</g,'&lt;'));
            this._panel.webview.html = html;
        } catch (err) {
            console.error('njs: _getHtml() error:', err.message, err.stack);
            this._panel.webview.html = '<!DOCTYPE html><html><body><h2>Schema Visualizer Error</h2><p>' +
                err.message.replace(/</g, '&lt;') + '</p><p>Check the developer console for details.</p></body></html>';
        }
        this._messageListener = this._panel.webview.onDidReceiveMessage(
            async (msg) => {
                switch (msg.command) {
                    case 'addTable':
                        await this._handleAddTable();
                        break;
                    case 'removeTable':
                        await this._handleRemoveTable(msg.tableName);
                        break;
                    case 'addFK':
                        await this._handleAddFK(msg.tableName, msg.fieldName);
                        break;
                    case 'removeFK':
                        await this._handleRemoveFK(msg.tableName, msg.fieldName);
                        break;
                    case 'generateAll':
                        await this._handleGenerateAll();
                        break;
                    case 'generateTable':
                        await this._handleGenerateTable(msg.tableName);
                        break;
                    case 'editField':
                        await this._handleEditField(msg.tableName, msg.fieldName);
                        break;
                    case 'previewSql':
                        await this._handlePreviewSql(msg.tableName);
                        break;
                    case 'regenAll':
                        await this._handleRegenerateAll();
                        break;
                    case 'loadQuery':
                        this._handleLoadQuery(msg.queryName);
                        break;
                    case 'getQueries':
                        this._handleGetQueries();
                        break;
                    case 'saveQuery':
                        await this._handleSaveQuery(msg.queryName, msg.columns, msg.filters, msg.sortBy, msg.limit, msg.groupBy, msg.having, msg.distinct, msg.joinType);
                        break;
                    case 'generateQuery':
                        await this._handleGenerateQuery(msg.queryName, msg.columns, msg.type, msg.filters, msg.sortBy, msg.limit, msg.groupBy, msg.having, msg.distinct, msg.joinType);
                        break;
                    case 'previewQuerySql':
                        this._handlePreviewQuerySql(msg.queryName, msg.columns, msg.filters, msg.sortBy, msg.limit, msg.groupBy, msg.having, msg.distinct, msg.joinType);
                        break;
                    case 'removeQuery':
                        await this._handleRemoveQuery(msg.queryName);
                        break;
                    case 'refresh':
                        this._refresh();
                        break;
                    case 'findDbFiles':
                        this._handleFindDbFiles();
                        break;
                    case 'selectDb':
                        this._selectedDbPath = msg.dbPath;
                        this._panel.webview.postMessage({ command: 'dbSelected', dbPath: msg.dbPath });
                        break;
                    case 'runQuery':
                        await this._handleRunQuery(msg.sql);
                        break;
                    case 'getAuthTableFields':
                        this._handleGetAuthTableFields(msg.tableName);
                        break;
                    case 'generateAuth':
                        await this._handleGenerateAuth(msg.tableName, msg.identityFields, msg.passwordField, msg.statusField, msg.options);
                        break;
                    case 'previewAuthSql':
                        this._handlePreviewAuthSql(msg.tableName, msg.identityFields, msg.passwordField, msg.statusField);
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    async _handleEditField(tableName, fieldName) {
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) return;
        const field = table.fields.find(f => f.name === fieldName);
        if (!field) return;

        const action = await vscode.window.showQuickPick(['Rename field', 'Edit type', 'Toggle NOT NULL', 'Cancel'], {
            placeHolder: `What to do with "${fieldName}"?`
        });
        if (!action || action === 'Cancel') return;

        try {
            if (action === 'Rename field') {
                const newName = await vscode.window.showInputBox({
                    prompt: 'New field name',
                    value: field.name,
                    ignoreFocusOut: true,
                    validateInput: (v) => v.trim() ? null : 'Name is required'
                });
                if (!newName || newName === field.name) return;
                field.name = newName;
            } else if (action === 'Edit type') {
                const newType = await vscode.window.showQuickPick(['INTEGER', 'TEXT', 'REAL', 'BLOB'], {
                    placeHolder: `Select type for "${fieldName}" (current: ${field.type})`
                });
                if (!newType || newType === field.type) return;
                field.type = newType;
            } else if (action === 'Toggle NOT NULL') {
                field.notNull = !field.notNull;
            }

            await this.schemaRegistry.save();
            vscode.window.showInformationMessage(`Field "${fieldName}" updated`);
            this._refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    async _handlePreviewSql(tableName) {
        const gen = this.generator || new CodeGenerator(this.schemaRegistry);
        const sql = gen.generateCreateTable(tableName);
        if (!sql || sql === '// Table not found') {
            vscode.window.showErrorMessage('njs: Table not found');
            return;
        }

        const doc = await vscode.workspace.openTextDocument({
            content: sql,
            language: 'sql'
        });
        await vscode.window.showTextDocument(doc, { preview: true });
    }

    async _handleRegenerateAll() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('njs: Open a file first to regenerate code');
            return;
        }

        const tables = this.schemaRegistry.getTables();
        if (!tables.length) {
            vscode.window.showErrorMessage('njs: No tables to regenerate');
            return;
        }

        const text = editor.document.getText();
        const gen = this.generator || new CodeGenerator(this.schemaRegistry);
        const workspaceEdit = new vscode.WorkspaceEdit();
        let updatedCount = 0;

        for (const tableName of tables) {
            const marker = `// @njs ${tableName}`;
            const markerIndex = text.indexOf(marker);

            if (markerIndex >= 0) {
                // Precise marker replacement
                const nextMarkerIndex = text.indexOf('// @njs ', markerIndex + marker.length);
                const startPos = editor.document.positionAt(markerIndex);
                const endPos = nextMarkerIndex >= 0
                    ? editor.document.positionAt(nextMarkerIndex)
                    : editor.document.positionAt(text.length);
                const freshCode = `${marker}\n${gen.generateCrud(tableName)}\n\n`;
                workspaceEdit.replace(editor.document.uri, new vscode.Range(startPos, endPos), freshCode);
                updatedCount++;
            } else {
                // Fallback: search for CREATE TABLE IF NOT EXISTS {tableName}
                const createPattern = `CREATE TABLE IF NOT EXISTS ${tableName}`;
                const createIdx = text.indexOf(createPattern);
                if (createIdx < 0) continue;

                // Block start: beginning of the line containing the CREATE
                const lineStart = text.lastIndexOf('\n', createIdx);
                const blockStart = lineStart >= 0 ? lineStart + 1 : 0;

                // Block end: next CREATE TABLE IF NOT EXISTS or next marker or EOF
                const searchFrom = createIdx + createPattern.length;
                const candidates = [
                    text.indexOf('CREATE TABLE IF NOT EXISTS ', searchFrom),
                    text.indexOf('// @njs ', searchFrom),
                    text.length
                ].filter(i => i >= 0);
                const blockEnd = Math.min(...candidates);

                const startPos = editor.document.positionAt(blockStart);
                const endPos = editor.document.positionAt(blockEnd);
                const freshCode = `${marker}\n${gen.generateCrud(tableName)}\n\n`;
                workspaceEdit.replace(editor.document.uri, new vscode.Range(startPos, endPos), freshCode);
                updatedCount++;
            }
        }

        if (updatedCount === 0) {
            vscode.window.showInformationMessage('njs: No existing generated code found in this file');
            return;
        }

        try {
            const success = await vscode.workspace.applyEdit(workspaceEdit);
            if (success) {
                vscode.window.showInformationMessage(`njs: Regenerated ${updatedCount} of ${tables.length} tables`);
            } else {
                vscode.window.showErrorMessage('njs: Failed to apply edits');
            }
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    async _handleAddTable() {
        const tableName = await vscode.window.showInputBox({
            prompt: 'Table name (e.g. Items, Students, Positions)',
            placeHolder: 'e.g. Students',
            ignoreFocusOut: true,
            validateInput: (v) => v.trim() ? null : 'Table name is required'
        });
        if (!tableName) return;

        // Step-by-step field input
        const fields = [];
        let addMore = true;
        while (addMore) {
            const fieldStr = await vscode.window.showInputBox({
                prompt: `Field for "${tableName}" (or leave empty to finish)`,
                placeHolder: 'e.g. id PRIMARY, name TEXT NOT NULL, price REAL DEFAULT 0',
                ignoreFocusOut: true
            });
            if (!fieldStr) {
                addMore = false;
                continue;
            }

            try {
                const parsed = this.schemaRegistry.parseInlineSpec(`Dummy:${fieldStr}`);
                for (const f of parsed.fields) {
                    // Check for duplicate field names
                    if (fields.some(ex => ex.name === f.name)) {
                        vscode.window.showErrorMessage(`Field "${f.name}" already added`);
                        continue;
                    }
                    fields.push(f);
                }
            } catch (err) {
                vscode.window.showErrorMessage(`Invalid field: ${err.message}`);
            }
        }

        if (!fields.length) {
            vscode.window.showErrorMessage('njs: Need at least one field');
            return;
        }

        try {
            await this.schemaRegistry.addTable(tableName, fields);
            vscode.window.showInformationMessage(`njs: Table "${tableName}" registered (${fields.length} fields)`);
            this._refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    async _handleRemoveTable(tableName) {
        const confirm = await vscode.window.showQuickPick(['Yes', 'No'], {
            placeHolder: `Remove table "${tableName}" and all its fields?`
        });
        if (confirm !== 'Yes') return;

        try {
            await this.schemaRegistry.removeTable(tableName);
            vscode.window.showInformationMessage(`njs: Table "${tableName}" removed`);
            this._refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    async _handleAddFK(tableName, fieldName) {
        const tables = this.schemaRegistry.getTables().filter(t => t !== tableName);
        if (!tables.length) {
            vscode.window.showErrorMessage('njs: Need another table to create a foreign key');
            return;
        }

        const targetPick = await vscode.window.showQuickPick(
            tables.map(t => ({ label: t, description: `${this.schemaRegistry.getTable(t).fields.length} fields` })),
            { placeHolder: `Which table does "${tableName}.${fieldName}" reference?` }
        );
        if (!targetPick) return;

        const targetTable = this.schemaRegistry.getTable(targetPick.label);
        const pkField = targetTable.fields.find(f => f.pk);
        const targetFields = targetTable.fields.map(f => ({
            label: f.name,
            description: `${f.type}${f.pk ? ' (PK)' : ''}`
        }));

        const targetFieldPick = await vscode.window.showQuickPick(targetFields, {
            placeHolder: `Which field in "${targetPick.label}"? (PK recommended)`
        });
        if (!targetFieldPick) return;

        try {
            await this.schemaRegistry.setForeignKey(
                tableName, fieldName,
                targetPick.label, targetFieldPick.label
            );
            vscode.window.showInformationMessage(
                `njs: FK ${tableName}.${fieldName} -> ${targetPick.label}(${targetFieldPick.label})`
            );
            this._refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    async _handleRemoveFK(tableName, fieldName) {
        try {
            await this.schemaRegistry.removeForeignKey(tableName, fieldName);
            vscode.window.showInformationMessage(`njs: FK removed from ${tableName}.${fieldName}`);
            this._refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    async _handleGenerateAll() {
        const tables = this.schemaRegistry.getTables();
        if (!tables.length) {
            vscode.window.showErrorMessage('njs: No tables to generate');
            return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('njs: Open a file first to insert generated code');
            return;
        }

        const gen = this.generator || new CodeGenerator(this.schemaRegistry);
        const lines = [];
        for (const tableName of tables) {
            lines.push(gen.generateCreateTable(tableName));
            lines.push('');
            lines.push(gen.generatePrepStatements(tableName));
            lines.push('');
            lines.push(gen.generateCrudRoutes(tableName));
            lines.push('');
        }

        const code = lines.join('\n');

        const edit = new vscode.WorkspaceEdit();
        edit.insert(editor.document.uri, editor.selection.active, code);
        await vscode.workspace.applyEdit(edit);

        vscode.window.showInformationMessage(`njs: Generated code for ${tables.length} tables`);
    }

    async _handleGetQueries() {
        this._refresh();
    }

    async _handleLoadQuery(queryName) {
        if (this._panel) {
            const query = this.schemaRegistry.getQuery(queryName);
            if (query) {
                this._panel.webview.postMessage({
                    command: 'queryLoaded',
                    queryName,
                    columns: query.columns || [],
                    filters: query.filters || [],
                    sortBy: query.sortBy || null,
                    limit: query.limit || '',
                    groupBy: query.groupBy || [],
                    having: query.having || [],
                    distinct: !!query.distinct,
                    joinType: query.joinType || 'LEFT'
                });
            }
        }
    }

    async _handleSaveQuery(queryName, columns, filters, sortBy, limit, groupBy, having, distinct, joinType) {
        try {
            await this.schemaRegistry.addQuery(queryName, columns, filters, sortBy, limit, groupBy, having, distinct, joinType);
            vscode.window.showInformationMessage(`njs: Query "${queryName}" saved`);
            this._refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    async _handleRemoveQuery(queryName) {
        try {
            await this.schemaRegistry.removeQuery(queryName);
            vscode.window.showInformationMessage(`njs: Query "${queryName}" removed`);
            this._refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    _handleGetAuthTableFields(tableName) {
        if (!this._panel) return;
        const table = this.schemaRegistry.getTable(tableName);
        if (!table) {
            this._panel.webview.postMessage({ command: 'authFieldsReceived', table: { fields: [] }, suggestedIdentity: [], suggestedPassword: null, suggestedStatus: null });
            return;
        }
        const { AuthGenerator } = require('./authGenerator');
        const authGen = new AuthGenerator(this.schemaRegistry);
        const suggestedIdentity = authGen.detectIdentityFields(table);
        const suggestedPassword = authGen.detectPasswordField(table);
        const suggestedStatus = authGen.detectStatusField(table);
        this._panel.webview.postMessage({
            command: 'authFieldsReceived',
            table: { fields: table.fields },
            suggestedIdentity: suggestedIdentity,
            suggestedPassword: suggestedPassword,
            suggestedStatus: suggestedStatus
        });
    }

    async _handleGenerateAuth(tableName, identityFields, passwordField, statusField, options) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('njs: Open a file first to insert generated code');
            return;
        }
        const { AuthGenerator } = require('./authGenerator');
        const authGen = new AuthGenerator(this.schemaRegistry);
        const opts = options || {};
        let allCode = '';
        if (opts.generateRoute !== false) {
            allCode += authGen.generateLogin(tableName, identityFields, passwordField, statusField, opts);
            allCode += '\n\n';
        }
        if (opts.generateRegister) {
            const table = this.schemaRegistry.getTable(tableName);
            const allFields = table ? table.fields.map(f => f.name) : [];
            allCode += authGen.generateRegister(tableName, allFields, passwordField);
            allCode += '\n\n';
        }
        if (opts.generateHtml !== false) {
            allCode += authGen.generateLoginFormHtml(tableName, identityFields, passwordField, opts);
            allCode += '\n\n';
        }
        if (!allCode) {
            allCode = '// Auth: Select at least one output option (route, register, or HTML)';
        }
        try {
            const edit = new vscode.WorkspaceEdit();
            edit.insert(editor.document.uri, editor.selection.active, allCode);
            const success = await vscode.workspace.applyEdit(edit);
            if (success) {
                vscode.window.showInformationMessage(`njs: Generated auth code for "${tableName}"`);
            }
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    _handlePreviewAuthSql(tableName, identityFields, passwordField, statusField) {
        if (!this._panel) return;
        const { AuthGenerator } = require('./authGenerator');
        const authGen = new AuthGenerator(this.schemaRegistry);
        const code = authGen.generateLogin(tableName, identityFields, passwordField, statusField, { useJwt: true });
        this._panel.webview.postMessage({
            command: 'authPreviewResult',
            code: code
        });
    }

    _handleFindDbFiles() {
        if (!this._panel) return;
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
        const files = findDbFiles(workspaceRoot);
        this._panel.webview.postMessage({ command: 'dbFileList', files, selectedPath: this._selectedDbPath || null });
    }

    async _handleRunQuery(sql) {
        if (!this._panel) return;
        if (!this._selectedDbPath) {
            this._panel.webview.postMessage({
                command: 'queryResult',
                success: false,
                error: 'No database file selected. Choose a .db file from the dropdown.'
            });
            return;
        }

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
        if (!workspaceRoot) {
            this._panel.webview.postMessage({
                command: 'queryResult',
                success: false,
                error: 'No workspace open'
            });
            return;
        }

        const fullPath = path.resolve(workspaceRoot, this._selectedDbPath);
        this._panel.webview.postMessage({ command: 'queryRunning' });
        const result = await runQuery(fullPath, sql);
        this._panel.webview.postMessage({
            command: 'queryResult',
            success: result.success,
            results: result.results || [],
            rowCount: result.rowCount || 0,
            error: result.error || null
        });
    }

    _handlePreviewQuerySql(queryName, columns, filters, sortBy, limit, groupBy, having, distinct, joinType) {
        if (!this._panel) return;
        const gen = this.generator || new CodeGenerator(this.schemaRegistry);
        try {
            const sql = gen.generateQuerySql(columns || [], filters || [], sortBy, limit, groupBy || [], having || [], !!distinct, joinType);
            this._panel.webview.postMessage({
                command: 'sqlPreviewResult',
                sql: sql
            });
        } catch (err) {
            this._panel.webview.postMessage({
                command: 'sqlPreviewResult',
                sql: '-- Error generating SQL: ' + err.message
            });
        }
    }

    async _handleGenerateQuery(queryName, columns, type, filters, sortBy, limit, groupBy, having, distinct, joinType) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('njs: Open a file first to insert generated code');
            return;
        }

        const gen = this.generator || new CodeGenerator(this.schemaRegistry);
        const filterArr = filters || [];
        const groupByArr = groupBy || [];
        const havingArr = having || [];
        const isDistinct = !!distinct;
        const joinT = joinType || 'LEFT';
        let code = '';

        if (type === 'all') {
            // Save the query first if not already saved
            try {
                const existing = this.schemaRegistry.getQuery(queryName);
                if (!existing) {
                    await this.schemaRegistry.addQuery(queryName, columns, filterArr, sortBy, limit, groupByArr, havingArr, isDistinct, joinT);
                }
            } catch (e) {
                // Query might already exist, ignore
            }

            code += `// --- ${queryName} (SQL) ---\n`;
            code += gen.generateQuerySql(columns, filterArr, sortBy, limit, groupByArr, havingArr, isDistinct, joinT);
            code += '\n\n';
            code += `// --- ${queryName} (Server Route) ---\n`;
            code += gen.generateQueryServer(queryName, columns, filterArr, sortBy, limit, groupByArr, havingArr, isDistinct, joinT);
            code += '\n\n';
            code += `// --- ${queryName} (Fetch JS) ---\n`;
            code += gen.generateQueryFetchJs(queryName, columns);
            code += '\n\n';
            code += `<!-- --- ${queryName} (Card HTML) --- -->\n`;
            code += gen.generateQueryCardHtml(queryName, columns);
            code += '\n\n';
            code += `<!-- --- ${queryName} (Table HTML) --- -->\n`;
            code += gen.generateQueryTableHtml(queryName, columns);
        } else {
            switch (type) {
                case 'sql':
                    code = gen.generateQuerySql(columns, filterArr, sortBy, limit, groupByArr, havingArr, isDistinct, joinT);
                    break;
                case 'js':
                    code = gen.generateQueryFetchJs(queryName, columns);
                    break;
                case 'server':
                    code = gen.generateQueryServer(queryName, columns, filterArr, sortBy, limit, groupByArr, havingArr, isDistinct, joinT);
                    break;
                case 'card':
                    code = gen.generateQueryCardHtml(queryName, columns);
                    break;
                case 'table':
                    code = gen.generateQueryTableHtml(queryName, columns);
                    break;
            }
        }

        try {
            const edit = new vscode.WorkspaceEdit();
            edit.insert(editor.document.uri, editor.selection.active, code);
            const success = await vscode.workspace.applyEdit(edit);
            if (success) {
                const label = type === 'all' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1);
                vscode.window.showInformationMessage(`njs: Generated ${label} code for "${queryName}"`);
            } else {
                vscode.window.showErrorMessage('njs: Failed to insert code - try clicking in the editor first');
            }
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    async _handleGenerateTable(tableName) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('njs: Open a file first to insert generated code');
            return;
        }

        const gen = this.generator || new CodeGenerator(this.schemaRegistry);
        const code = gen.generateCrud(tableName);

        try {
            const edit = new vscode.WorkspaceEdit();
            edit.insert(editor.document.uri, editor.selection.active, code);
            const success = await vscode.workspace.applyEdit(edit);
            if (success) {
                vscode.window.showInformationMessage(`njs: Generated CRUD code for "${tableName}"`);
            } else {
                vscode.window.showErrorMessage('njs: Failed to insert code - try clicking in the editor first');
            }
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    async _handleGenerateApp(tableConfigs, authConfig, options) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('njs: Open a file first to insert generated code');
            return;
        }
        const { AppGenerator } = require('./appGenerator');
        const appGen = new AppGenerator(this.schemaRegistry);
        const result = appGen.generateApp(tableConfigs, authConfig, options || {});
        let allCode = result.server;
        if (result.html) allCode += '\n\n' + result.html;
        if (result.js) allCode += '\n\n' + result.js;
        try {
            const edit = new vscode.WorkspaceEdit();
            edit.insert(editor.document.uri, editor.selection.active, allCode);
            const success = await vscode.workspace.applyEdit(edit);
            if (success) {
                const tableCount = tableConfigs ? tableConfigs.length : 0;
                const label = authConfig ? ' with Auth' : '';
                vscode.window.showInformationMessage(`njs: Generated app code for ${tableCount} tables${label}`);
            }
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    _getHtml() {
        console.log('njs: _getHtml() called, schema tables:', this.schemaRegistry.getTables().length);
        const extRoot = this.context.extensionUri;
        const styleUri = this._panel.webview.asWebviewUri(vscode.Uri.joinPath(extRoot, 'src', 'webview', 'schemaView.css'));
        const scriptUri = this._panel.webview.asWebviewUri(vscode.Uri.joinPath(extRoot, 'src', 'webview', 'schemaView.js'));
        const cspSrc = this._panel.webview.cspSource || 'https://vscode-resource.vscode-cdn.net';
        const tables = this.schemaRegistry.getTables();
        const queries = this.schemaRegistry.getQueries();
        const queryNames = Object.keys(queries);
        const savedQueryHtml = queryNames.map(qName => {
            const q = queries[qName];
            const colCount = q.columns ? q.columns.length : 0;
            const tableCount = q.columns ? new Set(q.columns.map(c => c.table)).size : 0;
            const filterCount = q.filters ? q.filters.length : 0;
            const hasDistinct = !!q.distinct;
            const hasSort = q.sortBy && q.sortBy.table && q.sortBy.field;
            const hasLimit = q.limit && parseInt(q.limit) > 0;
            const groupByCount = q.groupBy ? q.groupBy.length : 0;
            const havingCount = q.having ? q.having.length : 0;
            const jsSafeName = this._jsStr(qName);
            let infoText = colCount + ' col' + (colCount !== 1 ? 's' : '') + ' from ' + tableCount + ' table' + (tableCount !== 1 ? 's' : '');
            if (hasDistinct) infoText += ', DISTINCT';
            if (filterCount > 0) infoText += ', ' + filterCount + ' filter' + (filterCount !== 1 ? 's' : '');
            if (groupByCount > 0) infoText += ', ' + groupByCount + ' group' + (groupByCount !== 1 ? 's' : '');
            if (havingCount > 0) infoText += ', ' + havingCount + ' having' + (havingCount !== 1 ? 's' : '');
            if (hasSort) infoText += ', sorted by ' + q.sortBy.field;
            if (hasLimit) infoText += ', limit ' + q.limit;
            return `<div class="saved-query-item">
                <span><span class="sq-name">${this._escapeHtml(qName)}</span><span class="sq-info">${infoText}</span></span>
                <span class="sq-actions">
                    <button class="btn btn-info btn-sm" onclick="loadSavedQuery('${jsSafeName}')" title="Load query">Load</button>
                    <button class="btn btn-danger btn-sm" onclick="removeQuery('${jsSafeName}', event)" title="Delete query">${this._svgCloseIcon()}</button>
                </span>
            </div>`;
        }).join('\n') || '<div class="qb-empty">No saved queries yet</div>';

        const tableCards = tables.map(name => {
            const table = this.schemaRegistry.getTable(name);
            if (!table) return '';
            return this._renderTableCard(name, table);
        }).join('\n');

        const hasTables = tables.length > 0;

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${cspSrc}; script-src 'unsafe-inline' ${cspSrc}; img-src 'self' data:;">
<link rel="stylesheet" href="${styleUri}" />
</head>
<body>
    <div class="header">
        <h1>Schema Visualizer</h1>
        <div class="tab-bar">
            <button class="tab-btn tab-active" onclick="switchTab('tables')" id="tabTables">Tables</button>
            <button class="tab-btn" onclick="switchTab('queries')" id="tabQueries">Query Builder</button>
            <button class="tab-btn" onclick="switchTab('auth')" id="tabAuth">Auth</button>
            <button class="tab-btn" onclick="switchTab('quickstart')" id="tabQuickstart">Quick Start</button>
        </div>
        <div class="header-actions">
            <button class="btn btn-primary" onclick="addTable()">${this._svgAddIcon()} Add Table</button>
            <button class="btn btn-success" onclick="generateAll()" ${hasTables ? '' : 'disabled'}>
                ${this._svgGenerateIcon()} Generate All
            </button>
            <button class="btn btn-info" onclick="regenAll()" ${hasTables ? '' : 'disabled'}>
                ${this._svgRefreshIcon()} Regen All
            </button>
            <button class="btn btn-warning" onclick="refresh()">${this._svgRefreshIcon()} Refresh</button>
        </div>
    </div>

    <div id="tabTablesContent" class="tab-content tab-active">
        <div class="help-section">
            <div style="display:flex;align-items:center;justify-content:space-between;">
                <h4 style="margin:0;">What is a Foreign Key?</h4>
                <button class="help-toggle" onclick="toggleHelp(event)" title="Toggle help section">
                    <span class="arrow" id="helpArrow">\u25BC</span> Hide
                </button>
            </div>
            <div class="help-content" id="helpContent">
                <p style="margin-top:10px;">
                    A <strong>Foreign Key (FK)</strong> links a field in one table to the
                    <span class="pk-highlight">Primary Key (PK)</span> of another table.
                    It ensures <strong>data integrity</strong> - you cannot reference something that does not exist.
                </p>
                <p style="margin-top:6px;">
                    <strong>Example:</strong>
                    <code>Enrollments.studentID</code> -&gt; <code>Students.studentID</code>
                    means every enrollment must belong to an <strong>existing</strong> student.
                    Click the <span class="fk-highlight">FK icon</span> on a non-PK field to create these links.
                </p>
                <p style="margin-top:6px; color:#888;">
                    <span class="tip-label">Tip:</span> Always register the <em>referenced</em> table first, then add the FK.
                </p>
            </div>
        </div>

        ${hasTables ? `
        <div class="tables-container">
            ${tableCards}
        </div>
        <div class="status-bar">
            <span><strong>${tables.length}</strong> table${tables.length !== 1 ? 's' : ''} registered</span>
            <span>Click FK icon on a non-PK field to add relationship, X to remove</span>
        </div>
        ` : `
        <div class="empty-state">
            <h2>No tables yet</h2>
            <p>Click <strong>+ Add Table</strong> to register your first table,<br>
            or type <code>njs:register TableName:field1, field2, ...</code> in any file.</p>
            <br>
            <button class="btn btn-primary" onclick="addTable()">${this._svgAddIcon()} Add Table</button>
        </div>
        `}
    </div>

    <div id="tabQueriesContent" class="tab-content">
        ${hasTables ? `
        <div class="query-builder">
            <h3>${this._svgGenerateIcon()} Query Builder</h3>
            <div id="savedQueries">${savedQueryHtml}</div>
            <hr class="qb-divider">
            <div class="qb-header">
                <input id="queryName" type="text" placeholder="Query name (e.g. enrollmentsWithCourses)" />
                <label class="qb-distinct-toggle" title="SELECT DISTINCT">
                    <input type="checkbox" onchange="toggleDistinct(this.checked)" />
                    <span class="qb-distinct-label">DISTINCT</span>
                </label>
            </div>
            <div class="drop-zone" id="dropZone">
                Drag fields from table cards above
            </div>
            <div id="selectedColumns"></div>
            <div class="qb-filters" id="qbFilters">
                <span class="qb-filter-label">Filters (WHERE):</span>
                <div id="filterRows"></div>
                <button class="btn btn-info btn-sm" onclick="addFilter()" disabled id="addFilterBtn">+ Add Filter</button>
            </div>
            <div id="sortControls" class="qb-filters"></div>
            <div id="groupBySection" class="qb-filters">
                <span class="qb-filter-label">Group By:</span>
                <div id="groupByCheckboxes" class="qb-groupby-cbs"></div>
            </div>
            <div id="havingSection" class="qb-filters">
                <span class="qb-filter-label">Having:</span>
                <div id="havingRows"></div>
                <button class="btn btn-info btn-sm" onclick="addHaving()" disabled id="addHavingBtn">+ Add Having</button>
            </div>
            <div class="qb-actions">
                <button class="btn btn-success gen-query-btn" onclick="generateQuery()" disabled>${this._svgGenerateIcon()} Generate All</button>
                <button class="btn btn-primary gen-query-btn" onclick="generateQuery('sql')" disabled>SQL</button>
                <button class="btn btn-primary gen-query-btn" onclick="generateQuery('js')" disabled>JS Fetch</button>
                <button class="btn btn-primary gen-query-btn" onclick="generateQuery('server')" disabled>Server</button>
                <button class="btn btn-primary gen-query-btn" onclick="generateQuery('card')" disabled>Card HTML</button>
                <button class="btn btn-primary gen-query-btn" onclick="generateQuery('table')" disabled>Table HTML</button>
                <button class="btn btn-warning" onclick="saveQuery()" disabled id="saveBtn">Save Query</button>
                <button class="btn btn-danger" onclick="clearQuery()">Clear</button>
            </div>
            <hr class="qb-divider">
            <div class="qb-preview-section">
                <div class="qb-preview-header">
                    <span class="qb-filter-label" style="margin:0;">SQL Preview</span>
                    <button class="btn btn-info btn-sm" onclick="previewSqlQuery()" disabled id="previewSqlBtn">Refresh Preview</button>
                    <button class="btn btn-info btn-sm" onclick="copySqlPreview()" id="copySqlBtn" title="Copy SQL to clipboard">Copy SQL</button>
                </div>
                <textarea class="qb-preview-textarea" id="sqlPreview" readonly placeholder="Add columns and the SQL preview updates automatically"></textarea>
                <div class="qb-db-selector">
                    <span class="qb-db-label">Database:</span>
                    <select id="dbFileSelect" onchange="onDbFileChange(this.value)">
                        <option value="">— No database selected —</option>
                    </select>
                    <button class="qb-db-refresh-btn" onclick="findDbFiles()" title="Refresh database file list">&#x21bb;</button>
                    <button class="btn btn-success btn-sm" onclick="runSqlQuery()" id="runQueryBtn" title="Run the generated SQL against the selected database">&#x25B6; Run Query</button>
                </div>
                <div id="queryResults"></div>
            </div>
        </div>
        ` : `
        <div class="empty-state">
            <h2>Register tables first</h2>
            <p>Go to the <strong>Tables</strong> tab, add some tables,<br>
            then come here to build custom queries.</p>
        </div>
        `}
    </div>

    <div id="tabAuthContent" class="tab-content">
        ${hasTables ? `
        <div class="auth-panel">
            <h3>${this._svgGenerateIcon()} Auth Generator</h3>
            <p style="color:#888;font-size:12px;margin-bottom:14px;line-height:1.5;">
                Generate a login route for <strong>any</strong> registered table.
                Pick which fields identify the user and which field holds the password.
            </p>

            <div class="auth-section">
                <label>Step 1: Pick any table</label>
                <select id="authTableSelect" onchange="onAuthTableChange(this.value)">
                    <option value="">— Select a table —</option>
                    ${tables.map(t => `<option value="${this._escapeHtml(t)}">${this._escapeHtml(t)}</option>`).join('\n')}
                </select>
            </div>

            <div class="auth-section" id="authIdentitySection" style="opacity:0.4;pointer-events:none;">
                <label>Step 2: Identity fields (check 1 or more — login requires ALL checked)</label>
                <div id="authIdentityFields" class="auth-field-cbs">
                    <span class="auth-no-fields">Select a table first</span>
                </div>
            </div>

            <div class="auth-section" id="authPasswordSection" style="opacity:0.4;pointer-events:none;">
                <label>Step 3: Password field</label>
                <select id="authPasswordSelect" onchange="onAuthPasswordChange(this.value)">
                    <option value="">— Select password field —</option>
                </select>
            </div>

            <div class="auth-section" id="authStatusSection" style="opacity:0.4;pointer-events:none;">
                <label>Step 4: Status field (optional — for active/inactive check)</label>
                <select id="authStatusSelect" onchange="onAuthStatusChange(this.value)">
                    <option value="">— None (skip status check) —</option>
                </select>
                <div class="auth-info">If selected, login will reject accounts where this field is not 'active'.</div>
            </div>

            <div class="auth-section" id="authOptionsSection" style="opacity:0.4;pointer-events:none;">
                <label>Step 5: Output options</label>
                <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px;">
                    <label class="qb-groupby-cb checked" style="border-color:#4fc3f7;background:#0d2a2a;color:#8cf;">
                        <input type="checkbox" checked onchange="onAuthOptionChange()" id="authOptRoute" />
                        <span>Login route (server)</span>
                    </label>
                    <label class="qb-groupby-cb" style="color:#888;">
                        <input type="checkbox" onchange="onAuthOptionChange()" id="authOptRegister" />
                        <span>Register route (server)</span>
                    </label>
                    <label class="qb-groupby-cb checked" style="border-color:#4fc3f7;background:#0d2a2a;color:#8cf;">
                        <input type="checkbox" checked onchange="onAuthOptionChange()" id="authOptHtml" />
                        <span>Login form HTML</span>
                    </label>
                    <label class="qb-groupby-cb checked" style="border-color:#4fc3f7;background:#0d2a2a;color:#8cf;">
                        <input type="checkbox" checked onchange="onAuthOptionChange()" id="authOptJwt" />
                        <span>Use JWT</span>
                    </label>
                </div>
            </div>

            <div class="qb-actions" style="margin-top:16px;">
                <button class="btn btn-success" onclick="generateAuth()" disabled id="authGenBtn">${this._svgGenerateIcon()} Generate Auth Code</button>
                <button class="btn btn-info" onclick="previewAuthSql()" disabled id="authPrevBtn">Preview SQL</button>
                <button class="btn btn-warning" onclick="clearAuth()">Clear</button>
            </div>

            <hr class="qb-divider">
            <div class="auth-preview">
                <div class="qb-preview-header">
                    <span class="qb-filter-label" style="margin:0;">Generated Code Preview</span>
                    <button class="btn btn-info btn-sm" onclick="copyAuthPreview()" id="copyAuthBtn" title="Copy to clipboard">Copy Code</button>
                </div>
                <textarea class="qb-preview-textarea" id="authPreview" readonly placeholder="Configure auth above and click Preview SQL or Generate Auth Code"></textarea>
            </div>
        </div>
        ` : `
        <div class="empty-state">
            <h2>Register tables first</h2>
            <p>Go to the <strong>Tables</strong> tab, add at least one table<br>
            with a password field, then configure authentication here.</p>
        </div>
        `}
    </div>

    <div id="tabQuickstartContent" class="tab-content">
        <div class="auth-panel">
            <h3>Quick App Generator</h3>
            <p style="color:#888;font-size:12px;margin-bottom:14px;line-height:1.5;">
                Select tables, choose what to generate, and click one button.<br>
                Works for <strong>any</strong> project.
            </p>

            <div class="auth-section">
                <label>Step 1: Pick tables to include</label>
                <div id="qsTableList" class="auth-field-cbs">
                    ${tables.map(t => {
                        const qsTable = this.schemaRegistry.getTable(t);
                        const qsFc = qsTable ? qsTable.fields.length : 0;
                        return `<label class="auth-field-cb checked" style="border-color:#4fc3f7;background:#0d2a2a;color:#8cf;">
                            <input type="checkbox" checked onchange="onQsTableToggle('${this._jsStr(t)}', this.checked)" />
                            <span>${this._escapeHtml(t)}</span>
                            <span class="auth-cb-type">(${qsFc} fields)</span>
                        </label>`;
                    }).join('\n')}
                </div>
            </div>

            <div class="auth-section">
                <label>Step 2: What to generate</label>
                <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;">
                    <label class="qb-groupby-cb checked" style="border-color:#4fc3f7;background:#0d2a2a;color:#8cf;">
                        <input type="checkbox" checked onchange="updateQsBtn()" id="qsOptCrud" />
                        <span>CRUD Routes (server)</span>
                    </label>
                    <label class="qb-groupby-cb" style="color:#888;">
                        <input type="checkbox" onchange="updateQsBtn()" id="qsOptCreateTable" />
                        <span>CREATE TABLE SQL</span>
                    </label>
                    <label class="qb-groupby-cb checked" style="border-color:#4fc3f7;background:#0d2a2a;color:#8cf;">
                        <input type="checkbox" checked onchange="updateQsBtn()" id="qsOptPage" />
                        <span>HTML Pages (form + list)</span>
                    </label>
                    <label class="qb-groupby-cb" style="color:#888;">
                        <input type="checkbox" onchange="updateQsBtn()" id="qsOptBoilerplate" />
                        <span>Full HTML boilerplate</span>
                    </label>
                </div>
            </div>

            <div class="auth-section" style="border-top:1px solid #2a4a4a;padding-top:12px;">
                <label>Optional: Include Auth</label>
                <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;align-items:center;">
                    <label class="qb-groupby-cb" style="color:#888;">
                        <input type="checkbox" onchange="updateQsBtn()" id="qsEnableAuth" />
                        <span>Include login system</span>
                    </label>
                    <span style="color:#555;font-size:11px;">(configure in Auth tab first)</span>
                </div>
            </div>

            <div class="qb-actions" style="margin-top:16px;">
                <button class="btn btn-success" onclick="generateApp()" id="qsGenBtn">Generate Everything</button>
                <button class="btn btn-warning" onclick="clearQs()">Clear</button>
            </div>
        </div>
    </div>

    <script src="${scriptUri}"></script>
</body>
</html>`;
    }

    _renderTableCard(name, table) {
        const safeName = this._escapeHtml(name);
        const jsSafeName = this._jsStr(name);
        const fieldRows = table.fields.map(f => this._renderFieldRow(name, f)).join('\n');
        const fkConnectors = table.fields
            .filter(f => f.fk)
            .map(f => {
                const jsSafeField = this._jsStr(f.name);
                return `
                <div class="fk-connector"
                     data-ref-table="${this._escapeHtml(f.fk.table)}"
                     data-ref-field="${this._escapeHtml(f.fk.field)}"
                     data-src-field="${this._escapeHtml(f.name)}">
                    <span class="arrow">${this._svgArrowRight()}</span>
                    References <strong>${this._escapeHtml(f.fk.table)}(${this._escapeHtml(f.fk.field)})</strong>
                    <button class="btn btn-danger btn-sm" onclick="removeFK('${jsSafeName}', '${jsSafeField}', event)" title="Remove FK">${this._svgCloseIcon()}</button>
                </div>`;
            }).join('\n');

        return `
        <div class="table-card" data-table-name="${safeName}">
            <div class="table-card-header">
                <h3>${safeName}</h3>
                <div class="table-actions">
                    <button class="btn btn-info btn-sm" onclick="selectAllFields('${jsSafeName}', event)" title="Add all fields to Query Builder">All</button>
                    <button class="btn btn-info btn-sm" onclick="previewSql('${jsSafeName}', event)" title="Preview SQL">SQL</button>
                    <button class="btn btn-success btn-sm" onclick="generateTable('${jsSafeName}', event)" title="Generate code">${this._svgGenerateIcon()}</button>
                    <button class="btn btn-danger btn-sm" onclick="removeTable('${jsSafeName}', event)" title="Remove table">${this._svgCloseIcon()}</button>
                </div>
            </div>
            <div class="table-card-body">
                ${fieldRows}
                ${fkConnectors}
            </div>
        </div>`;
    }

    _renderFieldRow(tableName, field) {
        const isPK = field.pk;
        const isFK = !!field.fk;
        const iconSvg = isPK ? this._svgPkIcon() : (isFK ? this._svgFkIcon() : this._svgRegularIcon());
        const iconClass = isPK ? 'pk' : (isFK ? 'fk' : 'reg');
        const typeLabel = field.type || 'TEXT';
        const safeFieldName = this._escapeHtml(field.name);
        const jsSafeTable = this._jsStr(tableName);
        const jsSafeField = this._jsStr(field.name);

        let constraints = '';
        if (isPK) constraints += '<span class="badge badge-pk">PK</span>';
        if (isFK) constraints += '<span class="badge badge-fk">FK</span>';
        if (field.notNull) constraints += '<span class="badge badge-nn">NN</span>';
        if (field.default !== undefined) {
            let defVal = String(field.default).replace(/^['"]|['"]$/g, '');
            constraints += `<span class="badge badge-default">=${this._escapeHtml(defVal)}</span>`;
        }

        const fkButton = isFK
            ? `<button class="btn btn-danger btn-sm" onclick="removeFK('${jsSafeTable}', '${jsSafeField}', event)" title="Remove FK">${this._svgCloseIcon()}</button>`
            : (!isPK
                ? `<button class="btn btn-primary btn-sm" onclick="addFK('${jsSafeTable}', '${jsSafeField}', event)" title="Add foreign key">${this._svgLinkIcon()}</button>`
                : '');

        return `
        <div class="field-row" draggable="true"
             onclick="toggleFieldQuery('${jsSafeTable}', '${jsSafeField}')"
             title="Click to toggle in Query Builder | Drag to add"
             data-table-name="${this._escapeHtml(tableName)}"
             data-field-name="${safeFieldName}"
             ondragstart="onFieldDragStart(event, '${jsSafeTable}', '${jsSafeField}')">
            <input type="checkbox" class="field-toggle-cb" onclick="event.stopPropagation(); toggleFieldQuery('${jsSafeTable}', '${jsSafeField}')" />
            <span class="field-icon ${iconClass}">${iconSvg}</span>
            <span class="field-name">${safeFieldName}</span>
            <span class="field-type">${typeLabel}</span>
            <div class="field-constraints">${constraints}</div>
            <div class="field-actions">${fkButton}</div>
        </div>`;
    }

    _escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Escape for JavaScript string inside single-quoted onclick attribute
    _jsStr(str) {
        return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    }

    dispose() {
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
        if (this._panel) {
            this._panel.dispose();
            this._panel = null;
        }
    }
}

module.exports = { SchemaViewProvider };
