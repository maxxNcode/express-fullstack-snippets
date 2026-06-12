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
            this._refresh();
            return;
        }

        this._panel = vscode.window.createWebviewPanel(
            'njsSchemaView',
            'Schema Visualizer',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [],
                contentSecurityPolicy: "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';"
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
            this._panel.webview.html = this._getHtml();
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
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: #1e1e1e;
        color: #d4d4d4;
        padding: 16px;
    }
    .header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 20px;
        flex-wrap: wrap;
    }
    .header h1 {
        font-size: 20px;
        font-weight: 600;
        color: #fff;
        flex: 1;
    }
    .header-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }
    .btn {
        padding: 8px 16px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.15s;
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }
    .btn-primary { background: #0078d4; color: #fff; }
    .btn-primary:hover { background: #1a8ae8; }
    .btn-success { background: #0d7a3e; color: #fff; }
    .btn-success:hover { background: #12a153; }
    .btn-warning { background: #6a5a00; color: #fff; }
    .btn-warning:hover { background: #8a7a00; }
    .btn-info { background: #2a5a7a; color: #fff; }
    .btn-info:hover { background: #3a7a9a; }
    .btn-danger { background: #c03131; color: #fff; }
    .btn-danger:hover { background: #d64545; }
    .btn-sm { padding: 4px 10px; font-size: 12px; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .empty-state {
        text-align: center;
        padding: 48px 20px;
        color: #888;
    }
    .empty-state h2 { font-size: 18px; margin-bottom: 8px; color: #aaa; }
    .empty-state p { font-size: 14px; line-height: 1.6; }

    .tables-container {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        align-items: flex-start;
    }
    .table-card {
        background: #252526;
        border: 1px solid #3c3c3c;
        border-radius: 10px;
        overflow: hidden;
        width: 320px;
        flex-shrink: 0;
    }
    .table-card-header {
        background: #2d2d2d;
        padding: 12px 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid #3c3c3c;
    }
    .table-card-header h3 {
        font-size: 15px;
        font-weight: 600;
        color: #fff;
    }
    .table-card-header .table-actions {
        display: flex;
        gap: 4px;
    }
    .table-card-body { padding: 8px 0; }
    .field-row {
        display: flex;
        align-items: center;
        padding: 6px 16px;
        gap: 8px;
        border-bottom: 1px solid #2a2a2a;
        transition: background 0.1s;
        cursor: pointer;
    }
    .field-row:last-child { border-bottom: none; }
    .field-row:hover { background: #2a2a2a; }
    .field-icon {
        width: 22px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }
    .field-icon.reg { opacity: 0.5; }
    .field-name {
        font-family: 'Consolas', 'Courier New', monospace;
        font-size: 13px;
        flex: 1;
    }
    .field-type {
        font-size: 11px;
        color: #888;
        font-family: 'Consolas', monospace;
        background: #1e1e1e;
        padding: 2px 6px;
        border-radius: 4px;
    }
    .field-constraints {
        display: flex;
        gap: 4px;
        font-size: 10px;
    }
    .badge {
        padding: 1px 6px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 500;
    }
    .badge-pk { background: #554400; color: #ffd700; }
    .badge-fk { background: #004466; color: #4fc3f7; }
    .badge-nn { background: #440000; color: #ff6b6b; }
    .badge-default { background: #224422; color: #6bff6b; }
    .field-actions { flex-shrink: 0; display: flex; gap: 2px; }

    /* FK reference highlighting */
    .table-card.highlight {
        box-shadow: 0 0 20px rgba(79, 195, 247, 0.5), 0 0 40px rgba(79, 195, 247, 0.2);
        border-color: #4fc3f7;
        transition: box-shadow 0.25s ease, border-color 0.25s ease;
    }
    .field-row.highlight {
        background: rgba(79, 195, 247, 0.18) !important;
        transition: background 0.2s ease;
    }
    .field-row.highlight .field-name {
        color: #7fd7ff;
    }
    .fk-connector:hover {
        background: rgba(79, 195, 247, 0.08);
        border-radius: 4px;
        cursor: default;
    }

    .fk-connector {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: #4fc3f7;
        margin-left: 38px;
        padding: 2px 16px 6px;
        font-family: 'Consolas', monospace;
    }
    .fk-connector .arrow { color: #4fc3f7; }

    .status-bar {
        margin-top: 20px;
        padding: 12px 16px;
        background: #2d2d2d;
        border-radius: 8px;
        font-size: 13px;
        color: #888;
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    .status-bar strong { color: #d4d4d4; }

    .help-section {
        background: #1a2a3a;
        border: 1px solid #2a4a5a;
        border-radius: 8px;
        padding: 14px 18px;
        margin-bottom: 16px;
        font-size: 13px;
        line-height: 1.6;
        color: #b0c8d4;
    }
    .help-section h4 { color: #6cf; margin-bottom: 6px; font-size: 14px; }
    .help-section code {
        background: #0d1828;
        padding: 1px 5px;
        border-radius: 3px;
        font-family: 'Consolas', monospace;
        font-size: 12px;
    }
    .help-section .fk-highlight { color: #4fc3f7; font-weight: 600; }
    .help-section .pk-highlight { color: #ffd700; font-weight: 600; }
    .help-section .tip-label { color: #888; font-weight: 600; }
    .help-toggle {
        cursor: pointer;
        user-select: none;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        color: #888;
        background: none;
        border: none;
        padding: 2px 8px;
        border-radius: 4px;
    }
    .help-toggle:hover { background: #333; color: #ddd; }
    .help-toggle .arrow { transition: transform 0.2s; display: inline-block; }
    .help-toggle .arrow.collapsed { transform: rotate(-90deg); }
    .help-content { overflow: hidden; transition: max-height 0.3s ease, opacity 0.2s ease; max-height: 500px; opacity: 1; padding: 0 18px 14px; }
    .help-content.hidden { max-height: 0 !important; opacity: 0 !important; padding: 0 18px !important; }

    /* Query Builder */
    .query-builder {
        background: #1a2a2a;
        border: 1px solid #2a4a4a;
        border-radius: 10px;
        padding: 16px;
        margin-top: 16px;
    }
    .query-builder h3 {
        color: #6cf;
        font-size: 15px;
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .qb-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
        flex-wrap: wrap;
    }
    .qb-header input {
        background: #1e1e1e;
        border: 1px solid #3c3c3c;
        border-radius: 6px;
        padding: 8px 12px;
        color: #d4d4d4;
        font-size: 13px;
        font-family: 'Consolas', monospace;
        flex: 1;
        min-width: 150px;
    }
    .qb-header input:focus {
        outline: none;
        border-color: #0078d4;
    }
    .qb-header input::placeholder {
        color: #555;
    }

    .drop-zone {
        border: 2px dashed #3a5a5a;
        border-radius: 8px;
        padding: 20px;
        text-align: center;
        color: #666;
        font-size: 13px;
        transition: all 0.2s;
        min-height: 60px;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        justify-content: center;
        align-content: center;
    }
    .drop-zone.drag-over {
        border-color: #4fc3f7;
        background: rgba(79, 195, 247, 0.06);
        color: #4fc3f7;
    }
    .drop-zone.has-items {
        justify-content: flex-start;
    }

    .qb-col {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: #0d2a2a;
        border: 1px solid #2a5a5a;
        border-radius: 20px;
        padding: 4px 10px;
        font-size: 12px;
        font-family: 'Consolas', monospace;
        color: #8cf;
        cursor: default;
        transition: all 0.15s;
    }
    .qb-col:hover {
        background: #0d3a3a;
        border-color: #4fc3f7;
    }
    .qb-col .qb-col-remove {
        cursor: pointer;
        color: #f55;
        font-size: 14px;
        line-height: 1;
        margin-left: 2px;
        opacity: 0.6;
        transition: opacity 0.15s;
        background: none;
        border: none;
        padding: 0 2px;
    }
    .qb-col .qb-col-remove:hover { opacity: 1; }
    .qb-col .qb-col-table {
        color: #4fc3f7;
        font-weight: 500;
    }
    .qb-col .qb-col-field {
        color: #b0d8ff;
    }
    .qb-col-aggr {
        background: transparent;
        border: none;
        color: #6f6;
        font-size: 11px;
        font-family: 'Consolas', monospace;
        cursor: pointer;
        outline: none;
        padding: 0 2px;
        max-width: 60px;
    }
    .qb-col-aggr:hover {
        color: #8f8;
    }
    .qb-col-aggr option {
        background: #1e1e1e;
        color: #d4d4d4;
    }

    .qb-actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
        flex-wrap: wrap;
    }

    .saved-query-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: #1e2a2a;
        border: 1px solid #2a4a4a;
        border-radius: 6px;
        padding: 8px 12px;
        margin-bottom: 6px;
        font-size: 13px;
    }
    .saved-query-item:last-child { margin-bottom: 0; }
    .saved-query-item .sq-name {
        color: #6cf;
        font-family: 'Consolas', monospace;
        font-weight: 500;
    }
    .saved-query-item .sq-info {
        color: #888;
        font-size: 11px;
        margin-left: 8px;
    }
    .saved-query-item .sq-actions {
        display: flex;
        gap: 4px;
    }
    .qb-divider {
        border: none;
        border-top: 1px solid #2a4a4a;
        margin: 12px 0;
    }
    .qb-empty {
        color: #555;
        font-size: 12px;
        text-align: center;
        padding: 8px;
    }

    /* Filter rows */
    .qb-filters {
        margin-top: 10px;
    }
    .qb-filter-row {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 6px;
        flex-wrap: wrap;
    }
    .qb-filter-row select, .qb-filter-row input {
        background: #1e1e1e;
        border: 1px solid #3c3c3c;
        border-radius: 6px;
        padding: 6px 10px;
        color: #d4d4d4;
        font-size: 12px;
        font-family: 'Consolas', monospace;
    }
    .qb-filter-row select { min-width: 100px; }
    .qb-filter-row select:focus, .qb-filter-row input:focus {
        outline: none;
        border-color: #0078d4;
    }
    .qb-filter-row .qb-filter-field {
        color: #4fc3f7;
        font-weight: 500;
        min-width: 130px;
    }
    .qb-filter-row .qb-filter-op {
        min-width: 70px;
        color: #aaa;
    }
    .qb-filter-row .qb-filter-val {
        flex: 1;
        min-width: 80px;
        color: #6f6;
    }
    .qb-filter-row .qb-filter-val::placeholder {
        color: #555;
        font-style: italic;
    }
    .qb-filter-label {
        color: #888;
        font-size: 11px;
        margin-top: 8px;
        margin-bottom: 4px;
        display: block;
    }
    .qb-no-filters {
        color: #555;
        font-size: 11px;
        font-style: italic;
    }

    /* Sort / Limit */
    .qb-sort-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 4px;
    }
    .qb-sort-col {
        background: #1e1e1e;
        border: 1px solid #3c3c3c;
        border-radius: 6px;
        padding: 6px 10px;
        color: #d4d4d4;
        font-size: 12px;
        font-family: 'Consolas', monospace;
        min-width: 160px;
    }
    .qb-sort-col:focus {
        outline: none;
        border-color: #0078d4;
    }
    .sort-dir-btn {
        background: #1e1e1e;
        border: 1px solid #3c3c3c;
        border-radius: 6px;
        padding: 6px 12px;
        color: #d4d4d4;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
        font-family: 'Consolas', monospace;
    }
    .sort-dir-btn:hover {
        background: #2a2a2a;
        border-color: #555;
    }
    .sort-dir-btn.sort-dir-active {
        background: #0d3a3a;
        border-color: #4fc3f7;
        color: #6cf;
    }
    .qb-limit-label {
        color: #888;
        font-size: 12px;
        margin-left: 4px;
    }
    .qb-limit-input {
        background: #1e1e1e;
        border: 1px solid #3c3c3c;
        border-radius: 6px;
        padding: 6px 10px;
        color: #d4d4d4;
        font-size: 12px;
        font-family: 'Consolas', monospace;
        width: 90px;
    }
    .qb-limit-input:focus {
        outline: none;
        border-color: #0078d4;
    }
    .qb-limit-input::placeholder {
        color: #555;
    }

    /* Group By checkboxes */
    .qb-groupby-cbs {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 4px;
    }
    .qb-groupby-cb {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: #1e1e1e;
        border: 1px solid #3c3c3c;
        border-radius: 6px;
        padding: 4px 10px;
        font-size: 12px;
        font-family: 'Consolas', monospace;
        cursor: pointer;
        transition: all 0.15s;
        color: #888;
    }
    .qb-groupby-cb input[type="checkbox"] {
        accent-color: #4fc3f7;
        cursor: pointer;
    }
    .qb-groupby-cb.checked {
        border-color: #4fc3f7;
        background: #0d2a2a;
        color: #8cf;
    }
    .qb-groupby-cb:hover {
        border-color: #555;
        background: #2a2a2a;
    }
    .qb-groupby-cb .qb-cb-table {
        color: #4fc3f7;
    }
    .qb-groupby-cb .qb-cb-field {
        color: #b0d8ff;
    }
    .qb-no-groupby {
        color: #555;
        font-size: 11px;
        font-style: italic;
    }
    .qb-having-section {
        margin-top: 10px;
    }

    /* DISTINCT toggle */
    .qb-distinct-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        background: #1e1e1e;
        border: 1px solid #3c3c3c;
        border-radius: 6px;
        padding: 6px 12px;
        font-size: 12px;
        transition: all 0.15s;
        user-select: none;
    }
    .qb-distinct-toggle:hover {
        border-color: #555;
    }
    .qb-distinct-toggle input[type="checkbox"] {
        accent-color: #4fc3f7;
        cursor: pointer;
    }
    .qb-distinct-label {
        color: #888;
        font-weight: 600;
        font-family: 'Consolas', monospace;
        letter-spacing: 0.5px;
        transition: color 0.15s;
    }
    .qb-distinct-toggle:has(input:checked) {
        border-color: #4fc3f7;
        background: #0d2a2a;
    }
    .qb-distinct-toggle:has(input:checked) .qb-distinct-label {
        color: #6cf;
    }

    /* SQL Preview */
    .qb-preview-section {
        margin-top: 4px;
    }
    .qb-preview-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
    }
    .qb-preview-textarea {
        width: 100%;
        min-height: 80px;
        max-height: 200px;
        background: #111;
        border: 1px solid #3c3c3c;
        border-radius: 6px;
        padding: 10px;
        color: #6f6;
        font-family: 'Consolas', monospace;
        font-size: 12px;
        line-height: 1.5;
        resize: vertical;
        outline: none;
        box-sizing: border-box;
    }
    .qb-preview-textarea:focus {
        border-color: #0078d4;
    }
    .qb-preview-textarea::placeholder {
        color: #555;
        font-style: italic;
    }

    /* DB selector */
    .qb-db-selector {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 6px;
    }
    .qb-db-selector select {
        background: #1e1e1e;
        border: 1px solid #3c3c3c;
        border-radius: 6px;
        padding: 6px 10px;
        color: #d4d4d4;
        font-size: 12px;
        font-family: 'Consolas', monospace;
        flex: 1;
        min-width: 120px;
    }
    .qb-db-selector select:focus {
        outline: none;
        border-color: #0078d4;
    }
    .qb-db-selector select option {
        background: #1e1e1e;
        color: #d4d4d4;
    }
    .qb-db-selector .qb-db-label {
        color: #888;
        font-size: 11px;
        white-space: nowrap;
    }
    .qb-db-selector .qb-db-refresh-btn {
        background: none;
        border: 1px solid #3c3c3c;
        border-radius: 4px;
        color: #888;
        cursor: pointer;
        padding: 4px 8px;
        font-size: 11px;
        transition: all 0.15s;
    }
    .qb-db-selector .qb-db-refresh-btn:hover {
        border-color: #555;
        color: #d4d4d4;
    }

    /* Results table */
    .qb-results-section {
        margin-top: 8px;
    }
    .qb-results-info {
        font-size: 11px;
        color: #888;
        margin-bottom: 4px;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .qb-results-info .result-ok {
        color: #6f6;
    }
    .qb-results-info .result-err {
        color: #f55;
    }
    .qb-results-table-wrap {
        overflow-x: auto;
        max-height: 300px;
        overflow-y: auto;
        border: 1px solid #3c3c3c;
        border-radius: 6px;
    }
    .qb-results-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
        font-family: 'Consolas', monospace;
    }
    .qb-results-table th {
        background: #2d2d2d;
        color: #6cf;
        font-weight: 600;
        padding: 6px 10px;
        text-align: left;
        border-bottom: 1px solid #3c3c3c;
        white-space: nowrap;
        position: sticky;
        top: 0;
    }
    .qb-results-table td {
        padding: 4px 10px;
        border-bottom: 1px solid #252525;
        color: #d4d4d4;
        white-space: nowrap;
    }
    .qb-results-table tr:nth-child(even) {
        background: #1a1a1a;
    }
    .qb-results-table tr:hover {
        background: #252525;
    }
    .qb-results-table tr:last-child td {
        border-bottom: none;
    }
    .qb-results-empty {
        color: #555;
        font-size: 11px;
        font-style: italic;
        text-align: center;
        padding: 12px;
    }
    .qb-results-error {
        background: #2a0000;
        border: 1px solid #4a0000;
        border-radius: 6px;
        padding: 8px 12px;
        color: #f55;
        font-size: 12px;
        font-family: 'Consolas', monospace;
    }
    .qb-results-running {
        color: #888;
        font-size: 11px;
        font-style: italic;
        padding: 4px 0;
    }
    .qb-results-count {
        color: #888;
    }

    /* Tab navigation */
    .tab-bar {
        display: flex;
        gap: 4px;
        margin: 0 12px;
    }
    .tab-btn {
        background: #2d2d2d;
        border: 1px solid #3c3c3c;
        border-bottom: none;
        border-radius: 8px 8px 0 0;
        padding: 8px 20px;
        color: #888;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
    }
    .tab-btn:hover {
        color: #d4d4d4;
        background: #333;
    }
    .tab-btn.tab-active {
        background: #1e1e1e;
        color: #6cf;
        border-color: #4fc3f7;
        border-bottom-color: #1e1e1e;
    }
    .tab-content {
        display: none;
    }
    .tab-content.tab-active {
        display: block;
    }

    /* Auth panel */
    .auth-panel {
        background: #1a2a2a;
        border: 1px solid #2a4a4a;
        border-radius: 10px;
        padding: 16px;
        margin-top: 16px;
    }
    .auth-panel h3 {
        color: #6cf;
        font-size: 15px;
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .auth-section {
        margin-bottom: 14px;
    }
    .auth-section label {
        display: block;
        color: #aaa;
        font-size: 12px;
        font-weight: 500;
        margin-bottom: 4px;
    }
    .auth-section select {
        background: #1e1e1e;
        border: 1px solid #3c3c3c;
        border-radius: 6px;
        padding: 8px 12px;
        color: #d4d4d4;
        font-size: 13px;
        font-family: 'Consolas', monospace;
        width: 100%;
        max-width: 400px;
    }
    .auth-section select:focus {
        outline: none;
        border-color: #0078d4;
    }
    .auth-field-cbs {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 4px;
    }
    .auth-field-cb {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: #1e1e1e;
        border: 1px solid #3c3c3c;
        border-radius: 6px;
        padding: 5px 12px;
        font-size: 12px;
        font-family: 'Consolas', monospace;
        cursor: pointer;
        transition: all 0.15s;
        color: #888;
        user-select: none;
    }
    .auth-field-cb:hover {
        border-color: #555;
    }
    .auth-field-cb input[type="checkbox"] {
        accent-color: #4fc3f7;
        cursor: pointer;
    }
    .auth-field-cb.checked {
        border-color: #4fc3f7;
        background: #0d2a2a;
        color: #8cf;
    }
    .auth-field-cb .auth-cb-type {
        color: #666;
        font-size: 10px;
        margin-left: 2px;
    }
    .auth-no-fields {
        color: #555;
        font-size: 11px;
        font-style: italic;
    }
    .auth-info {
        color: #888;
        font-size: 11px;
        margin-top: 2px;
    }
    .auth-preview {
        margin-top: 12px;
    }

    /* Field toggle checkbox and active state */
    .field-toggle-cb {
        accent-color: #4fc3f7;
        cursor: pointer;
        flex-shrink: 0;
        width: 14px;
        height: 14px;
    }
    .field-row.qb-active {
        background: rgba(79, 195, 247, 0.1) !important;
        border-left: 3px solid #4fc3f7;
    }
    .field-row.qb-active .field-name {
        color: #8cf;
    }
    .field-row[draggable="true"] {
        cursor: grab;
    }
    .field-row[draggable="true"]:active {
        cursor: grabbing;
    }
    .field-row.drag-origin {
        opacity: 0.5;
    }

    @media (max-width: 700px) {
        .tables-container { flex-direction: column; }
        .table-card { width: 100%; }
    }
</style>
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
                <select id="authPasswordSelect">
                    <option value="">— Select password field —</option>
                </select>
            </div>

            <div class="auth-section" id="authStatusSection" style="opacity:0.4;pointer-events:none;">
                <label>Step 4: Status field (optional — for active/inactive check)</label>
                <select id="authStatusSelect">
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

    <script>
        const vscode = acquireVsCodeApi();

        function addTable() {
            vscode.postMessage({ command: 'addTable' });
        }

        function removeTable(name, event) {
            if (event) event.stopPropagation();
            vscode.postMessage({ command: 'removeTable', tableName: name });
        }

        function addFK(tableName, fieldName, event) {
            if (event) event.stopPropagation();
            vscode.postMessage({ command: 'addFK', tableName, fieldName });
        }

        function removeFK(tableName, fieldName, event) {
            if (event) event.stopPropagation();
            vscode.postMessage({ command: 'removeFK', tableName, fieldName });
        }

        function generateAll() {
            vscode.postMessage({ command: 'generateAll' });
        }

        function generateTable(name, event) {
            if (event) event.stopPropagation();
            vscode.postMessage({ command: 'generateTable', tableName: name });
        }

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        function regenAll() {
            vscode.postMessage({ command: 'regenAll' });
        }

        // FK reference highlight on hover — also highlights the source field row
        document.addEventListener('mouseover', function(e) {
            const fk = e.target.closest('.fk-connector[data-ref-table]');
            if (fk) {
                const refTable = fk.getAttribute('data-ref-table');
                const refField = fk.getAttribute('data-ref-field');
                const srcTable = fk.closest('.table-card');
                if (srcTable) {
                    var srcField = fk.getAttribute('data-src-field');
                    if (srcField) {
                        var srcRow = srcTable.querySelector('.field-row[data-field-name="' + srcField + '"]');
                        if (srcRow) srcRow.classList.add('highlight');
                    }
                }
                const card = document.querySelector('.table-card[data-table-name="' + refTable + '"]');
                if (card) card.classList.add('highlight');
                if (refField && card) {
                    const row = card.querySelector('.field-row[data-field-name="' + refField + '"]');
                    if (row) row.classList.add('highlight');
                }
            }
        });

        document.addEventListener('mouseout', function(e) {
            const fk = e.target.closest('.fk-connector[data-ref-table]');
            if (!fk) return;
            // Don't remove highlight if still inside the same FK connector (prevents flicker on child elements)
            if (e.relatedTarget && fk.contains(e.relatedTarget)) return;
            const refTable = fk.getAttribute('data-ref-table');
            const refField = fk.getAttribute('data-ref-field');
            const srcTable = fk.closest('.table-card');
            if (srcTable) {
                var srcField = fk.getAttribute('data-src-field');
                if (srcField) {
                    var srcRow = srcTable.querySelector('.field-row[data-field-name="' + srcField + '"]');
                    if (srcRow) srcRow.classList.remove('highlight');
                }
            }
            const card = document.querySelector('.table-card[data-table-name="' + refTable + '"]');
            if (card) card.classList.remove('highlight');
            if (refField && card) {
                const row = card.querySelector('.field-row[data-field-name="' + refField + '"]');
                if (row) row.classList.remove('highlight');
            }
        });

        // --- Query Builder ---
        const qbState = { columns: [], filters: [], sortBy: null, sortLimit: '', groupBy: [], having: [], distinct: false, joinType: 'LEFT' };

        function onFieldDragStart(event, tableName, fieldName) {
            event.dataTransfer.setData('text/plain', JSON.stringify({ table: tableName, field: fieldName }));
            event.dataTransfer.effectAllowed = 'copy';
        }

        function renderFilters() {
            var container = document.getElementById('filterRows');
            if (!container) return;
            schedulePreview();

            if (qbState.filters.length === 0) {
                container.innerHTML = '<span class="qb-no-filters">No filters — all rows included</span>';
                return;
            }

            var ops = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'BETWEEN', 'IN', 'IS NULL', 'IS NOT NULL'];

            container.innerHTML = qbState.filters.map(function(f, idx) {
                // Build column dropdown with the correct 'selected' for this filter
                var colOptions = qbState.columns.map(function(c, ci) {
                    var sel = (c.table === f.table && c.field === f.field) ? ' selected' : '';
                    return '<option value="' + ci + '"' + sel + '>' + c.table + '.' + c.field + '</option>';
                }).join('');

                var opOptions = ops.map(function(op) {
                    var sel = (op === (f.operator || '=')) ? ' selected' : '';
                    return '<option value="' + op + '"' + sel + '>' + op + '</option>';
                }).join('');

                var valHtml = '';
                if (f.operator !== 'IS NULL' && f.operator !== 'IS NOT NULL') {
                    valHtml = '<input class="qb-filter-val" type="text" value="' + (f.value || '') + '" placeholder="value" onchange="updateFilterVal(' + idx + ', this.value)" />';
                }

                return '<div class="qb-filter-row">' +
                    '<select onchange="updateFilterCol(' + idx + ', this.value)">' + colOptions + '</select>' +
                    '<select class="qb-filter-op" onchange="updateFilterOp(' + idx + ', this.value)">' + opOptions + '</select>' +
                    valHtml +
                    '<button class="btn btn-danger btn-sm" onclick="removeFilter(' + idx + ')" title="Remove filter">&times;</button>' +
                    '</div>';
            }).join('');
        }

        // --- Sort / Limit / Join Type ---
        function renderSort() {
            var container = document.getElementById('sortControls');
            if (!container) return;
            schedulePreview();

            if (qbState.columns.length === 0) {
                container.innerHTML = '';
                return;
            }

            var colOptions = qbState.columns.map(function(c, ci) {
                var sel = qbState.sortBy && c.table === qbState.sortBy.table && c.field === qbState.sortBy.field ? ' selected' : '';
                return '<option value="' + ci + '"' + sel + '>' + c.table + '.' + c.field + '</option>';
            }).join('');

            var sortIdx = qbState.sortBy ? qbState.columns.findIndex(function(c) {
                return c.table === qbState.sortBy.table && c.field === qbState.sortBy.field;
            }) : -1;
            if (sortIdx < 0) sortIdx = qbState.columns.length > 0 ? 0 : -1;

            var ascActive = !qbState.sortBy || qbState.sortBy.direction !== 'DESC' ? ' sort-dir-active' : '';
            var descActive = qbState.sortBy && qbState.sortBy.direction === 'DESC' ? ' sort-dir-active' : '';

            var joinLeftSel = qbState.joinType !== 'INNER' ? ' selected' : '';
            var joinInnerSel = qbState.joinType === 'INNER' ? ' selected' : '';

            container.innerHTML = '<span class="qb-filter-label">Sort &amp; Limit:</span>' +
                '<div class="qb-sort-row">' +
                '<select class="qb-sort-col" onchange="onSortColChange(this.value)">' +
                '<option value="">None</option>' + colOptions +
                '</select>' +
                '<button class="btn btn-sm sort-dir-btn' + ascActive + '" onclick="setSortDir(' + "'ASC'" + ')" title="Ascending">ASC</button>' +
                '<button class="btn btn-sm sort-dir-btn' + descActive + '" onclick="setSortDir(' + "'DESC'" + ')" title="Descending">DESC</button>' +
                '<label class="qb-limit-label">Limit:</label>' +
                '<input class="qb-limit-input" type="number" min="0" step="1" placeholder="No limit" value="' + qbState.sortLimit + '" onchange="onSortLimitChange(this.value)" />' +
                '<label class="qb-limit-label" style="margin-left:12px;">Join:</label>' +
                '<select class="qb-sort-col" onchange="onJoinTypeChange(this.value)" style="min-width:100px;">' +
                '<option value="LEFT"' + joinLeftSel + '>LEFT JOIN</option>' +
                '<option value="INNER"' + joinInnerSel + '>INNER JOIN</option>' +
                '</select>' +
                '</div>';
        }

        function onJoinTypeChange(val) {
            qbState.joinType = val;
            schedulePreview();
        }

        function onSortColChange(val) {
            if (!val) {
                qbState.sortBy = null;
            } else {
                var idx = parseInt(val);
                var col = qbState.columns[idx];
                qbState.sortBy = { table: col.table, field: col.field, direction: qbState.sortBy ? qbState.sortBy.direction : 'ASC' };
            }
            renderSort();
        }

        function setSortDir(dir) {
            if (!qbState.sortBy && qbState.columns.length > 0) {
                qbState.sortBy = { table: qbState.columns[0].table, field: qbState.columns[0].field, direction: dir };
            } else if (qbState.sortBy) {
                qbState.sortBy.direction = dir;
            }
            renderSort();
        }

        function setColAggregate(idx, agg) {
            qbState.columns[idx].aggregate = agg || '';
            renderSelectedColumns();
        }

        // Debounced auto-refresh for SQL preview
        var previewTimer = null;
        function schedulePreview() {
            if (qbState.columns.length === 0) return;
            clearTimeout(previewTimer);
            previewTimer = setTimeout(function() {
                previewSqlQuery();
            }, 400);
        }

        function toggleDistinct(checked) {
            qbState.distinct = checked;
            schedulePreview();
        }

        function previewSqlQuery() {
            const name = document.getElementById('queryName').value.trim() || 'preview';
            vscode.postMessage({
                command: 'previewQuerySql',
                queryName: name,
                columns: qbState.columns,
                filters: qbState.filters,
                sortBy: qbState.sortBy,
                limit: qbState.sortLimit,
                groupBy: qbState.groupBy,
                having: qbState.having,
                distinct: qbState.distinct,
                joinType: qbState.joinType
            });
        }

        function onSortLimitChange(val) {
            qbState.sortLimit = val;
        }
        // --- end Sort / Limit ---

        // --- Group By ---
        function renderGroupBy() {
            var container = document.getElementById('groupByCheckboxes');
            if (!container) return;
            schedulePreview();

            if (qbState.columns.length === 0) {
                container.innerHTML = '<span class="qb-no-groupby">Add columns first</span>';
                return;
            }

            container.innerHTML = qbState.columns.map(function(col, idx) {
                var checked = qbState.groupBy.some(function(g) {
                    return g.table === col.table && g.field === col.field;
                });
                var cls = checked ? 'qb-groupby-cb checked' : 'qb-groupby-cb';
                return '<label class="' + cls + '">' +
                    '<input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="toggleGroupBy(' + idx + ', this.checked)" />' +
                    '<span class="qb-cb-table">' + col.table + '</span>.<span class="qb-cb-field">' + col.field + '</span>' +
                    '</label>';
            }).join('');
        }

        function toggleGroupBy(idx, checked) {
            var col = qbState.columns[idx];
            if (checked) {
                if (!qbState.groupBy.some(function(g) { return g.table === col.table && g.field === col.field; })) {
                    qbState.groupBy.push({ table: col.table, field: col.field });
                }
            } else {
                qbState.groupBy = qbState.groupBy.filter(function(g) {
                    return !(g.table === col.table && g.field === col.field);
                });
            }
            renderGroupBy();
            renderHaving();
        }
        // --- end Group By ---

        // --- Having ---
        function renderHaving() {
            var container = document.getElementById('havingRows');
            var addBtn = document.getElementById('addHavingBtn');
            if (!container || !addBtn) return;
            schedulePreview();

            if (qbState.columns.length === 0) {
                container.innerHTML = '';
                addBtn.disabled = true;
                return;
            }

            addBtn.disabled = false;

            if (qbState.having.length === 0) {
                container.innerHTML = '<span class="qb-no-filters">No having conditions — aggregate results unfiltered</span>';
                return;
            }

            var ops = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'BETWEEN', 'IN', 'IS NULL', 'IS NOT NULL'];
            var aggrFunctions = ['', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];

            container.innerHTML = qbState.having.map(function(h, idx) {
                // Column dropdown specific to this having condition
                var colOptions = qbState.columns.map(function(c, ci) {
                    var sel = (c.table === h.table && c.field === h.field) ? ' selected' : '';
                    return '<option value="' + ci + '"' + sel + '>' + c.table + '.' + c.field + '</option>';
                }).join('');

                var aggrOptions = aggrFunctions.map(function(a) {
                    var sel = (a === (h.aggregate || '')) ? ' selected' : '';
                    var label = a || 'None';
                    return '<option value="' + a + '"' + sel + '>' + label + '</option>';
                }).join('');

                var opOptions = ops.map(function(op) {
                    var sel = (op === (h.operator || '=')) ? ' selected' : '';
                    return '<option value="' + op + '"' + sel + '>' + op + '</option>';
                }).join('');

                var valHtml = '';
                if (h.operator !== 'IS NULL' && h.operator !== 'IS NOT NULL') {
                    valHtml = '<input class="qb-filter-val" type="text" value="' + (h.value || '') + '" placeholder="value" onchange="updateHavingVal(' + idx + ', this.value)" />';
                }

                return '<div class="qb-filter-row">' +
                    '<select onchange="updateHavingCol(' + idx + ', this.value)">' + colOptions + '</select>' +
                    '<select class="qb-col-aggr" onchange="setHavingAggregate(' + idx + ', this.value)">' + aggrOptions + '</select>' +
                    '<select class="qb-filter-op" onchange="updateHavingOp(' + idx + ', this.value)">' + opOptions + '</select>' +
                    valHtml +
                    '<button class="btn btn-danger btn-sm" onclick="removeHaving(' + idx + ')" title="Remove having">&times;</button>' +
                    '</div>';
            }).join('');
        }

        function setHavingAggregate(idx, agg) {
            qbState.having[idx].aggregate = agg || '';
            renderHaving();
        }

        function addHaving() {
            if (qbState.columns.length === 0) return;
            qbState.having.push({ table: qbState.columns[0].table, field: qbState.columns[0].field, operator: '=', value: '' });
            renderHaving();
        }

        function removeHaving(idx) {
            qbState.having.splice(idx, 1);
            renderHaving();
        }

        function updateHavingCol(idx, colIdx) {
            var col = qbState.columns[parseInt(colIdx)];
            qbState.having[idx].table = col.table;
            qbState.having[idx].field = col.field;
            renderHaving();
        }

        function updateHavingOp(idx, op) {
            qbState.having[idx].operator = op;
            renderHaving();
        }

        function updateHavingVal(idx, val) {
            qbState.having[idx].value = val;
        }
        // --- end Having ---

        function addFilter() {
            if (qbState.columns.length === 0) return;
            qbState.filters.push({ table: qbState.columns[0].table, field: qbState.columns[0].field, operator: '=', value: '' });
            renderFilters();
        }

        function removeFilter(idx) {
            qbState.filters.splice(idx, 1);
            renderFilters();
        }

        function updateFilterCol(idx, colIdx) {
            var col = qbState.columns[parseInt(colIdx)];
            qbState.filters[idx].table = col.table;
            qbState.filters[idx].field = col.field;
            renderFilters();
        }

        function updateFilterOp(idx, op) {
            qbState.filters[idx].operator = op;
            renderFilters();
        }

        function updateFilterVal(idx, val) {
            qbState.filters[idx].value = val;
        }

        function renderSelectedColumns() {
            const container = document.getElementById('selectedColumns');
            const dropZone = document.getElementById('dropZone');
            const addFilterBtn = document.getElementById('addFilterBtn');
            const previewBtn = document.getElementById('previewSqlBtn');
            if (!container || !dropZone) return;

            if (qbState.columns.length === 0) {
                container.innerHTML = '';
                dropZone.className = 'drop-zone';
                dropZone.innerHTML = 'Drag fields from table cards above';
                document.querySelectorAll('.gen-query-btn').forEach(b => b.disabled = true);
                document.getElementById('saveBtn').disabled = true;
                if (addFilterBtn) addFilterBtn.disabled = true;
                if (previewBtn) previewBtn.disabled = true;            qbState.filters = [];
            qbState.groupBy = [];
            qbState.having = [];
            renderFilters();
            renderSort();
            renderGroupBy();
            renderHaving();
            refreshFieldRowStates();
            return;
        }

        schedulePreview();

        var aggrFunctions = ['', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];

            dropZone.className = 'drop-zone has-items';
            dropZone.innerHTML = qbState.columns.map(function(col, idx) {
                var aggrOptions = aggrFunctions.map(function(a) {
                    var sel = (a === (col.aggregate || '')) ? ' selected' : '';
                    var label = a || 'None';
                    return '<option value="' + a + '"' + sel + '>' + label + '</option>';
                }).join('');
                return '<span class="qb-col">' +
                    '<span class="qb-col-table">' + col.table + '</span>.' +
                    '<select class="qb-col-aggr" onchange="setColAggregate(' + idx + ', this.value)">' + aggrOptions + '</select>' +
                    '<span class="qb-col-field">' + col.field + '</span>' +
                    '<button class="qb-col-remove" onclick="removeColumn(' + idx + ')" title="Remove">&times;</button></span>';
            }).join('');

            var colCount = qbState.columns.length;
            var tableNames = [];
            qbState.columns.forEach(function(c) {
                if (tableNames.indexOf(c.table) === -1) tableNames.push(c.table);
            });
            var tableCount = tableNames.length;
            container.innerHTML = '<div style="font-size:11px;color:#666;margin-top:4px;">' + colCount + ' column' + (colCount !== 1 ? 's' : '') + ' selected from ' + tableCount + ' table' + (tableCount !== 1 ? 's' : '') + '</div>';
            document.querySelectorAll('.gen-query-btn').forEach(b => b.disabled = false);
            document.getElementById('saveBtn').disabled = false;
            if (addFilterBtn) addFilterBtn.disabled = false;
            if (previewBtn) previewBtn.disabled = false;
            renderFilters();
            renderSort();
            renderGroupBy();
            renderHaving();
            refreshFieldRowStates();
        }

        function addColumn(tableName, fieldName) {
            // Avoid duplicates
            if (qbState.columns.some(c => c.table === tableName && c.field === fieldName)) return;
            qbState.columns.push({ table: tableName, field: fieldName });
            renderSelectedColumns();
        }

        function selectAllFields(tableName, event) {
            if (event) event.stopPropagation();
            // Find all field rows for this table and add each field
            var rows = document.querySelectorAll('.field-row[data-table-name="' + tableName + '"]');
            rows.forEach(function(row) {
                var field = row.getAttribute('data-field-name');
                if (!field) return;
                if (qbState.columns.some(function(c) { return c.table === tableName && c.field === field; })) return;
                qbState.columns.push({ table: tableName, field: field });
            });
            renderSelectedColumns();
        }

        function toggleFieldQuery(tableName, fieldName) {
            var idx = qbState.columns.findIndex(function(c) {
                return c.table === tableName && c.field === fieldName;
            });
            if (idx >= 0) {
                removeColumn(idx);
            } else {
                addColumn(tableName, fieldName);
            }
        }

        function refreshFieldRowStates() {
            document.querySelectorAll('.field-row').forEach(function(row) {
                var table = row.getAttribute('data-table-name');
                var field = row.getAttribute('data-field-name');
                var inQuery = qbState.columns.some(function(c) {
                    return c.table === table && c.field === field;
                });
                var cb = row.querySelector('.field-toggle-cb');
                if (cb) cb.checked = inQuery;
                row.classList.toggle('qb-active', inQuery);
            });
        }

        function removeColumn(index) {
            var removed = qbState.columns[index];
            qbState.columns.splice(index, 1);
            // Remove any filters that reference the deleted column
            qbState.filters = qbState.filters.filter(function(f) {
                return !(f.table === removed.table && f.field === removed.field);
            });
            // Clear sortBy if it referenced the deleted column
            if (qbState.sortBy && qbState.sortBy.table === removed.table && qbState.sortBy.field === removed.field) {
                qbState.sortBy = null;
            }
            // Remove from groupBy if it referenced the deleted column
            qbState.groupBy = qbState.groupBy.filter(function(g) {
                return !(g.table === removed.table && g.field === removed.field);
            });
            // Remove any having conditions that reference the deleted column
            qbState.having = qbState.having.filter(function(h) {
                return !(h.table === removed.table && h.field === removed.field);
            });
            renderSelectedColumns();
        }

        function clearQuery() {
            qbState.columns = [];
            qbState.filters = [];
            qbState.sortBy = null;
            qbState.sortLimit = '';
            qbState.groupBy = [];
            qbState.having = [];
            qbState.distinct = false;
            qbState.joinType = 'LEFT';
            document.getElementById('queryName').value = '';
            // Uncheck the DISTINCT toggle visually
            var dt = document.querySelector('.qb-distinct-toggle input');
            if (dt) dt.checked = false;
            // Clear the SQL preview
            var previewTa = document.getElementById('sqlPreview');
            if (previewTa) previewTa.value = '';
            renderSelectedColumns();
            renderFilters();
            renderSort();
            renderGroupBy();
            renderHaving();
            document.getElementById('dropZone').className = 'drop-zone';
        }

        // Listen for messages from the extension (query data, run results, etc.)
        window.addEventListener('message', function(event) {
            const msg = event.data;
            if (msg.command === 'dbFileList') {
                var select = document.getElementById('dbFileSelect');
                if (!select) return;
                var currentVal = select.value;
                var html = '<option value="">— No database selected —</option>';
                if (msg.files && msg.files.length > 0) {
                    msg.files.forEach(function(f) {
                        var sel = (f === msg.selectedPath) ? ' selected' : '';
                        html += '<option value="' + f.replace(/'/g, "\\'") + '"' + sel + '>' + f + '</option>';
                    });
                } else {
                    html += '<option value="" disabled>No .db files found in workspace</option>';
                }
                select.innerHTML = html;
                if (msg.selectedPath) {
                    selectedDbPath = msg.selectedPath;
                }
            } else if (msg.command === 'queryRunning') {
                var resultsDiv = document.getElementById('queryResults');
                if (resultsDiv) resultsDiv.innerHTML = '<div class="qb-results-running">Running query...</div>';
            } else if (msg.command === 'queryResult') {
                var resultsDiv = document.getElementById('queryResults');
                if (!resultsDiv) return;
                if (!msg.success) {
                    resultsDiv.innerHTML = '<div class="qb-results-error">' + (msg.error || 'Unknown error') + '</div>';
                } else {
                    var html = '';
                    html += '<div class="qb-results-info">';
                    html += '<span class="result-ok">&#x2713; Query executed</span>';
                    html += '<span class="qb-results-count">' + (msg.rowCount || 0) + ' row' + (msg.rowCount !== 1 ? 's' : '') + ' returned</span>';
                    html += '</div>';
                    if (msg.results && msg.results.length > 0 && msg.results[0].columns.length > 0) {
                        html += '<div class="qb-results-table-wrap"><table class="qb-results-table">';
                        html += '<thead><tr>';
                        msg.results[0].columns.forEach(function(col) {
                            html += '<th>' + col + '</th>';
                        });
                        html += '</tr></thead><tbody>';
                        msg.results[0].rows.forEach(function(row) {
                            html += '<tr>';
                            msg.results[0].columns.forEach(function(col) {
                                var val = row[col];
                                if (val === null || val === undefined) {
                                    html += '<td><span style="color:#666;font-style:italic;">NULL</span></td>';
                                } else {
                                    var escaped = String(val).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                                    html += '<td>' + escaped + '</td>';
                                }
                            });
                            html += '</tr>';
                        });
                        html += '</tbody></table></div>';
                    } else {
                        html += '<div class="qb-results-empty">Query executed successfully (no result rows)</div>';
                    }
                    resultsDiv.innerHTML = html;
                }
            } else if (msg.command === 'queryLoaded') {
                qbState.columns = msg.columns || [];
                qbState.filters = msg.filters || [];
                qbState.sortBy = msg.sortBy || null;
                qbState.sortLimit = msg.limit || '';
                qbState.groupBy = msg.groupBy || [];
                qbState.having = msg.having || [];
                qbState.distinct = !!msg.distinct;
                qbState.joinType = msg.joinType || 'LEFT';
                document.getElementById('queryName').value = msg.queryName || '';
                // Sync the DISTINCT checkbox
                    var dt = document.querySelector('.qb-distinct-toggle input');
                if (dt) dt.checked = qbState.distinct;
                renderSelectedColumns();
                renderSort();
                renderGroupBy();
                renderHaving();
            } else if (msg.command === 'sqlPreviewResult') {
                var ta = document.getElementById('sqlPreview');
                if (ta) ta.value = msg.sql || '-- No SQL generated';
            } else if (msg.command === 'authFieldsReceived') {
                renderAuthFields(msg.table, msg.suggestedIdentity || [], msg.suggestedPassword || null, msg.suggestedStatus || null);
            } else if (msg.command === 'authPreviewResult') {
                var authTa = document.getElementById('authPreview');
                if (authTa) authTa.value = msg.code || '// No code generated';
            }
        });

        // Drop zone handlers
        document.addEventListener('DOMContentLoaded', function() {
            // Auto-populate database file list
            findDbFiles();

            const dropZone = document.getElementById('dropZone');
            if (!dropZone) return;

            dropZone.addEventListener('dragover', function(e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                this.classList.add('drag-over');
            });

            dropZone.addEventListener('dragleave', function(e) {
                e.preventDefault();
                this.classList.remove('drag-over');
            });

            dropZone.addEventListener('drop', function(e) {
                e.preventDefault();
                this.classList.remove('drag-over');
                try {
                    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                    if (data.table && data.field) {
                        addColumn(data.table, data.field);
                    }
                } catch (err) {
                    // Invalid drag data
                }
            });
        });

        // Saved queries
        function loadSavedQueries() {
            vscode.postMessage({ command: 'getQueries' });
        }

        function loadSavedQuery(name) {
            vscode.postMessage({ command: 'loadQuery', queryName: name });
        }

        function saveQuery() {
            const name = document.getElementById('queryName').value.trim();
            if (!name) {
                document.getElementById('queryName').focus();
                document.getElementById('queryName').style.borderColor = '#c03131';
                setTimeout(() => document.getElementById('queryName').style.borderColor = '', 1500);
                return;
            }
            if (qbState.columns.length === 0) return;
            vscode.postMessage({
                command: 'saveQuery',
                queryName: name,
                columns: qbState.columns,
                filters: qbState.filters,
                sortBy: qbState.sortBy,
                limit: qbState.sortLimit,
                groupBy: qbState.groupBy,
                having: qbState.having,
                distinct: qbState.distinct,
                joinType: qbState.joinType
            });
        }

        function generateQuery(type) {
            const name = document.getElementById('queryName').value.trim() || 'customQuery';
            if (qbState.columns.length === 0) return;
            vscode.postMessage({
                command: 'generateQuery',
                queryName: name,
                columns: qbState.columns,
                filters: qbState.filters,
                sortBy: qbState.sortBy,
                limit: qbState.sortLimit,
                groupBy: qbState.groupBy,
                having: qbState.having,
                distinct: qbState.distinct,
                joinType: qbState.joinType,
                type: type || 'all'
            });
        }

        function copySqlPreview() {
            var ta = document.getElementById('sqlPreview');
            if (!ta || !ta.value) return;
            navigator.clipboard.writeText(ta.value).then(function() {
                var btn = document.getElementById('copySqlBtn');
                if (!btn) return;
                var orig = btn.textContent;
                btn.textContent = 'Copied!';
                btn.style.background = '#0d7a3e';
                btn.style.color = '#fff';
                setTimeout(function() {
                    btn.textContent = orig;
                    btn.style.background = '';
                    btn.style.color = '';
                }, 1500);
            }).catch(function() {
                // Fallback: select the text
                ta.select();
            });
        }

        function removeQuery(name, event) {
            if (event) event.stopPropagation();
            vscode.postMessage({ command: 'removeQuery', queryName: name });
        }

        // --- DB Runner ---
        var selectedDbPath = '';

        function findDbFiles() {
            vscode.postMessage({ command: 'findDbFiles' });
        }

        function onDbFileChange(path) {
            selectedDbPath = path;
            vscode.postMessage({ command: 'selectDb', dbPath: path });
        }

        function runSqlQuery() {
            var ta = document.getElementById('sqlPreview');
            if (!ta || !ta.value) return;
            if (!selectedDbPath) {
                var results = document.getElementById('queryResults');
                if (results) results.innerHTML = '<div class="qb-results-error">Select a database file first.</div>';
                return;
            }
            vscode.postMessage({ command: 'runQuery', sql: ta.value });
        }
        // --- end DB Runner ---

        // --- Tab Navigation ---
        function switchTab(tabName) {
            document.querySelectorAll('.tab-content').forEach(function(el) {
                el.classList.remove('tab-active');
            });
            document.querySelectorAll('.tab-btn').forEach(function(el) {
                el.classList.remove('tab-active');
            });
            var tabId = 'tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1) + 'Content';
            var btnId = 'tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1);
            var tabEl = document.getElementById(tabId);
            var btnEl = document.getElementById(btnId);
            if (tabEl) tabEl.classList.add('tab-active');
            if (btnEl) btnEl.classList.add('tab-active');
        }

        // --- Auth Generator ---
        var authState = { table: null, identityFields: [], passwordField: null, statusField: null };

        function onAuthTableChange(tableName) {
            if (!tableName) {
                disableAuthSections();
                authState.table = null;
                return;
            }
            authState.table = tableName;
            vscode.postMessage({ command: 'getAuthTableFields', tableName: tableName });
        }

        function disableAuthSections() {
            ['authIdentitySection','authPasswordSection','authStatusSection','authOptionsSection'].forEach(function(id) {
                var el = document.getElementById(id);
                if (el) { el.style.opacity = '0.4'; el.style.pointerEvents = 'none'; }
            });
            document.getElementById('authGenBtn').disabled = true;
            document.getElementById('authPrevBtn').disabled = true;
        }

        function enableAuthSections() {
            ['authIdentitySection','authPasswordSection','authStatusSection','authOptionsSection'].forEach(function(id) {
                var el = document.getElementById(id);
                if (el) { el.style.opacity = '1'; el.style.pointerEvents = 'auto'; }
            });
        }

        function renderAuthFields(table, suggestedIdentity, suggestedPassword, suggestedStatus) {
            enableAuthSections();

            // Render identity field checkboxes
            var container = document.getElementById('authIdentityFields');
            if (!container) return;
            authState.identityFields = [];
            container.innerHTML = table.fields.map(function(f) {
                if (f.name === suggestedPassword) return '';
                var isSuggested = suggestedIdentity.indexOf(f.name) >= 0;
                if (isSuggested) authState.identityFields.push(f.name);
                var checked = isSuggested ? ' checked' : '';
                var cls = isSuggested ? 'auth-field-cb checked' : 'auth-field-cb';
                var typeLabel = f.type || 'TEXT';
                var safeName = f.name.replace(/'/g, "\\'");
                return '<label class="' + cls + '">' +
                    '<input type="checkbox" ' + checked + ' onchange="toggleAuthIdentityField(\'' + safeName + '\', this.checked)" />' +
                    '<span>' + f.name + '</span>' +
                    '<span class="auth-cb-type">(' + typeLabel + ')</span>' +
                    '</label>';
            }).filter(Boolean).join('') || '<span class="auth-no-fields">No fields available</span>';

            // Render password dropdown
            var pwSelect = document.getElementById('authPasswordSelect');
            if (pwSelect) {
                pwSelect.innerHTML = '<option value="">— Select password field —</option>' +
                    table.fields.map(function(f) {
                        var sel = (f.name === suggestedPassword) ? ' selected' : '';
                        return '<option value="' + f.name.replace(/'/g, "\\'") + '"' + sel + '>' + f.name + ' (' + (f.type || 'TEXT') + ')</option>';
                    }).join('');
                authState.passwordField = suggestedPassword;
            }

            // Render status dropdown
            var statSelect = document.getElementById('authStatusSelect');
            if (statSelect) {
                statSelect.innerHTML = '<option value="">— None (skip status check) —</option>' +
                    table.fields.map(function(f) {
                        var sel = (f.name === suggestedStatus) ? ' selected' : '';
                        return '<option value="' + f.name.replace(/'/g, "\\'") + '"' + sel + '>' + f.name + ' (' + (f.type || 'TEXT') + ')</option>';
                    }).join('');
                authState.statusField = suggestedStatus;
            }

            updateAuthGenBtn();
        }

        function toggleAuthIdentityField(fieldName, checked) {
            if (checked) {
                if (authState.identityFields.indexOf(fieldName) < 0) {
                    authState.identityFields.push(fieldName);
                }
            } else {
                authState.identityFields = authState.identityFields.filter(function(f) { return f !== fieldName; });
            }
            // Update visual state
            document.querySelectorAll('#authIdentityFields .auth-field-cb').forEach(function(lbl) {
                var cb = lbl.querySelector('input[type="checkbox"]');
                var name = '';
                if (cb) {
                    var match = cb.getAttribute('onchange').match(/toggleAuthIdentityField\('([^']+)'/);
                    if (match) name = match[1];
                }
                lbl.classList.toggle('checked', authState.identityFields.indexOf(name) >= 0);
            });
            updateAuthGenBtn();
        }

        function onAuthOptionChange() {
            updateAuthGenBtn();
        }

        function updateAuthGenBtn() {
            var hasIdentity = authState.identityFields.length > 0;
            var hasPassword = !!authState.passwordField;
            var hasRoute = document.getElementById('authOptRoute') ? document.getElementById('authOptRoute').checked : false;
            var hasRegister = document.getElementById('authOptRegister') ? document.getElementById('authOptRegister').checked : false;
            var hasHtml = document.getElementById('authOptHtml') ? document.getElementById('authOptHtml').checked : false;
            var enabled = authState.table && hasIdentity && hasPassword && (hasRoute || hasRegister || hasHtml);
            var genBtn = document.getElementById('authGenBtn');
            var prevBtn = document.getElementById('authPrevBtn');
            if (genBtn) genBtn.disabled = !enabled;
            if (prevBtn) prevBtn.disabled = !enabled;
        }

        function generateAuth() {
            if (!authState.table || authState.identityFields.length === 0 || !authState.passwordField) return;
            var genRoute = document.getElementById('authOptRoute') ? document.getElementById('authOptRoute').checked : true;
            var genRegister = document.getElementById('authOptRegister') ? document.getElementById('authOptRegister').checked : false;
            var genHtml = document.getElementById('authOptHtml') ? document.getElementById('authOptHtml').checked : true;
            var useJwt = document.getElementById('authOptJwt') ? document.getElementById('authOptJwt').checked : true;
            vscode.postMessage({
                command: 'generateAuth',
                tableName: authState.table,
                identityFields: authState.identityFields,
                passwordField: authState.passwordField,
                statusField: authState.statusField || null,
                options: {
                    useJwt: useJwt,
                    generateRoute: genRoute,
                    generateRegister: genRegister,
                    generateHtml: genHtml
                }
            });
        }

        function previewAuthSql() {
            if (!authState.table || authState.identityFields.length === 0 || !authState.passwordField) return;
            vscode.postMessage({
                command: 'previewAuthSql',
                tableName: authState.table,
                identityFields: authState.identityFields,
                passwordField: authState.passwordField,
                statusField: authState.statusField || null
            });
        }

        function clearAuth() {
            var tableSelect = document.getElementById('authTableSelect');
            if (tableSelect) tableSelect.value = '';
            var idFields = document.getElementById('authIdentityFields');
            if (idFields) idFields.innerHTML = '<span class="auth-no-fields">Select a table first</span>';
            var pwSelect = document.getElementById('authPasswordSelect');
            if (pwSelect) pwSelect.innerHTML = '<option value="">— Select password field —</option>';
            var statSelect = document.getElementById('authStatusSelect');
            if (statSelect) statSelect.innerHTML = '<option value="">— None (skip status check) —</option>';
            var preview = document.getElementById('authPreview');
            if (preview) preview.value = '';
            disableAuthSections();
            authState.table = null;
            authState.identityFields = [];
            authState.passwordField = null;
            authState.statusField = null;
        }

        function copyAuthPreview() {
            var ta = document.getElementById('authPreview');
            if (!ta || !ta.value) return;
            navigator.clipboard.writeText(ta.value).then(function() {
                var btn = document.getElementById('copyAuthBtn');
                if (!btn) return;
                var orig = btn.textContent;
                btn.textContent = 'Copied!';
                btn.style.background = '#0d7a3e';
                btn.style.color = '#fff';
                setTimeout(function() {
                    btn.textContent = orig;
                    btn.style.background = '';
                    btn.style.color = '';
                }, 1500);
            }).catch(function() {
                ta.select();
            });
        }
        // --- end Auth Generator ---

        function toggleHelp(event) {
            if (event) event.stopPropagation();
            const content = document.getElementById('helpContent');
            const btn = document.querySelector('.help-toggle');
            if (!content || !btn) return;
            content.classList.toggle('hidden');
            btn.innerHTML = '<span class="arrow">' + (content.classList.contains('hidden') ? '\u25B6' : '\u25BC') + '</span> ' + (content.classList.contains('hidden') ? 'Show' : 'Hide');
        }

        
        // --- Quick App Generator ---
        var qsTables = [];
        // Initialize qsTables with all pre-checked tables on page load
        try {
            var qsCbs = document.querySelectorAll('#qsTableList input[type="checkbox"]');
            if (qsCbs && qsCbs.length > 0) {
                qsCbs.forEach(function(cb) {
                    var onchange = cb.getAttribute('onchange') || '';
                    var m = onchange.match(/onQsTableToggle\('([^']+)'/);
                    if (m) qsTables.push(m[1]);
                });
            }
        } catch(e) {
            // Silently handle init error
        }
        updateQsBtn();

        function onQsTableToggle(name, checked) {

            if (checked) {
                if (qsTables.indexOf(name) < 0) qsTables.push(name);
            } else {
                qsTables = qsTables.filter(function(t) { return t !== name; });
            }
            updateQsBtn();
        }

        function onQsOptionChange() {
            updateQsBtn();
        }

        function onQsAuthToggle(checked) {
            updateQsBtn();
        }

        function updateQsBtn() {
            var tablesSelected = qsTables.length > 0;
            var hasRoute = document.getElementById('qsOptCrud') ? document.getElementById('qsOptCrud').checked : false;
            var hasCreate = document.getElementById('qsOptCreateTable') ? document.getElementById('qsOptCreateTable').checked : false;
            var hasPage = document.getElementById('qsOptPage') ? document.getElementById('qsOptPage').checked : false;
            var enabled = tablesSelected && (hasRoute || hasCreate || hasPage);
            var btn = document.getElementById('qsGenBtn');
            if (btn) btn.disabled = !enabled;
        }

        function generateApp() {
            var tablesList = [];
            // Collect checked tables
            document.querySelectorAll('#qsTableList .auth-field-cb input[type="checkbox"]').forEach(function(cb) {
                var onclick = cb.getAttribute('onchange') || '';
                var match = onclick.match(/onQsTableToggle\('([^']+)'/);
                if (match && cb.checked) tablesList.push(match[1]);
            });
            if (tablesList.length === 0) return;
            var crud = document.getElementById('qsOptCrud') ? document.getElementById('qsOptCrud').checked : false;
            var createTable = document.getElementById('qsOptCreateTable') ? document.getElementById('qsOptCreateTable').checked : false;
            var page = document.getElementById('qsOptPage') ? document.getElementById('qsOptPage').checked : false;
            var boilerplate = document.getElementById('qsOptBoilerplate') ? document.getElementById('qsOptBoilerplate').checked : false;
            var includeAuth = document.getElementById('qsEnableAuth') ? document.getElementById('qsEnableAuth').checked : false;

            var authConfig = null;
            if (includeAuth && window.authState && window.authState.table) {
                authConfig = {
                    tableName: window.authState.table,
                    identityFields: window.authState.identityFields,
                    passwordField: window.authState.passwordField,
                    statusField: window.authState.statusField || null,
                    useJwt: true,
                    generateRoute: true,
                    generateHtml: true
                };
            }

            vscode.postMessage({
                command: 'generateApp',
                tableConfigs: tablesList.map(function(t) {
                    return { tableName: t, crud: crud, createTable: createTable, page: page, list: false, form: false };
                }),
                authConfig: authConfig,
                options: {
                    includeServerBoilerplate: boilerplate,
                    includeHtmlBoilerplate: boilerplate
                }
            });
        }

        function clearQs() {
            document.querySelectorAll('#qsTableList input[type="checkbox"]').forEach(function(cb) {
                cb.checked = true;
            });
            document.getElementById('qsEnableAuth').checked = false;
            // Re-init qsTables
            qsTables = [];
            document.querySelectorAll('#qsTableList .auth-field-cb').forEach(function(lbl) {
                var match = lbl.querySelector('input') ? (lbl.querySelector('input').getAttribute('onchange') || '').match(/onQsTableToggle\('([^']+)'/) : null;
                if (match) qsTables.push(match[1]);
                lbl.classList.add('checked');
                lbl.style.borderColor = '#4fc3f7';
                lbl.style.background = '#0d2a2a';
                lbl.style.color = '#8cf';
            });
            updateQsBtn();
        }
        // --- end Quick App Generator ---

        function editField(tableName, fieldName, event) {
            if (event) event.stopPropagation();
            vscode.postMessage({ command: 'editField', tableName, fieldName });
        }

        function previewSql(tableName, event) {
            if (event) event.stopPropagation();
            vscode.postMessage({ command: 'previewSql', tableName });
        }

    </script>
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
