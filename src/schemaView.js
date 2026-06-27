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

    _svgSettingsIcon() {
        return `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" style="vertical-align:middle">
            <circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.3"/>
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.5 2.5l1.5 1.5M12 12l1.5 1.5M2.5 13.5l1.5-1.5M12 4l1.5-1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
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

    _svgSqlIcon() {
        return `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" style="vertical-align:middle">
            <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.3"/>
            <path d="M4 6h8M4 9h5M4 12h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
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
                        this._handlePreviewAuthSql(msg.tableName, msg.identityFields, msg.passwordField, msg.statusField, msg.useBcrypt, msg.options);
                        break;
                    case 'addRule':
                        await this._handleAddRule(msg.rule);
                        break;
                    case 'removeRule':
                        await this._handleRemoveRule(msg.ruleIndex);
                        break;
                    case 'updateRule':
                        await this._handleUpdateRule(msg.ruleIndex, msg.rule);
                        break;
                    case 'previewRules':
                        this._handlePreviewRules();
                        break;
                    case 'generateRules':
                        await this._handleGenerateRules();
                        break;
                    case 'generateApp':
                        await this._handleGenerateApp(msg.tableConfigs, msg.authConfig, msg.options, msg.includeRules);
                        break;
                    case 'addActionRoute':
                        await this._handleAddActionRoute(msg.route);
                        break;
                    case 'removeActionRoute':
                        await this._handleRemoveActionRoute(msg.routeIndex);
                        break;
                    case 'previewActionRoute':
                        this._handlePreviewActionRoute(msg.route);
                        break;
                    case 'generateActionRoute':
                        await this._handleGenerateActionRoute(msg.route);
                        break;
                    case 'getTableSettings':
                        this._handleGetTableSettings(msg.tableName);
                        break;
                    case 'setTableSettings':
                        await this._handleSetTableSettings(msg.tableName, msg.settings);
                        break;
                    case 'setFieldUiType':
                        await this._handleSetFieldUiType(msg.tableName, msg.fieldName, msg.uiType);
                        break;
                    case 'extractSchemaSql':
                        this._handleExtractSchemaSql();
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

    _handleExtractSchemaSql() {
        const tables = this.schemaRegistry.getTables();
        if (!tables.length) {
            vscode.window.showErrorMessage('njs: No tables registered');
            return;
        }

        const gen = this.generator || new CodeGenerator(this.schemaRegistry);
        const sqlParts = [];
        for (const tableName of tables) {
            const jsCode = gen.generateCreateTable(tableName);
            if (!jsCode || jsCode === '// Table not found') continue;
            const match = jsCode.match(/db\.exec\(`([\s\S]*?)`\)/);
            if (match) {
                sqlParts.push(match[1].trim().replace(/;$/, '') + ';');
            }
        }

        if (!sqlParts.length) {
            vscode.window.showErrorMessage('njs: Failed to extract schema');
            return;
        }

        const header = `-- Schema extracted from ${tables.length} table(s)\n-- Generated by Express Full-Stack Snippets\n\n`;
        vscode.env.clipboard.writeText(header + sqlParts.join('\n\n'));
        vscode.window.showInformationMessage(`njs: Schema SQL for ${tables.length} tables copied to clipboard`);
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

    _handleGetTableSettings(tableName) {
        if (!this._panel) return;
        const settings = this.schemaRegistry.getTableSettings(tableName);
        const table = this.schemaRegistry.getTable(tableName);
        this._panel.webview.postMessage({
            command: 'tableSettingsReceived',
            tableName,
            settings: settings || {},
            fields: table ? table.fields : []
        });
    }

    async _handleSetTableSettings(tableName, settings) {
        try {
            await this.schemaRegistry.setTableSettings(tableName, settings);
            vscode.window.showInformationMessage(`njs: Settings saved for "${tableName}"`);
            this._refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    async _handleSetFieldUiType(tableName, fieldName, uiType) {
        try {
            const table = this.schemaRegistry.getTable(tableName);
            if (!table) throw new Error(`Table "${tableName}" not found`);
            const field = table.fields.find(f => f.name === fieldName);
            if (!field) throw new Error(`Field "${fieldName}" not found`);
            if (uiType && uiType !== 'auto') {
                field.uiType = uiType;
            } else {
                delete field.uiType;
            }
            await this.schemaRegistry.save();
            this._refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
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
            tableName: tableName,
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

        // --- Resolve what the user actually asked for (defaults match the UI) ---
        const opts = options || {};
        const useJwt = opts.useJwt !== false;          // default ON
        const useBcrypt = opts.useBcrypt !== false;     // default ON
        const useRefreshToken = opts.useRefreshToken !== false;   // default ON
        const useRateLimiter = opts.useRateLimiter !== false;     // default ON
        const secretStorage = opts.secretStorage || 'env';          // 'env' or 'config'
        const dbStorage = opts.dbStorage || 'server';               // 'server', 'env', or 'config'
        const genLoginRoute = opts.generateRoute !== false;        // default ON
        const genRegisterRoute = !!opts.generateRegister;          // default OFF
        const genLoginHtml = opts.generateHtml !== false;          // default ON
        const genRegisterHtml = !!opts.generateRegisterHtml;       // default OFF
        const genLogoutRequested = !!opts.generateLogout;          // default OFF

        const baseOpts = { useJwt, useBcrypt, useRefreshToken, useRateLimiter, secretStorage, dbStorage };

        // --- Dependency resolution so generated code is always self-consistent ---
        // Any server route that signs/verifies JWT needs middleware + .env/config
        const hasServerRoute = genLoginRoute || genRegisterRoute;
        const genLogout = genLogoutRequested;
        const genMiddleware = useJwt && (hasServerRoute || genLogout);
        const envNeededForJwt = useJwt && secretStorage === 'env';
        const envNeededForDb = dbStorage === 'env';
        const genEnv = envNeededForJwt || envNeededForDb;
        // HTML forms use auth.js (token storage + refresh) when JWT is on.
        // When JWT is off, the forms are self-contained (inline fetch).
        const hasAnyHtml = genLoginHtml || genRegisterHtml;
        const genAuthJs = useJwt && hasAnyHtml;
        const useAuthJs = genAuthJs; // tells HTML whether auth.js is present
        const genAuthClientJsOpts = { ...baseOpts, generateLogout: genLogout, generateRegister: genRegisterRoute };

        let allCode = '';

        // 1. Server: login route
        if (genLoginRoute) {
            allCode += authGen.generateLogin(tableName, identityFields, passwordField, statusField, baseOpts);
            allCode += '\n\n';
        }
        // 2. Server: register route
        if (genRegisterRoute) {
            const registerFields = this.schemaRegistry.getTable(tableName);
            const allFields = registerFields ? registerFields.fields.map(f => f.name) : [];
            allCode += authGen.generateRegister(tableName, allFields, passwordField, { ...baseOpts, identityFields });
            allCode += '\n\n';
        }
        // 3. Server: logout route (standalone, no JWT required)
        if (genLogout) {
            allCode += authGen.generateLogout(baseOpts);
            allCode += '\n\n';
        }
        // 4. Server: middleware (authenticate, refresh, rate limiter)
        if (genMiddleware) {
            allCode += authGen.generateAuthMiddleware(tableName, identityFields, baseOpts);
            allCode += '\n\n';
        }
        // 5. Config files (.env and/or config.js) — only when actually needed
        const genConfigJs = secretStorage === 'config' || dbStorage === 'config';
        if (genEnv) {
            allCode += authGen.generateEnvContent(tableName, baseOpts);
            allCode += '\n\n';
        }
        if (genConfigJs) {
            allCode += authGen.generateConfigJs(baseOpts);
            allCode += '\n\n';
        }
        // 6. Client: auth.js (only when HTML + JWT — the HTML depends on it)
        if (genAuthJs) {
            allCode += authGen.generateAuthClientJs(genAuthClientJsOpts);
            allCode += '\n\n';
        }
        // 7. Setup guide (always — adapts to list only what was generated)
        allCode += authGen.generateSetupGuide(tableName, identityFields, passwordField, {
            ...baseOpts,
            generateRoute: genLoginRoute,
            generateRegister: genRegisterRoute,
            generateLogout: genLogout,
            generateHtml: genLoginHtml,
            generateRegisterHtml: genRegisterHtml,
            useAuthJs
        });
        allCode += '\n\n';
        // 8. HTML: login form (self-contained if no auth.js)
        if (genLoginHtml) {
            allCode += authGen.generateLoginFormHtml(tableName, identityFields, passwordField, { ...baseOpts, useAuthJs });
            allCode += '\n\n';
        }
        // 9. HTML: register form (self-contained if no auth.js)
        if (genRegisterHtml) {
            allCode += authGen.generateRegisterFormHtml(tableName, passwordField, { ...baseOpts, useAuthJs });
            allCode += '\n\n';
        }

        if (!allCode.trim()) {
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

    _handlePreviewAuthSql(tableName, identityFields, passwordField, statusField, useBcrypt, options) {
        if (!this._panel) return;
        const { AuthGenerator } = require('./authGenerator');
        const authGen = new AuthGenerator(this.schemaRegistry);
        const opts = options || {};
        const useJwt = opts.useJwt !== false;
        const useBcryptVal = useBcrypt !== false;
        const useRefreshToken = opts.useRefreshToken !== false;
        const useRateLimiter = opts.useRateLimiter !== false;
        const secretStorage = opts.secretStorage || 'env';
        const dbStorage = opts.dbStorage || 'server';
        const baseOpts = { useJwt, useBcrypt: useBcryptVal, useRefreshToken, useRateLimiter, secretStorage, dbStorage };

        // Preview respects the same checkboxes as Generate, so what you see == what you get.
        const genLoginRoute = opts.generateRoute !== false;
        const genRegisterRoute = !!opts.generateRegister;
        const genLoginHtml = opts.generateHtml !== false;
        const genRegisterHtml = !!opts.generateRegisterHtml;
        const genLogoutRequested = !!opts.generateLogout;
        const hasServerRoute = genLoginRoute || genRegisterRoute;
        const genLogout = genLogoutRequested;
        const hasAnyRoute = hasServerRoute || genLogout;
        const envNeededForJwt = useJwt && secretStorage === 'env';
        const envNeededForDb = dbStorage === 'env';
        const genEnv = envNeededForJwt || envNeededForDb;
        const genConfigJs = secretStorage === 'config' || dbStorage === 'config';
        const hasAnyHtml = genLoginHtml || genRegisterHtml;
        const genAuthJs = useJwt && hasAnyHtml;
        const useAuthJs = genAuthJs;
        const genAuthClientJsOpts = { ...baseOpts, generateLogout: genLogout, generateRegister: genRegisterRoute };

        const registerFields = this.schemaRegistry.getTable(tableName);
        const allFields = registerFields ? registerFields.fields.map(f => f.name) : [];

        let fullCode = '';
        if (genLoginRoute) {
            fullCode += authGen.generateLogin(tableName, identityFields, passwordField, statusField, baseOpts) + '\n\n';
        }
        if (genRegisterRoute) {
            fullCode += authGen.generateRegister(tableName, allFields, passwordField, { ...baseOpts, identityFields }) + '\n\n';
        }
        if (genLogout) {
            fullCode += authGen.generateLogout(baseOpts) + '\n\n';
        }
        if (useJwt && hasAnyRoute) {
            fullCode += authGen.generateAuthMiddleware(tableName, identityFields, baseOpts) + '\n\n';
        }
        if (genEnv) {
            fullCode += authGen.generateEnvContent(tableName, baseOpts) + '\n\n';
        }
        if (genConfigJs) {
            fullCode += authGen.generateConfigJs(baseOpts) + '\n\n';
        }
        if (genAuthJs) {
            fullCode += authGen.generateAuthClientJs(genAuthClientJsOpts) + '\n\n';
        }
        fullCode += authGen.generateSetupGuide(tableName, identityFields, passwordField, {
            ...baseOpts,
            generateRoute: genLoginRoute,
            generateRegister: genRegisterRoute,
            generateLogout: genLogout,
            generateHtml: genLoginHtml,
            generateRegisterHtml: genRegisterHtml,
            useAuthJs
        });
        if (genLoginHtml) {
            fullCode += '\n\n' + authGen.generateLoginFormHtml(tableName, identityFields, passwordField, { ...baseOpts, useAuthJs });
        }
        if (genRegisterHtml) {
            fullCode += '\n\n' + authGen.generateRegisterFormHtml(tableName, passwordField, { ...baseOpts, useAuthJs });
        }

        this._panel.webview.postMessage({
            command: 'authPreviewResult',
            code: fullCode
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

    async _handleGenerateApp(tableConfigs, authConfig, options, includeRules) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('njs: Open a file first to insert generated code');
            return;
        }
        const { AppGenerator } = require('./appGenerator');
        const appGen = new AppGenerator(this.schemaRegistry);
        const result = appGen.generateApp(tableConfigs, authConfig, options || {});
        let allCode = result.server;
        if (includeRules) {
            const rules = this.schemaRegistry.getRules();
            if (rules.length > 0) {
                const { RuleEngine } = require('./ruleEngine');
                const engine = new RuleEngine(this.schemaRegistry);
                allCode += '\n\n' + engine.generateAll(rules, []);
            }
        }
        if (result.html) allCode += '\n\n' + result.html;
        if (result.js) allCode += '\n\n' + result.js;
        try {
            const edit = new vscode.WorkspaceEdit();
            edit.insert(editor.document.uri, editor.selection.active, allCode);
            const success = await vscode.workspace.applyEdit(edit);
            if (success) {
                const tableCount = tableConfigs ? tableConfigs.length : 0;
                const extras = [];
                if (authConfig) extras.push('Auth');
                if (includeRules) extras.push('Rules');
                const label = extras.length > 0 ? ' with ' + extras.join(' + ') : '';
                vscode.window.showInformationMessage(`njs: Generated app code for ${tableCount} tables${label}`);
            }
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    async _handleAddRule(rule) {
        try {
            await this.schemaRegistry.addRule(rule);
            vscode.window.showInformationMessage(`njs: Rule added (${rule.type})`);
            this._refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    async _handleRemoveRule(ruleIndex) {
        try {
            await this.schemaRegistry.removeRule(ruleIndex);
            vscode.window.showInformationMessage('njs: Rule removed');
            this._refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    async _handleUpdateRule(ruleIndex, rule) {
        try {
            await this.schemaRegistry.updateRule(ruleIndex, rule);
            vscode.window.showInformationMessage('njs: Rule updated');
            this._refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    _handlePreviewRules() {
        if (!this._panel) return;
        const rules = this.schemaRegistry.getRules();
        const { RuleEngine } = require('./ruleEngine');
        const engine = new RuleEngine(this.schemaRegistry);
        let code = '';
        if (rules.length === 0) {
            code = '// No business rules defined yet.\n// Add rules using the form above.';
        } else {
            code = engine.generateAll(rules, []);
        }
        this._panel.webview.postMessage({ command: 'rulesPreviewResult', code });
    }

    async _handleGenerateRules() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('njs: Open a file first to insert generated code');
            return;
        }
        const rules = this.schemaRegistry.getRules();
        if (rules.length === 0) {
            vscode.window.showErrorMessage('njs: No rules defined');
            return;
        }
        const { RuleEngine } = require('./ruleEngine');
        const engine = new RuleEngine(this.schemaRegistry);
        const code = engine.generateAll(rules, []);

        try {
            const edit = new vscode.WorkspaceEdit();
            edit.insert(editor.document.uri, editor.selection.active, code);
            const success = await vscode.workspace.applyEdit(edit);
            if (success) {
                vscode.window.showInformationMessage(`njs: Generated ${rules.length} business rules`);
            } else {
                vscode.window.showErrorMessage('njs: Failed to insert code - try clicking in the editor first');
            }
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    async _handleAddActionRoute(route) {
        try {
            await this.schemaRegistry.addActionRoute(route);
            vscode.window.showInformationMessage(`njs: Action route "${route.name}" added`);
            this._refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    async _handleRemoveActionRoute(routeIndex) {
        try {
            await this.schemaRegistry.removeActionRoute(routeIndex);
            vscode.window.showInformationMessage('njs: Action route removed');
            this._refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    _handlePreviewActionRoute(route) {
        if (!this._panel) return;
        const code = this._generateActionCode(route);
        this._panel.webview.postMessage({ command: 'actionRoutePreviewResult', code });
    }

    async _handleGenerateActionRoute(route) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('njs: Open a file first to insert generated code');
            return;
        }
        const code = this._generateActionCode(route);
        try {
            const edit = new vscode.WorkspaceEdit();
            edit.insert(editor.document.uri, editor.selection.active, code);
            const success = await vscode.workspace.applyEdit(edit);
            if (success) {
                vscode.window.showInformationMessage(`njs: Generated action route "${route.name}"`);
            } else {
                vscode.window.showErrorMessage('njs: Failed to insert code - try clicking in the editor first');
            }
        } catch (err) {
            vscode.window.showErrorMessage(`njs: ${err.message}`);
        }
    }

    _generateActionCode(route) {
        if (!route || !route.name || !route.targetTable) {
            return '// Error: Route name and target table are required';
        }

        const routePath = `/api/${route.name}`;
        const method = (route.method || 'POST').toLowerCase();
        const targetTable = route.targetTable;
        const table = this.schemaRegistry.getTable(targetTable);
        if (!table) return `// Error: Table "${targetTable}" not found`;

        const pk = table.fields.find(f => f.pk);
        const pkName = pk ? pk.name : 'id';

        // Find the field that stores the user identity (e.g., voterID, customerID)
        const identityField = route.identityField || '';

        // Find non-PK fields for the insert
        const insertFields = table.fields.filter(f => !f.pk);
        const insertFieldNames = insertFields.map(f => f.name);

        let code = '';
        code += `// ======================= Action Route: ${route.name} =======================\n`;
        code += `// ${route.description || 'Custom action route'}\n`;
        code += `// =================================================================\n\n`;

        // Imports
        if (route.useJwt !== false) {
            code += `const jwt = require('jsonwebtoken');\n`;
        }
        code += `\n`;

        // Route definition
        code += `app.${method}('${routePath}', `;
        if (route.useJwt !== false) {
            code += `authenticate, `;
        }
        code += `(req, res) => {\n`;
        code += `  try {\n`;

        // Get identity from JWT or body
        if (identityField && route.useJwt !== false) {
            code += `    const ${identityField} = req.user.id;\n`;
            code += `    const { ${insertFieldNames.filter(f => f !== identityField).join(', ')} } = req.body;\n`;
        } else {
            code += `    const { ${insertFieldNames.join(', ')} } = req.body;\n`;
        }

        code += `\n`;

        // Pre-checks
        if (route.preChecks && route.preChecks.length > 0) {
            code += `    // --- Pre-checks ---\n`;
            for (let i = 0; i < route.preChecks.length; i++) {
                const check = route.preChecks[i];
                code += `    // Check ${i + 1}: ${check.description || check.checkField + ' ' + check.operator + ' ' + check.checkValue}\n`;
                code += `    const row${i} = db.prepare('SELECT ${check.checkField} FROM ${check.checkTable} WHERE ${check.identityField || identityField} = ?').get(${check.identityField || identityField});\n`;
                if (check.operator === '=') {
                    code += `    if (!row${i} || String(row${i}.${check.checkField}) !== String('${check.checkValue}')) {\n`;
                } else if (check.operator === '!=') {
                    code += `    if (row${i} && String(row${i}.${check.checkField}) === String('${check.checkValue}')) {\n`;
                } else if (check.operator === '>') {
                    code += `    if (row${i} && row${i}.${check.checkField} > ${check.checkValue}) {\n`;
                } else if (check.operator === '<') {
                    code += `    if (row${i} && row${i}.${check.checkField} < ${check.checkValue}) {\n`;
                }
                code += `      return res.status(403).json({ error: '${check.errorMessage || "Check failed"}' });\n`;
                code += `    }\n\n`;
            }
        }

        // Limit checks
        if (route.limitChecks && route.limitChecks.length > 0) {
            code += `    // --- Limit checks ---\n`;
            for (let i = 0; i < route.limitChecks.length; i++) {
                const limit = route.limitChecks[i];
                code += `    // Limit ${i + 1}: ${limit.description || 'count check'}\n`;
                code += `    const count${i} = db.prepare('SELECT COUNT(*) as cnt FROM ${limit.countTable || targetTable} WHERE ${limit.groupField} = ?').get(${limit.groupField});\n`;
                code += `    const limitVal${i} = db.prepare('SELECT ${limit.limitField} FROM ${limit.limitTable} WHERE ${limit.limitField} IS NOT NULL LIMIT 1').get();\n`;
                code += `    if (count${i} && limitVal${i} && count${i}.cnt >= limitVal${i}.${limit.limitField}) {\n`;
                code += `      return res.status(403).json({ error: '${limit.errorMessage || "Limit exceeded"}' });\n`;
                code += `    }\n\n`;
            }
        }

        // Insert the record
        code += `    // --- Insert record ---\n`;
        if (identityField && route.useJwt !== false) {
            const otherFields = insertFieldNames.filter(f => f !== identityField);
            code += `    const result = db.prepare('INSERT INTO ${targetTable} (${insertFieldNames.join(', ')}) VALUES (${insertFieldNames.map(() => '?').join(', ')})').run(${insertFieldNames.map(f => f === identityField ? identityField : f).join(', ')});\n`;
        } else {
            code += `    const result = db.prepare('INSERT INTO ${targetTable} (${insertFieldNames.join(', ')}) VALUES (${insertFieldNames.map(() => '?').join(', ')})').run(${insertFieldNames.join(', ')});\n`;
        }
        code += `\n`;

        // Post-actions
        if (route.postActions && route.postActions.length > 0) {
            code += `    // --- Post-actions ---\n`;
            for (let i = 0; i < route.postActions.length; i++) {
                const action = route.postActions[i];
                code += `    // Action ${i + 1}: ${action.description || 'update ' + action.setTable + '.' + action.setField}\n`;
                code += `    db.prepare('UPDATE ${action.setTable} SET ${action.setField} = ${action.setValue} WHERE ${action.whereField} = ?').run(${action.whereSourceField || `req.body.${action.whereField}`});\n`;
            }
            code += `\n`;
        }

        // Response
        code += `    res.status(201).json({ message: '${route.name} successful', id: result.lastInsertRowid });\n`;
        code += `  } catch (err) {\n`;
        code += `    res.status(500).json({ error: err.message });\n`;
        code += `  }\n`;
        code += `});\n`;

        return code;
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
        const rules = this.schemaRegistry.getRules();
        const ruleTypes = [
            { value: 'preCheck', label: 'Pre-Check (validate before INSERT/UPDATE)' },
            { value: 'limitCheck', label: 'Limit Check (prevent exceeding a limit)' },
            { value: 'postAction', label: 'Post-Action (auto-update after INSERT)' }
        ];
        const ruleTypeOptions = ruleTypes.map(r =>
            `<option value="${r.value}">${r.label}</option>`
        ).join('');
        const tableOptions = tables.map(t => `<option value="${t}">${t}</option>`).join('');
        const savedRulesHtml = rules.length > 0 ? rules.map((rule, idx) => {
            let desc = '';
            if (rule.type === 'preCheck') {
                desc = `Check ${rule.checkTable}.${rule.checkField} ${rule.operator} '${rule.checkValue}' before ${rule.action || 'INSERT'} on ${rule.targetTable}`;
            } else if (rule.type === 'limitCheck') {
                desc = `Limit ${rule.groupField} count < ${rule.limitField} from ${rule.limitTable} on ${rule.targetTable}`;
            } else if (rule.type === 'postAction') {
                desc = `After ${rule.action || 'INSERT'} on ${rule.targetTable}, SET ${rule.setTable}.${rule.setField} = ${rule.setValue}`;
            }
            const ruleJson = this._jsStr(JSON.stringify(rule));
            return `<div class="saved-rule-item" onclick="editRule(${idx}, '${ruleJson}')" style="cursor:pointer;" title="Click to edit this rule">
                <span><span class="sq-name">${rule.type}</span><span class="sq-info">${this._escapeHtml(desc)}</span></span>
                <span class="sq-actions">
                    <button class="btn btn-danger btn-sm" onclick="removeRule(${idx}, event)" title="Delete rule">${this._svgCloseIcon()}</button>
                </span>
            </div>`;
        }).join('') : '<div class="qb-empty">No business rules defined yet</div>';

        const fkFieldsHtml = tables.map(t => {
            const table = this.schemaRegistry.getTable(t);
            if (!table) return '';
            return table.fields.map(f => {
                return `<option value="${t}.${f.name}">${t}.${f.name} (${f.type})</option>`;
            }).join('');
        }).join('');

        const actionRoutes = this.schemaRegistry.getActionRoutes();
        const savedActionRoutesHtml = actionRoutes.length > 0 ? actionRoutes.map((route, idx) => {
            let desc = `${route.method || 'POST'} /api/${route.name}`;
            if (route.targetTable) desc += ` → ${route.targetTable}`;
            if (route.identityField) desc += ` (auth: ${route.identityField})`;
            const checkCount = (route.preChecks ? route.preChecks.length : 0) + (route.limitChecks ? route.limitChecks.length : 0);
            const actionCount = route.postActions ? route.postActions.length : 0;
            if (checkCount > 0) desc += ` | ${checkCount} checks`;
            if (actionCount > 0) desc += ` | ${actionCount} actions`;
            return `<div class="saved-rule-item">
                <span><span class="sq-name" style="color:#6f6;">ROUTE</span><span class="sq-info">${this._escapeHtml(desc)}</span></span>
                <span class="sq-actions">
                    <button class="btn btn-danger btn-sm" onclick="removeActionRoute(${idx}, event)" title="Delete route">${this._svgCloseIcon()}</button>
                </span>
            </div>`;
        }).join('') : '<div class="qb-empty">No action routes defined yet</div>';

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
            <button class="tab-btn" onclick="switchTab('rules')" id="tabRules">Rules</button>
            <button class="tab-btn" onclick="switchTab('actions')" id="tabActions">Actions</button>
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
            <button class="btn btn-secondary" onclick="extractSchemaSql()" ${hasTables ? '' : 'disabled'} title="Extract all CREATE TABLE SQL to clipboard">
                ${this._svgSqlIcon()} Extract SQL
            </button>
            <button class="btn btn-secondary" onclick="refresh()">${this._svgRefreshIcon()} Refresh</button>
        </div>
    </div>

    <div id="tabTablesContent" class="tab-content tab-active">
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

    <div id="tabRulesContent" class="tab-content">
        ${hasTables ? `
        <div class="rules-panel">
            <h3>${this._svgGenerateIcon()} Business Rules Engine</h3>
            <p style="color:#888;font-size:12px;margin-bottom:14px;line-height:1.5;">
                Define validation rules that run before/after database operations.
                Rules enforce business logic like: "member must be active to book" or "auto-calculate total cost".
            </p>

            <div id="savedRules">${savedRulesHtml}</div>

            <div class="rules-add-form" id="ruleForm">
                <h4>Add New Rule</h4>
                <div class="rule-row">
                    <label>Rule Type:</label>
                    <select id="ruleType" onchange="onRuleTypeChange(this.value)">
                        ${ruleTypeOptions}
                    </select>
                </div>

                <div id="preCheckFields">
                    <div class="rule-row">
                        <label>Target Table:</label>
                        <select id="ruleTargetTable">${tableOptions}</select>
                    </div>
                    <div class="rule-row">
                        <label>Action:</label>
                        <select id="ruleAction">
                            <option value="INSERT">INSERT</option>
                            <option value="UPDATE">UPDATE</option>
                            <option value="DELETE">DELETE</option>
                        </select>
                    </div>
                    <div class="rule-row">
                        <label>Check Table:</label>
                        <select id="ruleCheckTable">${tableOptions}</select>
                    </div>
                    <div class="rule-row">
                        <label>Check Field:</label>
                        <select id="ruleCheckField">${fkFieldsHtml}</select>
                    </div>
                    <div class="rule-row">
                        <label>Operator:</label>
                        <select id="ruleOperator">
                            <option value="=">= (equals)</option>
                            <option value="!=">!= (not equals)</option>
                            <option value=">">> (greater than)</option>
                            <option value="<">< (less than)</option>
                            <option value="LIKE">LIKE</option>
                            <option value="IS NULL">IS NULL</option>
                            <option value="IS NOT NULL">IS NOT NULL</option>
                        </select>
                    </div>
                    <div class="rule-row">
                        <label>Check Value:</label>
                        <input type="text" id="ruleCheckValue" placeholder="e.g. active, 0, false" />
                    </div>
                    <div class="rule-row">
                        <label>Error Message:</label>
                        <input type="text" id="ruleErrorMessage" placeholder="e.g. Member must be active to book" />
                    </div>
                </div>

                <div id="limitCheckFields" style="display:none;">
                    <div class="rule-row">
                        <label>Target Table:</label>
                        <select id="ruleLimitTargetTable">${tableOptions}</select>
                    </div>
                    <div class="rule-row">
                        <label>Count Field:</label>
                        <select id="ruleCountField">${fkFieldsHtml}</select>
                    </div>
                    <div class="rule-row">
                        <label>Group By Field:</label>
                        <select id="ruleGroupField">${fkFieldsHtml}</select>
                    </div>
                    <div class="rule-row">
                        <label>Limit Field (in referenced table):</label>
                        <input type="text" id="ruleLimitField" placeholder="e.g. maxSlots, numOfPositions" />
                    </div>
                    <div class="rule-row">
                        <label>Limit Table:</label>
                        <select id="ruleLimitTable">${tableOptions}</select>
                    </div>
                    <div class="rule-row">
                        <label>Error Message:</label>
                        <input type="text" id="ruleLimitError" placeholder="e.g. Program is fully booked" />
                    </div>
                </div>

                <div id="postActionFields" style="display:none;">
                    <div class="rule-row">
                        <label>Target Table:</label>
                        <select id="rulePostTargetTable">${tableOptions}</select>
                    </div>
                    <div class="rule-row">
                        <label>Action:</label>
                        <select id="rulePostAction">
                            <option value="INSERT">INSERT</option>
                            <option value="UPDATE">UPDATE</option>
                        </select>
                    </div>
                    <div class="rule-row">
                        <label>Set Table (to update):</label>
                        <select id="ruleSetTable">${tableOptions}</select>
                    </div>
                    <div class="rule-row">
                        <label>Set Field:</label>
                        <input type="text" id="ruleSetField" placeholder="e.g. totalCost, voted" />
                    </div>
                    <div class="rule-row">
                        <label>Set Value (SQL expression):</label>
                        <input type="text" id="ruleSetValue" placeholder="e.g. hoursBooked * hourlyRate" />
                    </div>
                    <div class="rule-row">
                        <label>Where Field (match on):</label>
                        <select id="ruleWhereField">${fkFieldsHtml}</select>
                    </div>
                    <div class="rule-row">
                        <label>Source Field (from request body):</label>
                        <select id="ruleWhereSourceField">${fkFieldsHtml}</select>
                    </div>
                </div>

                <input type="hidden" id="editingRuleIndex" value="-1" />
                <div class="rule-actions">
                    <button class="btn btn-success" id="addRuleBtn" onclick="addNewRule()">Add Rule</button>
                    <button class="btn btn-primary" id="updateRuleBtn" onclick="updateRule()" style="display:none;">Update Rule</button>
                    <button class="btn btn-warning" id="cancelEditBtn" onclick="cancelEditRule()" style="display:none;">Cancel</button>
                    <button class="btn btn-info" onclick="previewRules()">Preview Code</button>
                </div>
            </div>

            <textarea class="qb-preview-textarea" id="rulesPreview" readonly placeholder="Click 'Preview Code' to see generated middleware"></textarea>
            <div class="rule-actions" style="margin-top:8px;">
                <button class="btn btn-success" onclick="generateRules()" ${rules.length > 0 ? '' : 'disabled'}>${this._svgGenerateIcon()} Generate Rules Code</button>
            </div>
        </div>
        ` : `
        <div class="empty-state">
            <h2>Register tables first</h2>
            <p>Go to the <strong>Tables</strong> tab, add some tables,<br>
            then come here to define business rules.</p>
        </div>
        `}
    </div>

    <div id="tabActionsContent" class="tab-content">
        ${hasTables ? `
        <div class="rules-panel">
            <h3>${this._svgGenerateIcon()} Custom Action Routes</h3>
            <p style="color:#888;font-size:12px;margin-bottom:14px;line-height:1.5;">
                Define custom API routes with business logic (e.g., voting, booking, ordering).
                These routes include authentication, pre-checks, inserts, and post-actions — all generated from a form.
            </p>

            <div id="savedActionRoutes">${savedActionRoutesHtml}</div>

            <div class="rules-add-form" id="actionRouteForm">
                <h4>Add New Action Route</h4>

                <div class="rule-row">
                    <label>Route Name:</label>
                    <input type="text" id="arName" placeholder="e.g. vote, book, order" />
                </div>
                <div class="rule-row">
                    <label>Description:</label>
                    <input type="text" id="arDescription" placeholder="e.g. Cast a vote for a candidate" />
                </div>
                <div class="rule-row">
                    <label>Method:</label>
                    <select id="arMethod">
                        <option value="POST">POST</option>
                        <option value="GET">GET</option>
                        <option value="PUT">PUT</option>
                        <option value="PATCH">PATCH</option>
                        <option value="DELETE">DELETE</option>
                    </select>
                </div>
                <div class="rule-row">
                    <label>Target Table:</label>
                    <select id="arTargetTable">${tableOptions}</select>
                </div>
                <div class="rule-row">
                    <label>Use Authentication:</label>
                    <select id="arUseJwt">
                        <option value="true">Yes (require login)</option>
                        <option value="false">No (public route)</option>
                    </select>
                </div>
                <div class="rule-row">
                    <label>Identity Field (from JWT):</label>
                    <select id="arIdentityField">
                        <option value="">— None —</option>
                        ${fkFieldsHtml}
                    </select>
                    <span style="color:#555;font-size:11px;">Which field stores the logged-in user's ID?</span>
                </div>

                <h4>Pre-Checks (validate before insert)</h4>
                <div id="arPreChecks"></div>
                <button class="btn btn-info btn-sm" onclick="addArPreCheck()" style="margin-bottom:12px;">+ Add Pre-Check</button>

                <h4>Limit Checks (prevent exceeding a limit)</h4>
                <div id="arLimitChecks"></div>
                <button class="btn btn-info btn-sm" onclick="addArLimitCheck()" style="margin-bottom:12px;">+ Add Limit Check</button>

                <h4>Post-Actions (update after insert)</h4>
                <div id="arPostActions"></div>
                <button class="btn btn-info btn-sm" onclick="addArPostAction()" style="margin-bottom:12px;">+ Add Post-Action</button>

                <div class="rule-actions">
                    <button class="btn btn-success" onclick="addActionRoute()">Add Route</button>
                    <button class="btn btn-info" onclick="previewActionRoute()">Preview Code</button>
                </div>
            </div>

            <textarea class="qb-preview-textarea" id="actionRoutePreview" readonly placeholder="Click 'Preview Code' to see generated route"></textarea>
            <div class="rule-actions" style="margin-top:8px;">
                <button class="btn btn-success" onclick="generateActionRoute()" ${actionRoutes.length > 0 ? '' : 'disabled'}>${this._svgGenerateIcon()} Generate Route Code</button>
            </div>
        </div>
        ` : `
        <div class="empty-state">
            <h2>Register tables first</h2>
            <p>Go to the <strong>Tables</strong> tab, add some tables,<br>
            then come here to define custom action routes.</p>
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
                <div style="margin-top:6px;padding:6px 8px;background:#0d1b1b;border:1px solid #1a3a3a;border-radius:4px;">
                    <div style="color:#8cf;font-size:12px;font-weight:600;margin-bottom:4px;">MAIN</div>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;">
                        <label class="qb-groupby-cb checked" style="border-color:#4fc3f7;background:#0d2a2a;color:#8cf;">
                            <input type="checkbox" checked onchange="onAuthOptionChange()" id="authOptRoute" />
                            <span>Login route (server)</span>
                        </label>
                        <label class="qb-groupby-cb checked" style="border-color:#4fc3f7;background:#0d2a2a;color:#8cf;">
                            <input type="checkbox" checked onchange="onAuthOptionChange()" id="authOptBcrypt" />
                            <span>Use bcrypt</span>
                        </label>
                        <label class="qb-groupby-cb checked" style="border-color:#4fc3f7;background:#0d2a2a;color:#8cf;">
                            <input type="checkbox" checked onchange="onAuthOptionChange()" id="authOptJwt" />
                            <span>Use JWT</span>
                        </label>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
                        <label for="authOptSecretStorage" style="color:#aaa;font-size:12px;">Secret storage:</label>
                        <select id="authOptSecretStorage" onchange="onAuthOptionChange()" style="background:#1e1e1e;color:#ccc;border:1px solid #555;padding:3px 6px;border-radius:3px;font-size:12px;">
                            <option value="env">.env</option>
                            <option value="config">config.js</option>
                        </select>
                    </div>
                </div>
                <div style="margin-top:8px;padding:6px 8px;background:#111;border:1px solid #2a2a2a;border-radius:4px;">
                    <div style="color:#aaa;font-size:12px;font-weight:600;margin-bottom:4px;">OPTIONAL</div>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;">
                        <label class="qb-groupby-cb" style="color:#888;">
                            <input type="checkbox" onchange="onAuthOptionChange()" id="authOptRegister" />
                            <span>Register route (server)</span>
                        </label>
                        <label class="qb-groupby-cb" style="color:#888;">
                            <input type="checkbox" onchange="onAuthOptionChange()" id="authOptLogout" />
                            <span>Logout route (server)</span>
                        </label>
                        <label class="qb-groupby-cb checked" style="border-color:#4fc3f7;background:#0d2a2a;color:#8cf;">
                            <input type="checkbox" checked onchange="onAuthOptionChange()" id="authOptHtml" />
                            <span>Login form HTML</span>
                        </label>
                        <label class="qb-groupby-cb" style="color:#888;">
                            <input type="checkbox" onchange="onAuthOptionChange()" id="authOptRegisterHtml" />
                            <span>Register form HTML</span>
                        </label>
                        <label class="qb-groupby-cb checked" style="border-color:#4fc3f7;background:#0d2a2a;color:#8cf;">
                            <input type="checkbox" checked onchange="onAuthOptionChange()" id="authOptRefreshToken" />
                            <span>Refresh Token</span>
                        </label>
                        <label class="qb-groupby-cb checked" style="border-color:#4fc3f7;background:#0d2a2a;color:#8cf;">
                            <input type="checkbox" checked onchange="onAuthOptionChange()" id="authOptRateLimiter" />
                            <span>Rate Limiter</span>
                        </label>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
                        <label for="authOptDbStorage" style="color:#aaa;font-size:12px;">DB path:</label>
                        <select id="authOptDbStorage" onchange="onAuthOptionChange()" style="background:#1e1e1e;color:#ccc;border:1px solid #555;padding:3px 6px;border-radius:3px;font-size:12px;">
                            <option value="server">Server.js (hardcoded)</option>
                            <option value="env">.env</option>
                            <option value="config">config.js</option>
                        </select>
                    </div>
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

            <div class="auth-section">
                <label>Optional: Include Business Rules</label>
                <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;align-items:center;">
                    <label class="qb-groupby-cb" style="color:#888;">
                        <input type="checkbox" onchange="updateQsBtn()" id="qsEnableRules" />
                        <span>Include business rules</span>
                    </label>
                    <span style="color:#555;font-size:11px;">(${rules.length} rule${rules.length !== 1 ? 's' : ''} defined in Rules tab)</span>
                </div>
            </div>

            <div class="qb-actions" style="margin-top:16px;">
                <button class="btn btn-success" onclick="generateApp()" id="qsGenBtn">Generate Everything</button>
                <button class="btn btn-warning" onclick="clearQs()">Clear</button>
            </div>
        </div>
    </div>

    <!-- Table Settings Modal -->
    <div id="tableSettingsOverlay" class="modal-overlay" style="display:none;" onclick="closeTableSettings(event)">
        <div class="modal-content" onclick="event.stopPropagation()" style="background:#1e1e1e;border:1px solid #444;border-radius:8px;padding:24px;max-width:620px;margin:60px auto;color:#ccc;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <h3 id="tableSettingsTitle" style="margin:0;color:#eee;">Table Settings</h3>
                <button class="btn btn-danger btn-sm" onclick="closeTableSettings()" title="Close">&times;</button>
            </div>

            <div class="rule-row" style="margin-bottom:14px;">
                <label style="font-weight:600;color:#ddd;display:block;margin-bottom:4px;">Status / Soft-delete field</label>
                <select id="tsStatusField" style="width:100%;">
                    <option value="">Auto-detect (find any "stat" field)</option>
                    <option value="__none__">None — hard delete (DROP)</option>
                </select>
            </div>

            <div class="rule-row" style="margin-bottom:14px;padding-left:12px;border-left:2px solid #444;">
                <label style="font-weight:600;color:#ddd;display:block;margin-bottom:6px;">Status UI in forms</label>
                <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:8px;">
                    <label title="Two radio buttons: Active / Inactive"><input type="radio" name="tsStatusUi" value="radio" checked /> Radio buttons</label>
                    <label title="Dropdown select: pick Active or Inactive"><input type="radio" name="tsStatusUi" value="dropdown" /> Dropdown</label>
                    <label title="CSS toggle switch"><input type="radio" name="tsStatusUi" value="toggle" /> Toggle switch</label>
                    <label title="Plain text input"><input type="radio" name="tsStatusUi" value="text" /> Text input</label>
                </div>
                <div style="display:flex;gap:12px;">
                    <div style="flex:1;">
                        <label style="font-size:11px;color:#888;">Active value</label>
                        <input type="text" id="tsStatusActive" value="active" style="width:100%;padding:4px 8px;font-size:13px;" />
                    </div>
                    <div style="flex:1;">
                        <label style="font-size:11px;color:#888;">Inactive value</label>
                        <input type="text" id="tsStatusInactive" value="inactive" style="width:100%;padding:4px 8px;font-size:13px;" />
                    </div>
                </div>
            </div>

            <div class="rule-row" style="margin-bottom:14px;">
                <label style="font-weight:600;color:#ddd;display:block;margin-bottom:4px;">Edit / Update HTTP method</label>
                <div style="display:flex;gap:16px;margin-top:4px;">
                    <label><input type="radio" name="tsEditMode" value="put" checked /> PUT — replace all fields</label>
                    <label><input type="radio" name="tsEditMode" value="patch" /> PATCH — partial update</label>
                </div>
            </div>

            <div class="rule-row" style="margin-bottom:14px;">
                <label style="font-weight:600;color:#ddd;display:block;margin-bottom:4px;">Edit popup style</label>
                <div style="display:flex;gap:16px;margin-top:4px;">
                    <label><input type="radio" name="tsEditStyle" value="form" checked /> Inline form</label>
                    <label><input type="radio" name="tsEditStyle" value="modal" /> Modal popup</label>
                </div>
            </div>

            <div class="rule-row" style="margin-bottom:14px;">
                <label style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" id="tsShowDelete" />
                    <span style="font-weight:600;color:#ddd;">Show "Delete" button alongside "Deactivate" for hard-delete</span>
                </label>
            </div>

            <div class="rule-actions" style="margin-top:16px;display:flex;gap:8px;">
                <button class="btn btn-success" onclick="saveTableSettings()">Save Settings</button>
                <button class="btn btn-warning" onclick="closeTableSettings()">Cancel</button>
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
                    <button class="btn btn-secondary btn-sm" onclick="openTableSettings('${jsSafeName}', event)" title="Table settings">${this._svgSettingsIcon()}</button>
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
        if (field.uiType) {
            constraints += `<span class="badge badge-ui">[${this._escapeHtml(field.uiType)}]</span>`;
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
            <div class="field-actions">
                <select class="ui-type-select" title="UI control type"
                    onchange="setFieldUiType('${jsSafeTable}', '${jsSafeField}', this.value)"
                    onclick="event.stopPropagation();">
                    <option value="auto"${field.uiType ? '' : ' selected'}>Auto</option>
                    <option value="text"${field.uiType === 'text' ? ' selected' : ''}>text</option>
                    <option value="number"${field.uiType === 'number' ? ' selected' : ''}>number</option>
                    <option value="textarea"${field.uiType === 'textarea' ? ' selected' : ''}>textarea</option>
                    <option value="fk-select"${field.uiType === 'fk-select' ? ' selected' : ''}>fk-select</option>
                    <option value="checkbox"${field.uiType === 'checkbox' ? ' selected' : ''}>checkbox</option>
                    <option value="date"${field.uiType === 'date' ? ' selected' : ''}>date</option>
                    <option value="time"${field.uiType === 'time' ? ' selected' : ''}>time</option>
                    <option value="email"${field.uiType === 'email' ? ' selected' : ''}>email</option>
                    <option value="password"${field.uiType === 'password' ? ' selected' : ''}>password</option>
                    <option value="url"${field.uiType === 'url' ? ' selected' : ''}>url</option>
                    <option value="tel"${field.uiType === 'tel' ? ' selected' : ''}>tel</option>
                    <option value="color"${field.uiType === 'color' ? ' selected' : ''}>color</option>
                    <option value="hidden"${field.uiType === 'hidden' ? ' selected' : ''}>hidden</option>
                </select>
                ${fkButton}
            </div>
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
